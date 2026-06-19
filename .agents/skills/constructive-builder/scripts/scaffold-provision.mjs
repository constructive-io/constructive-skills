#!/usr/bin/env node
/**
 * scripts/scaffold-provision.mjs <brief> <appDir>
 *
 * Brief → the 6 provision files under <appDir>/packages/provision/src/ :
 *   config.ts     — copied from scripts/templates/provision, db-name/admin creds substituted
 *   helpers.ts    — copied VERBATIM
 *   blueprint.ts  — copied VERBATIM (the generic constructBlueprint engine)
 *   create-db.ts  — copied; __MODULES__ replaced with the COMPUTED module closure
 *   provision.ts  — copied; __SCHEMAS__ + __AUTH_PRESET__ substituted
 *   schemas/core.ts — GENERATED BlueprintDefinition from data_model (the heart)
 *
 * GENERIC BY CONSTRUCTION. The data model, policies, nodes, fields, modules — all
 * driven by the brief via scripts/lib/brief.mjs. The emitter writes the COMMON
 * CASE as explicit, editable literal `nodes[]` / `policies[]` arrays with a seam
 * header per table and `// TODO: advanced` markers where the brief used a raw
 * escape hatch. Nothing here hard-codes a domain.
 *
 * Idempotent: re-running overwrites the generated files deterministically.
 * Legible failures: a bad brief throws a single BriefError with a clear message.
 *
 * Usage:
 *   node scripts/scaffold-provision.mjs build/app-brief.yaml ./my-app
 *   node scripts/scaffold-provision.mjs build/app-brief.yaml ./my-app --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import {
  loadBrief,
  buildBlueprintDefinition,
  computeModuleClosure,
  BriefError,
} from './lib/brief.mjs';
import { getPlatformEndpoint, getHubDatabase } from './lib/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, 'templates', 'provision');

// ════════════════════════════════════════════════════════════════════════════
// TypeScript-literal serializer — emits the same shape the working golden app
// ships (single quotes; compact one-line objects for nodes/fields/policies).
// ════════════════════════════════════════════════════════════════════════════

function q(s) {
  // single-quoted TS string literal
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Is this object/array "small" enough to render on one line? */
function isInlineValue(v) {
  if (v === null || typeof v !== 'object') return true;
  if (Array.isArray(v)) {
    // arrays of scalars or short tuples render inline
    return v.every((x) => x === null || typeof x !== 'object' || Array.isArray(x) && x.every((y) => typeof y !== 'object'));
  }
  // objects with only scalar / shallow values render inline
  return Object.values(v).every((x) => x === null || typeof x !== 'object' ||
    (!Array.isArray(x) && Object.values(x).every((y) => typeof y !== 'object')));
}

/** Render a JS value as a compact TS literal (one line). */
function inline(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return q(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return `[${v.map(inline).join(', ')}]`;
  }
  // object
  const keys = Object.keys(v);
  if (keys.length === 0) return '{}';
  const body = keys.map((k) => `${tsKey(k)}: ${inline(v[k])}`).join(', ');
  return `{ ${body} }`;
}

/** Render an object key — bareword when a valid identifier, else quoted. */
function tsKey(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : q(k);
}

/** Render a node entry: bare string OR a one-line { $type, data } object. */
function renderNode(n) {
  if (typeof n === 'string') return q(n);
  return inline(n);
}

/** Render a field entry as a one-line object. */
function renderField(f) {
  return inline(f);
}

/** Render a single policy as a multi-line object (matches the golden layout). */
function renderPolicy(p, indent) {
  const i = ' '.repeat(indent);
  const i2 = ' '.repeat(indent + 2);
  const lines = [`${i}{`];
  lines.push(`${i2}$type: ${q(p.$type)},`);
  if (p.privileges) lines.push(`${i2}privileges: ${inline(p.privileges)},`);
  if (p.permissive !== undefined) lines.push(`${i2}permissive: ${p.permissive},`);
  if (p.policy_name) lines.push(`${i2}policy_name: ${q(p.policy_name)},`);
  if (p.policy_role) lines.push(`${i2}policy_role: ${q(p.policy_role)},`);
  if (p.data !== undefined) lines.push(`${i2}data: ${inline(p.data)},`);
  lines.push(`${i}}`);
  return lines.join('\n');
}

/** Render the grants array with the explanatory comment, matching golden. */
function renderGrants(grants) {
  return inline(grants);
}

// ════════════════════════════════════════════════════════════════════════════
// schemas/core.ts emitter
// ════════════════════════════════════════════════════════════════════════════

/** Build the per-table block (with a seam header comment) inside `tables: [...]`. */
function emitTable(t, briefTable) {
  const L = [];
  L.push('    {');
  L.push(`      ref: ${q(t.ref)},`);
  L.push(`      table_name: ${q(t.table_name)},`);

  // nodes[] — explicit, editable array (the agent-editable seam)
  L.push('      nodes: [');
  for (const n of t.nodes) L.push(`        ${renderNode(n)},`);
  if (briefTable && Array.isArray(briefTable.nodes_raw)) {
    L.push('        // TODO: advanced — nodes_raw passthrough (see constructive-blueprints/references/blueprint-definition-format.md)');
  }
  L.push('      ],');

  // fields[]
  L.push('      fields: [');
  for (const f of t.fields) L.push(`        ${renderField(f)},`);
  L.push('      ],');

  // grants — object-form (enforces the GRANT … TO authenticated shape)
  L.push('      // OBJECT-FORM grants — constructBlueprint applies these as GRANT … TO authenticated.');
  L.push(`      grants: ${renderGrants(t.grants)},`);

  L.push(`      use_rls: ${t.use_rls},`);

  // policies[] — explicit, editable array (the agent-editable seam)
  if (t.policies.length === 1 && !(briefTable && briefTable.policies_raw)) {
    // single policy → match the golden compact-ish multi-line single-element form
    L.push('      policies: [{');
    const p = t.policies[0];
    L.push(`        $type: ${q(p.$type)},`);
    if (p.privileges) L.push(`        privileges: ${inline(p.privileges)},`);
    if (p.permissive !== undefined) L.push(`        permissive: ${p.permissive},`);
    if (p.policy_name) L.push(`        policy_name: ${q(p.policy_name)},`);
    if (p.policy_role) L.push(`        policy_role: ${q(p.policy_role)},`);
    if (p.data !== undefined) L.push(`        data: ${inline(p.data)},`);
    L.push('      }],');
  } else {
    L.push('      policies: [');
    for (const p of t.policies) {
      L.push(renderPolicy(p, 8) + ',');
    }
    if (briefTable && Array.isArray(briefTable.policies_raw)) {
      L.push('        // TODO: advanced — policies_raw passthrough (see constructive-security/references/authz-types.md)');
    }
    L.push('      ],');
  }

  if (t.unique_constraints) {
    L.push(`      unique_constraints: ${inline(t.unique_constraints)},`);
  }

  L.push('    },');
  return L.join('\n');
}

/** A one-line human description of a table's access model for the seam header. */
function policyComment(briefTable) {
  switch (briefTable?.policy) {
    case 'owner':
      return 'owner-scoped (DataDirectOwner + AuthzDirectOwner all-CRUD): each row belongs to one user.';
    case 'org-membership':
      return 'org-membership (DataEntityMembership + AuthzEntityMembership): any member of the owning org reads+writes. Requires b2b modules.';
    case 'member-owner':
      return 'member-owner (DataOwnershipInEntity + AuthzMemberOwner): user-owned AND org-scoped. Requires b2b modules.';
    case 'org-hierarchy': {
      const dir = briefTable?.policy_params?.direction ?? '?';
      return `org-hierarchy (DataOwnershipInEntity + AuthzOrgHierarchy direction=${dir}): hierarchy-closure visibility. Requires b2b + hierarchy_module.`;
    }
    case 'related-membership': {
      const pp = briefTable?.policy_params ?? {};
      const ef = pp.entity_field ?? '?';
      const jt = pp.join_table ?? '?';
      const jef = pp.join_entity_field ?? '?';
      return `related-membership (AuthzRelatedEntityMembership): parent-derived — members of the org owning ${jt} (joined via ${ef}→${jef}) read+write. Requires b2b.`;
    }
    case 'public-read+owner-write':
      return 'public-read+owner-write (DataDirectOwner + DataPublishable; AuthzDirectOwner all-CRUD + AuthzPublishable select-only): published rows readable by anyone authenticated, only the owner writes.';
    case 'public-lookup':
      return 'public-lookup (AuthzAllowAll): authenticated read+write, NO ownership. NOT public-read — use sparingly (shared reference data only).';
    default:
      return 'custom (nodes_raw / policies_raw escape hatch — see the blueprint-definition-format reference).';
  }
}

function emitCoreTs(brief, def) {
  const tables = brief.data_model.tables;
  // ONE general emitter for EVERY app — the canary (plain single owner table)
  // included. There is deliberately no special "golden" byte-match branch: the
  // rot canary (check-scaffold.mjs) now asserts the canary's general-path output
  // is STRUCTURALLY EQUIVALENT to the reference blueprint (order-insensitive
  // parse, comments/header ignored), which is a stronger contract than a frozen
  // byte snapshot and means real apps exercise the exact code path the canary
  // verifies — no parallel hand-tuned emitter to drift.

  const L = [];
  L.push('/**');
  L.push(' * schemas/core.ts — Core domain tables (GENERATED from the app brief by');
  L.push(' * scripts/scaffold-provision.mjs). This is the declarative BlueprintDefinition');
  L.push(' * the platform consumes. Each table below was emitted from its brief `policy`');
  L.push(' * intent into explicit, EDITABLE `nodes[]` + `policies[]` literal arrays — the');
  L.push(' * agent-editable seams. Tweak them in place for the long tail, or regenerate by');
  L.push(' * editing the brief and re-running the scaffolder.');
  L.push(' *');
  L.push(' * Field shapes are OBJECTS (FIELD-TYPE-001): type = { name: <type> },');
  L.push(' * default = { value: <literal> } — never bare strings. DataId is prepended and');
  L.push(' * { $type: \'DataTimestamps\', data: { include_id: false } } appended to every table.');
  L.push(' */');
  L.push("import type { BlueprintDefinition } from 'node-type-registry';");
  L.push("import { provisionBlueprint } from '../blueprint.js';");
  L.push('');
  L.push('const definition: BlueprintDefinition = {');
  L.push('  tables: [');

  for (let i = 0; i < def.tables.length; i++) {
    const briefTable = tables[i];
    // Seam header: name the access model so the agent knows what to edit.
    L.push(`    // ── ${def.tables[i].table_name}: ${policyComment(briefTable)}`);
    L.push(emitTable(def.tables[i], briefTable));
  }

  L.push('  ],');
  L.push('');

  // relations
  if ((def.relations ?? []).length === 0) {
    L.push('  relations: [],');
  } else {
    L.push('  relations: [');
    for (const r of def.relations) {
      L.push(`    ${inline(r)},`);
    }
    L.push('  ],');
  }

  // full_text_searches (top-level) — PLURAL key; the blueprint engine reads
  // definition.full_text_searches. Each entry is { table_name, field, sources }.
  if (def.full_text_searches && def.full_text_searches.length) {
    L.push('');
    L.push('  // Full-text search — a tsvector (field) + GIN index fed by the weighted source columns.');
    L.push('  full_text_searches: [');
    for (const f of def.full_text_searches) {
      L.push(`    ${inline(f)},`);
    }
    L.push('  ],');
  }

  L.push('};');
  L.push('');
  L.push('export default async function main() {');
  L.push("  await provisionBlueprint(definition, 'App Core');");
  L.push('}');
  L.push('');

  return L.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// Module-list literal emitter for create-db.ts (__MODULES__)
// ════════════════════════════════════════════════════════════════════════════

/** Render the computed module closure as a TS array literal (native tuples). */
function emitModulesLiteral(mods) {
  if (mods.length === 0) return '[]';
  const lines = ['['];
  for (const m of mods) {
    if (typeof m === 'string') {
      lines.push(`  ${q(m)},`);
    } else if (Array.isArray(m)) {
      const [name, opts] = m;
      lines.push(`  [${q(name)}, ${inline(opts)}],`);
    } else {
      lines.push(`  ${inline(m)},`);
    }
  }
  lines.push(']');
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// Template stamping
// ════════════════════════════════════════════════════════════════════════════

function readTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

/** Fail loudly if a code-level placeholder survived substitution. The doc-comment
 *  header legitimately mentions each token bare, so only flag a token that still
 *  appears OUTSIDE a comment line. */
function assertNoUnsubstituted(name, content) {
  const tokens = ['__DB_NAME__', '__ADMIN_EMAIL__', '__ADMIN_PASSWORD__', '__MODULES__', '__SCHEMAS__', '__AUTH_PRESET__', '__SITE_DOMAIN__', '__API_ENDPOINT__', '__MODULES_ENDPOINT__', '__AUTH_ENDPOINT__', '__PG_HUB_DATABASE__'];
  for (const line of content.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    for (const tok of tokens) {
      if (line.includes(tok)) {
        throw new Error(`scaffold-provision: ${name} still contains unsubstituted placeholder ${tok} — template/substitution drift (see stamp* functions).`);
      }
    }
  }
}

// NOTE: each placeholder appears TWICE in its template — once in the doc-comment
// header (bare, e.g. `__MODULES__  ← …`) and once in the actual code (quoted for
// string fields, or as a `const X = __TOKEN__;` line). We substitute ONLY the code
// occurrence by matching its surrounding context, leaving the explanatory comment
// intact. (A bare String.replace would hit the comment first and miss the code.)

function stampConfig(brief) {
  let s = readTemplate('config.ts');
  // String-field placeholders are quoted in code; the comment uses them bare.
  s = s.replace("'__DB_NAME__'", q(brief.naming.db_name));
  s = s.replace("'__ADMIN_EMAIL__'", q(brief.auth?.admin_email ?? 'admin@example.com'));
  s = s.replace("'__ADMIN_PASSWORD__'", q(brief.auth?.admin_password ?? 'change-me-before-build'));
  // Infra endpoint + hub-db DEFAULTS come from constructive.config.json (the single
  // source) — the `process.env.* ||` chain in the template still overrides at runtime.
  // PLATFORM endpoints (no per-app subdomain): provisioning READS hit api.localhost,
  // WRITES hit modules.localhost, auth hits auth.localhost (gotchas PROVISION-001).
  s = s.replace("'__API_ENDPOINT__'", q(getPlatformEndpoint('api')));
  s = s.replace("'__MODULES_ENDPOINT__'", q(getPlatformEndpoint('modules')));
  s = s.replace("'__AUTH_ENDPOINT__'", q(getPlatformEndpoint('auth')));
  s = s.replace("'__PG_HUB_DATABASE__'", q(getHubDatabase()));
  return s;
}

function stampCreateDb(modsLiteral) {
  let s = readTemplate('create-db.ts');
  // Target the code line `const MODULES = __MODULES__;` (not the comment mention).
  s = s.replace('const MODULES = __MODULES__;', `const MODULES = ${modsLiteral};`);
  return s;
}

function stampProvision(brief) {
  let s = readTemplate('provision.ts');
  // __SCHEMAS__ default: one entry per generated schema file. We generate a single
  // schemas/core.ts wholesale; multi-schema apps add more entries by hand.
  const schemasLiteral = "[\n    ['App Core', './schemas/core.js'],\n  ]";
  s = s.replace('const schemas = __SCHEMAS__;', `const schemas = ${schemasLiteral};`);
  // __AUTH_PRESET__: the chosen preset gates the auth appendix. A 'minimal'
  // (no-auth) app skips it; any auth/b2b preset runs it.
  const preset = brief.modules?.preset ?? 'auth:email';
  s = s.replace("const AUTH_PRESET: string = '__AUTH_PRESET__';", `const AUTH_PRESET: string = ${q(preset)};`);
  // __SITE_DOMAIN__: gate the per-app site-domain backfill (the row send-email-link
  // needs, else "Missing site configuration for email"). EMAIL-CAPABLE = any
  // non-minimal auth preset (every auth preset ships emails_module + the email-send
  // surface) OR the brief explicitly lists an email-sending flow. The INSERT is
  // idempotent + tenant-scoped, so this gate is intentionally inclusive: under-firing
  // (leaving email broken) is worse than the harmless no-op of an extra domain row.
  s = s.replace('const SITE_DOMAIN_NEEDED: boolean = __SITE_DOMAIN__;',
    `const SITE_DOMAIN_NEEDED: boolean = ${needsSiteDomain(brief, preset)};`);
  return s;
}

/** The email-sending flows whose links require a configured site-domain. (Most auth
 *  flows also ship emails_module; this list is the BELT to the preset SUSPENDERS so a
 *  'minimal'-but-email brief, if one ever exists, still gets the row.) */
const EMAIL_SENDING_FLOWS = new Set([
  'email-password', 'email-verification', 'password-reset', 'magic-link',
  'account-emails', 'change-password', 'account-deletion', 'org-invites',
]);

/** Whether the app needs the site-domain backfill: true for any non-minimal (email-
 *  capable) auth preset, or when the brief lists an email-sending flow. */
function needsSiteDomain(brief, preset) {
  if (preset && preset !== 'minimal') return true;
  const flows = brief.flows ?? [];
  return flows.some((f) => EMAIL_SENDING_FLOWS.has(f));
}

// ════════════════════════════════════════════════════════════════════════════
// packages/provision/package.json stamping
//
// The provision package is a `pgpm-init` scaffold that ships a bare package.json
// (no create-db/provision scripts, none of the runtime deps). Without this the
// app's `pnpm run create-db` / `provision` fail. We MERGE the required bits onto
// whatever pgpm-init wrote (preserving its name/scripts/deps), or write a clean
// minimal manifest when none exists. Matches the working golden-app/provision.
// ════════════════════════════════════════════════════════════════════════════

const PROVISION_SCRIPTS = {
  'create-db': 'tsx src/create-db.ts',
  // `provision` self-sources `pgpm env` so the PG-appendix (membership approval, email-verify,
  // users self-update, public-read reconcile, org-member-management grants) ALWAYS has PGHOST — regardless of the caller's
  // env. Bash resets env between calls, so a bare `pnpm run provision` would otherwise leave PGHOST
  // unset and SILENTLY skip the whole appendix while still printing success (leaves the app only
  // partially provisioned). Caller-independent + hands-free; PGDATABASE=postgres from pgpm env is
  // harmless (the appendix Pools connect to config.pgDatabase explicitly).
  provision: 'eval "$(pgpm env)" && tsx src/provision.ts',
  build: "echo 'No build required'",
};
const PROVISION_DEPS = {
  '@constructive-io/sdk': '^0.23.3',
  dotenv: '^16.5.0',
  'node-type-registry': '^0.43.1',
  pg: '^8.16.0',
};
const PROVISION_DEV_DEPS = {
  '@types/pg': '^8.15.4',
  tsx: '^4.21.0',
  typescript: '^5.9.3',
};

/** Build (or merge into) packages/provision/package.json. */
function stampProvisionPkg(brief, existing) {
  const pkg = existing && typeof existing === 'object' ? { ...existing } : {};
  // Preserve a name pgpm-init already chose; otherwise derive @<app.id>/provision.
  pkg.name = pkg.name || `@${brief.app.id}/provision`;
  pkg.version = pkg.version || '0.0.1';
  if (pkg.private === undefined) pkg.private = true;
  pkg.type = 'module'; // REQUIRED — tsx/ESM imports break without it.
  // Merge required scripts/deps last so we win over a bare pgpm-init manifest,
  // but keep any extra scripts/deps the scaffold legitimately added.
  pkg.scripts = { ...(pkg.scripts ?? {}), ...PROVISION_SCRIPTS };
  pkg.dependencies = { ...(pkg.dependencies ?? {}), ...PROVISION_DEPS };
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), ...PROVISION_DEV_DEPS };
  return JSON.stringify(pkg, null, 2) + '\n';
}

// ════════════════════════════════════════════════════════════════════════════
// Self-install (doc-gap fix) — make `pnpm run create-db` HANDS-FREE
//
// stampProvisionPkg() (above) regenerates packages/provision/package.json with deps S1's
// `pnpm install` never saw (tsx, @constructive-io/sdk, pg, dotenv, node-type-registry, the
// @types/pg + typescript devDeps). So the very next step the agent runs — `pnpm run create-db`
// (= `tsx src/create-db.ts`) — died with `tsx: command not found`, forcing a manual
// "now run pnpm install again". We close that here: after stamping the manifest we run the
// install OURSELVES, scoped to the workspace + reusing the warm pnpm store so it's fast and
// idempotent. <app> is the WORKSPACE ROOT (the dir holding packages/ — same arg the rest of the
// CLI takes), which is exactly the dir `pnpm install` must run in to re-link the new provision
// deps across the workspace.
// ════════════════════════════════════════════════════════════════════════════

/** Is `tsx` already resolvable for the provision package? The create-db/provision scripts run
 *  `tsx …`, so its bin under the provision package's node_modules/.bin OR the workspace root's is
 *  the precise "already installed" signal. Used to keep the WARM path a no-op (skip the install). */
function tsxResolved(workspaceRoot, provisionDir) {
  const binName = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  for (const base of [provisionDir, workspaceRoot]) {
    if (fs.existsSync(path.join(base, 'node_modules', '.bin', binName))) return true;
  }
  return false;
}

/** A pnpm workspace is installable only if it actually IS one. S1 (`pgpm init workspace`) always
 *  writes pnpm-workspace.yaml (+ pgpm.json) at the root, so their presence is the precondition for
 *  the self-install. This also keeps the scaffolder's own rot canary (check-scaffold.mjs, which
 *  scaffolds into a BARE temp dir that is NOT a workspace) side-effect-free: no workspace marker →
 *  no install attempt. */
function isInstallableWorkspace(workspaceRoot) {
  return ['pnpm-workspace.yaml', 'pgpm.json', 'pnpm-lock.yaml'].some((m) =>
    fs.existsSync(path.join(workspaceRoot, m))
  );
}

/** Run `pnpm install` at the workspace root so the freshly-stamped provision deps (tsx et al.)
 *  are linked BEFORE create-db runs. Idempotent + fast: --prefer-offline reuses the warm store
 *  and skips staleness checks, --ignore-scripts skips lifecycle scripts the provision deps don't
 *  need. NOT --frozen-lockfile (the stamped manifest legitimately changes the workspace deps, so
 *  a frozen lockfile would FAIL). Skipped on --dry-run, when the dir isn't an installable pnpm
 *  workspace (e.g. the rot-canary's bare temp dir), and when tsx already resolves AND the manifest
 *  didn't change (the warm re-run). Non-fatal on failure: we WARN with the exact manual command
 *  rather than aborting the scaffold (the generated files are already on disk; the agent can still
 *  `pnpm install` by hand). */
function selfInstallProvision(workspaceRoot, provisionDir, pkgChanged, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] would run \`pnpm install\` in ${workspaceRoot} (link provision deps so create-db is hands-free)`);
    return;
  }
  if (!isInstallableWorkspace(workspaceRoot)) {
    // No pnpm-workspace.yaml / pgpm.json / lockfile → not a workspace pnpm can install (the
    // scaffolded files are still on disk; S1 normally writes these markers before S2 runs).
    console.log(`  (no pnpm workspace marker at ${workspaceRoot} — skipping self-install; run \`pnpm install\` once the workspace is initialized)`);
    return;
  }
  if (!pkgChanged && tsxResolved(workspaceRoot, provisionDir)) {
    console.log('  provision deps already linked (tsx resolves, manifest unchanged) — skipping self-install');
    return;
  }
  console.log(`  installing provision deps (pnpm install --prefer-offline) in ${workspaceRoot} …`);
  const res = spawnSync('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : `exit ${res.status}`;
    console.warn(
      `  WARN: self-install failed (${why}). The provision files were written, but create-db needs its deps. ` +
        `Run it by hand: (cd ${workspaceRoot} && pnpm install)`
    );
    return;
  }
  if (!tsxResolved(workspaceRoot, provisionDir)) {
    console.warn(
      '  WARN: pnpm install completed but tsx still does not resolve for the provision package — ' +
        `create-db may fail. Check ${path.join(provisionDir, 'package.json')} devDependencies, then re-run \`pnpm install\` in ${workspaceRoot}.`
    );
    return;
  }
  console.log('  provision deps installed — `pnpm run create-db` is hands-free');
}

// ════════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════════

function writeFileIfChanged(filePath, content, dryRun, written) {
  if (dryRun) { written.push(filePath); return; }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  written.push(filePath);
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const [briefPath, appDir] = args;

  if (!briefPath || !appDir) {
    console.error('Usage: node scripts/scaffold-provision.mjs <brief.yaml> <appDir> [--dry-run]');
    process.exit(2);
  }
  if (!fs.existsSync(briefPath)) {
    console.error(`scaffold-provision: brief not found: ${briefPath}`);
    process.exit(2);
  }

  // Load + build inside one BriefError guard so EVERY legible abort — both the
  // validateBrief shape checks (run by loadBrief) AND the generation-time aborts
  // buildBlueprintDefinition raises (e.g. a composite-PK table, which is parsed but
  // has no supported intent) — surfaces as a clean one-line message + exit 1, not an
  // uncaught stack trace.
  let brief;
  let def;
  let mods;
  try {
    brief = loadBrief(briefPath);
    def = buildBlueprintDefinition(brief);
    mods = computeModuleClosure(brief, def.tables);
  } catch (err) {
    if (err instanceof BriefError) {
      console.error(`scaffold-provision: invalid brief — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const srcDir = path.resolve(appDir, 'packages', 'provision', 'src');
  const written = [];

  // 1-3: config (substituted), helpers + blueprint (verbatim)
  const configTs = stampConfig(brief);
  assertNoUnsubstituted('config.ts', configTs);
  writeFileIfChanged(path.join(srcDir, 'config.ts'), configTs, dryRun, written);
  writeFileIfChanged(path.join(srcDir, 'helpers.ts'), readTemplate('helpers.ts'), dryRun, written);
  writeFileIfChanged(path.join(srcDir, 'blueprint.ts'), readTemplate('blueprint.ts'), dryRun, written);

  // 4: create-db (module closure spliced)
  const createDbTs = stampCreateDb(emitModulesLiteral(mods));
  assertNoUnsubstituted('create-db.ts', createDbTs);
  writeFileIfChanged(path.join(srcDir, 'create-db.ts'), createDbTs, dryRun, written);

  // 5: provision (schemas + auth-preset gate)
  const provisionTs = stampProvision(brief);
  assertNoUnsubstituted('provision.ts', provisionTs);
  writeFileIfChanged(path.join(srcDir, 'provision.ts'), provisionTs, dryRun, written);

  // 6: schemas/core.ts (GENERATED BlueprintDefinition)
  writeFileIfChanged(path.join(srcDir, 'schemas', 'core.ts'), emitCoreTs(brief, def) , dryRun, written);

  // 7: packages/provision/package.json (merge required scripts/deps onto the
  // pgpm-init manifest, or write a clean minimal one) so `pnpm run create-db` works.
  const provisionDir = path.resolve(appDir, 'packages', 'provision');
  const pkgPath = path.join(provisionDir, 'package.json');
  let existingPkg;
  let existingPkgRaw = '';
  if (fs.existsSync(pkgPath)) {
    existingPkgRaw = fs.readFileSync(pkgPath, 'utf8');
    try {
      existingPkg = JSON.parse(existingPkgRaw);
    } catch {
      existingPkg = undefined; // unparsable manifest → overwrite with a clean one
    }
  }
  const stampedPkg = stampProvisionPkg(brief, existingPkg);
  // The manifest changed iff its bytes differ — the precise signal that we just added deps S1's
  // install never saw (so the self-install below must run, not no-op).
  const pkgChanged = stampedPkg !== existingPkgRaw;
  writeFileIfChanged(pkgPath, stampedPkg, dryRun, written);

  const verb = dryRun ? 'would write' : 'wrote';
  console.log(`scaffold-provision: ${verb} ${written.length} files into ${srcDir}`);
  for (const f of written) console.log(`  ${path.relative(process.cwd(), f)}`);
  console.log(`  modules: ${mods.length} (preset ${brief.modules?.preset}, flows [${(brief.flows ?? []).join(', ')}])`);
  console.log(`  tables:  ${def.tables.map((t) => t.table_name).join(', ')}`);

  // Surface any security-INCOMPLETE outcomes recorded onto brief.warnings[] by the
  // generator (today: M:N junction AuthzAllowAll coercion, GAP-1d). These are NOT
  // fatal — the app still provisions — but they MUST be visible in the build output so
  // the operator knows the junction is not yet per-row secured. (This print IS the
  // surfacing of brief.warnings[]; live-QA does not read brief.warnings.) Hard,
  // unsupported intents abort earlier with a BriefError.
  const warnings = Array.isArray(brief.warnings) ? brief.warnings : [];
  if (warnings.length) {
    console.warn(`\n  ⚠ ${warnings.length} security warning(s) — review before relying on these surfaces:`);
    for (const w of warnings) {
      const msg = (w && typeof w === 'object') ? (w.message || JSON.stringify(w)) : String(w);
      console.warn(`    - ${msg}`);
    }
    console.warn('');
  }

  // 8: SELF-INSTALL the freshly-stamped provision deps so `pnpm run create-db` is hands-free
  // (tsx et al. were added to the manifest AFTER S1's install). <app> = the WORKSPACE ROOT, which
  // is the dir pnpm install must run in to re-link them. Idempotent + warm-store fast; non-fatal.
  selfInstallProvision(appDir, provisionDir, pkgChanged, dryRun);
}

main();
