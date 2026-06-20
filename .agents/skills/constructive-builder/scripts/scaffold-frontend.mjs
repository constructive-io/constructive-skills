#!/usr/bin/env node
/**
 * scripts/scaffold-frontend.mjs <brief> <appDir>
 *
 * Brief → the per-entity domain UI as a WORKING SKELETON TO AUTHOR FROM, AFTER Phase-3
 * codegen has produced the typed SDK hooks (@sdk/app). Runs at PHASE 4 (see scaffold-app.mjs
 * for the staging).
 *
 * SKELETON, NOT FINAL UI. Everything below emits the FUNCTIONAL contract — the data wiring,
 * the testids, the four list states, row-scoping, the RLS scoping, and the Blocks mounts —
 * correct and working, so the app FUNCTIONS and composes with Blocks. The DEFAULT presentation
 * is a neutral, replaceable starting point. The frontend phase is then: AUTHOR the presentation
 * faithfully from the app's design.md (customize/replace stock components, set the type, compose
 * the layout, intentional hierarchy/spacing/ornament, subtle + reduced-motion). The ONLY hard
 * rails are (1) this FUNCTIONAL contract and (2) the shadcn-token contract (Blocks read tokens by
 * name). See references/art-direction.md for the authoring playbook + the full preserve list.
 *
 * It does SIX things, each independently idempotent (re-running is a safe no-op):
 *   (a) CRUD INFRA (once) — stamps the runtime-generic meta-form stack from
 *       scripts/templates/frontend/crud/* into <app>/src/{components/crud,lib/meta,types}.
 *       This is the REUSE: DynamicFormCard / useMeta / DynamicField are schema-driven
 *       (introspect `_meta` at runtime) — NOT a bespoke per-table form. The two
 *       `__APP_ENDPOINT__` placeholders are rewired to the app's runtime
 *       `getEndpoint('app')` (the per-DB app-public endpoint) so nothing bakes a URL.
 *       DynamicFormCard's Delete affordance is delete-mode-aware: a HARD delete when
 *       the table exposes a root delete mutation, else a SOFT delete (an UPDATE that
 *       sets the DataSoftDelete `is_deleted` flag) for soft-delete tables — so the
 *       Delete button never vanishes just because a table is soft-delete.
 *   (b) ENTITY PAGES — per `ui.routes[].kind: crud`, emits a thin
 *       <app>/src/app/<entity>/page.tsx from templates/frontend/entity-page.tsx:
 *       a typed quick-add + list (the codegen'd SDK hooks) plus DynamicFormCard on
 *       the CRUD Stack for edit/detailed-create. The entity name → SDK hook names +
 *       generic `<entity>-*` testids. `entity: todo` reproduces the canary's
 *       `todo-*` testids with ZERO special-casing.
 *   (c) ROUTES + NAV — idempotently appends a route entry to src/app-routes.ts
 *       (APP_ROUTES, access:'protected', context:'app') and a NavItem to
 *       src/lib/navigation/sidebar-config.ts. Skips entries already present.
 *   (d) NON-CRUD STUBS — kind: dashboard|detail|custom → a stub page with a
 *       `// TODO: custom UI — build with @constructive-io/ui; see constructive-frontend`
 *       seam + the route entry. (No nav item unless it is a primary surface.)
 *   (e) AUTH BRIDGE PAGES — when `flows` include `email-password`, emits the
 *       /sign-in + /sign-up route wrappers (the block→route + host-token-persist
 *       bridge) from templates/frontend/auth-page.tsx.
 *   (f) FLOW-BLOCK MOUNTING — the #1 harness fix. The Blocks on-ramp installs each
 *       flow's blocks as COMPONENTS, but nothing mounts them at a reachable,
 *       testid-carrying Next route — so a multi-flow app provisions auth/account/org
 *       capability that is unreachable from the UI. Step (f) closes that GENERICALLY:
 *       driven by FLOW_SURFACES (which mirrors references/flows.json) + the brief's
 *       flows[], it aggregates the account-session blocks onto ONE /account page,
 *       mounts each authorization flow at a /org/<sub> route, stamps the dedicated
 *       link-landing pages (verify-email / reset-password / delete-account / invite,
 *       skipped when the base template already ships them), seams the auth-form
 *       add-ons (cross-origin / social-oauth) into /sign-in, and writes
 *       build/flow-surfaces.json (the surface manifest the live-QA driver reads).
 *       Component names / import paths / props are sourced VERBATIM from each flow's
 *       howto.usage. Everything is GATED on the flow being in brief.flows, so the
 *       canary (flows: [email-password]) emits ZERO new pages.
 *
 * Auth/account/org UI is the Blocks on-ramp (scripts/wire-app.mjs + `shadcn add` of
 * the flow's blocks); this scaffolder owns the domain-entity surface (a–d) AND, via
 * step (f), the block→route MOUNTING that makes those installed blocks reachable. It
 * does NOT re-implement the blocks — it mounts the registry blocks the on-ramp adds.
 *
 * GENERIC BY CONSTRUCTION. Everything is read from the brief. Nothing here
 * hard-codes `todo`/`todos` (or any domain) as a value — the per-entity emission
 * derives every identifier (hook names, testids, the `_meta` table type, route key,
 * nav label) from `ui.routes[].entity` + the matching `data_model.tables[]`, and the
 * flow mounting derives every surface from `flows[]` + FLOW_SURFACES (no flow id is
 * special-cased; adding a flow = adding a FLOW_SURFACES entry).
 *
 * STRUCTURE. This file is the THIN ORCHESTRATOR — arg parse, the per-route loop (b–d),
 * then steps (e)+(f). The generation logic lives in cohesive modules under
 * scripts/lib/scaffold-frontend/ (each re-exported VERBATIM from its prior home so the
 * emitted output is byte-identical), plus the shared inflection in scripts/lib/inflect.mjs:
 *   inflect.mjs            words/pascal/camel/kebab/titleCase/pluralize/entityIdentifiers/
 *                          singularFromTable (shared with live-qa.mjs).
 *   paths.mjs              TEMPLATES_DIR / CRUD_/FLOWS_TEMPLATES_DIR / BUILD_DIR.
 *   writers.mjs            readTemplate / write / skip / rel / escapeRegex / indentBlock /
 *                          assertNoUnsubstituted.
 *   codegen-columns.mjs    the codegen-actual column mapper (SG-A for columns).
 *   fields.mjs             title/selection/create-extra/temporal/soft-delete field derivation.
 *   scoping.mjs            the per-policy create-scope seams + the scoping const strings.
 *   relations-fk.mjs       belongsToFks + buildFkSeams (the FK picker).
 *   relations-m2m.mjs      manyToManyRelations + the relation-manager emitter (N:M links).
 *   entity-page.mjs        emitEntityPage / emitStubPage / tableFor.
 *   routes-nav.mjs         routeSegments / routeKey / appendRoute / appendNavItem.
 *   auth-pages.mjs         emitAuthPages — the /sign-in + /sign-up bridge (step e).
 *   step-up.mjs            the StepUpProvider provider-ordering reconcile.
 *   flow-surfaces.mjs      FLOW_SURFACES + the account/org/flow-surface emitters + manifest.
 *
 * Usage:
 *   node scripts/scaffold-frontend.mjs build/app-brief.yaml ./my-app
 *   node scripts/scaffold-frontend.mjs build/app-brief.yaml ./my-app --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadBrief, BriefError } from './lib/brief.mjs';

import { titleCase, kebab } from './lib/inflect.mjs';
import { CRUD_TEMPLATES_DIR } from './lib/scaffold-frontend/paths.mjs';
import { readTemplate, write, skip, rel } from './lib/scaffold-frontend/writers.mjs';
import { belongsToFks } from './lib/scaffold-frontend/relations-fk.mjs';
import { manyToManyRelations } from './lib/scaffold-frontend/relations-m2m.mjs';
import { emitEntityPage, emitStubPage, tableFor } from './lib/scaffold-frontend/entity-page.mjs';
import { appendRoute, appendNavItem } from './lib/scaffold-frontend/routes-nav.mjs';
import { emitAuthPages } from './lib/scaffold-frontend/auth-pages.mjs';
import { emitFlowSurfaces } from './lib/scaffold-frontend/flow-surfaces.mjs';
import { parseDesignMd } from './lib/design/design-md.mjs';

// ════════════════════════════════════════════════════════════════════════════
// App-dir detection — mirror verify-phase.sh app_rel(): the app may live at
// <appDir>/app OR <appDir>/packages/app (the pgpm nextjs template nests it).
// Returns the `src` dir (the canonical app source root).
// ════════════════════════════════════════════════════════════════════════════

function resolveAppSrc(appDir) {
  const candidates = [
    path.join(appDir, 'app', 'src'),
    path.join(appDir, 'packages', 'app', 'src'),
    path.join(appDir, 'src'), // appDir already points at the app package
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Default to packages/app/src (the template's nested layout) so a fresh dir
  // still gets a deterministic target; the caller wires this at Phase 4 when the
  // scaffold already exists, so this branch is the genuinely-empty fallback.
  return path.join(appDir, 'packages', 'app', 'src');
}

// ════════════════════════════════════════════════════════════════════════════
// DENSITY RESOLUTION (generic, robust to WHERE the agent recorded the dial).
//
// The DENSITY dial drives LAYOUT density (see entity-page.mjs DENSITY_SCALES). The
// canonical home for the dials is the brief: `brief.design.dials.density`. But an
// auto-propose agent may instead record the dials in the EMITTED design.md (the
// durable, lint-gated design record) under its frontmatter `dials:` map. Either home
// must "just work". So density resolves in this order:
//   1. brief.design.dials.density            (the canonical, single source of truth)
//   2. <emitted design.md>.dials.density     (fallback — same convention wire-design
//                                             uses to discover a design.md next to the app)
// Anything else ⇒ undefined ⇒ entity-page.mjs defaults to the 'cozy' tier (the
// pre-wave literals) so a design-less build is byte-identical. GENERIC: density is a
// single integer/tier name — no entity/app literal is ever read here.
// ════════════════════════════════════════════════════════════════════════════

/** Discover an emitted design.md next to the app, mirroring wire-design's discovery
 *  order. Returns the parsed frontmatter object, or null when none is found. */
function discoverDesignMdFrontmatter(appDir) {
  const candidates = [
    path.join(appDir, 'design.md'),
    path.join(appDir, '..', 'design.md'),
    path.join(appDir, 'app', 'design.md'),
    path.join(appDir, 'packages', 'app', 'design.md'),
  ];
  for (const cand of candidates) {
    if (!fs.existsSync(cand)) continue;
    try {
      return parseDesignMd(fs.readFileSync(cand, 'utf8')).frontmatter || null;
    } catch {
      // A malformed design.md is not fatal for scaffolding — fall through to the
      // 'cozy' default rather than abort the whole frontend emit.
      return null;
    }
  }
  return null;
}

/** Resolve the DENSITY dial from the brief, falling back to an emitted design.md's
 *  `dials.density`. Returns the raw dial (number | tier string) or undefined; the
 *  page emitters clamp/default it (resolveDensity). GENERIC — no entity input. */
function resolveDensityDial(brief, appDir) {
  const fromBrief = brief.design?.dials?.density;
  if (fromBrief != null) return fromBrief;
  const fm = discoverDesignMdFrontmatter(appDir);
  return fm?.dials?.density;
}

// ════════════════════════════════════════════════════════════════════════════
// (a) CRUD infra — the runtime-generic meta-form stack
// ════════════════════════════════════════════════════════════════════════════

/**
 * (a) Stamp the runtime-generic CRUD infra ONCE. Rewrites the two
 * `__APP_ENDPOINT__` placeholders to the app's runtime endpoint resolver
 * (getEndpoint('app')) so the meta-form stack hits the per-DB app-public endpoint
 * with no baked URL. Idempotent: skips files already present.
 */
function stampCrudInfra(srcDir, ctx) {
  const targets = [
    // template-name, destination (relative to src)
    ['meta-types.ts', path.join('types', 'meta.ts')],
    ['field-renderer.ts', path.join('lib', 'meta', 'field-renderer.ts')],
    ['use-meta.ts', path.join('lib', 'meta', 'use-meta.ts')],
    ['dynamic-field.tsx', path.join('components', 'crud', 'dynamic-field.tsx')],
    ['dynamic-form-card.tsx', path.join('components', 'crud', 'dynamic-form-card.tsx')],
  ];

  for (const [tpl, rel] of targets) {
    const dest = path.join(srcDir, rel);
    if (fs.existsSync(dest)) {
      skip(dest, ctx);
      continue;
    }
    let body = readTemplate(CRUD_TEMPLATES_DIR, tpl);
    body = rewireEndpoint(body);
    write(dest, body, ctx);
  }
}

/**
 * Rewire the `__APP_ENDPOINT__` endpoint constant to the app's runtime resolver.
 *
 * The boilerplate already resolves the per-DB app-public GraphQL endpoint at
 * runtime (UI override → NEXT_PUBLIC_APP_ENDPOINT → api-<db>.localhost) via
 * getEndpoint('app') in @/app-config — there is NO single static URL to bake. So
 * instead of substituting a literal, we swap the placeholder const for a call to
 * that resolver. This keeps the CRUD infra portable across every app/db without a
 * codegen step, and stays correct under endpoint overrides.
 *
 * If a future template variant pins a literal endpoint instead, set
 * SCAFFOLD_APP_ENDPOINT and we substitute that verbatim (escape hatch).
 */
function rewireEndpoint(body) {
  const literal = process.env.SCAFFOLD_APP_ENDPOINT;
  if (literal) {
    return body.replace(/__APP_ENDPOINT__/g, literal);
  }
  // Replace the declaration line with a runtime-resolved getter. The const name
  // (APP_ENDPOINT) and every use site stay valid; only its value changes from a
  // baked string to a function call.
  const decl = /const APP_ENDPOINT = '__APP_ENDPOINT__';/;
  if (decl.test(body)) {
    body = body.replace(
      decl,
      "import { getEndpoint } from '@/app-config';\n" +
        '// The per-DB app-public GraphQL endpoint, resolved at runtime (UI override →\n' +
        '// NEXT_PUBLIC_APP_ENDPOINT → api-<db>.localhost). No baked URL — see scaffold-frontend.mjs.\n' +
        "const APP_ENDPOINT = getEndpoint('app');",
    );
  } else if (body.includes('__APP_ENDPOINT__')) {
    // Shape drifted (the decl line moved). Fail loud rather than ship a literal
    // placeholder into the app — the caller can set SCAFFOLD_APP_ENDPOINT.
    throw new Error(
      'scaffold-frontend: a crud template still contains __APP_ENDPOINT__ but the ' +
        "`const APP_ENDPOINT = '__APP_ENDPOINT__';` anchor moved. Restore the anchor in " +
        'scripts/templates/frontend/crud/* or set SCAFFOLD_APP_ENDPOINT to a literal endpoint.',
    );
  }
  return body;
}

// ════════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════════

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const [briefPath, appDir] = args;

  if (!briefPath || !appDir) {
    console.error('Usage: node scripts/scaffold-frontend.mjs <brief.yaml> <appDir> [--dry-run]');
    process.exit(2);
  }
  if (!fs.existsSync(briefPath)) {
    console.error(`scaffold-frontend: brief not found: ${briefPath}`);
    process.exit(2);
  }

  let brief;
  try {
    brief = loadBrief(briefPath);
  } catch (err) {
    if (err instanceof BriefError) {
      console.error(`scaffold-frontend: invalid brief — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const srcDir = resolveAppSrc(appDir);
  const ctx = { dryRun, written: [], skipped: [], warnings: [] };

  // DESIGN DENSITY (generic, dial-driven). The DENSITY dial (1–10) sets the spacing/padding/
  // rhythm scale the generated CRUD + stub pages bake into their Tailwind classes at emit time.
  // It is resolved from the canonical brief.design.dials.density, OR (fallback) from an emitted
  // design.md's `dials.density` next to the app — so density "just works" regardless of which home
  // an auto-propose agent recorded the dials in. Absent ⇒ undefined ⇒ the emitters default to the
  // 'cozy' tier, which reproduces the historical spacing literals, so a brief with no design block
  // emits byte-identical pages. No entity/app literal is involved — density is a single number that
  // maps to a generic scale. See resolveDensityDial() for the resolution order.
  const density = resolveDensityDial(brief, appDir);

  const routes = brief.ui?.routes ?? [];
  const crudRoutes = routes.filter((r) => (r.kind || 'crud') === 'crud');

  // (a) CRUD infra — stamp once iff there is at least one CRUD route to use it.
  if (crudRoutes.length > 0) {
    stampCrudInfra(srcDir, ctx);
  }

  // (b)+(c)+(d) per route. `consumedTables` tracks which data_model tables CRUD routes
  // have already bound, so tableFor's positional fallback (SG-A) never binds two routes to
  // the same alias table.
  const consumedTables = new Set();
  for (const route of routes) {
    const kind = route.kind || 'crud';
    if (kind === 'crud') {
      const table = tableFor(brief, route, consumedTables);
      if (table?.name) consumedTables.add(table.name);
      // Pass srcDir + ctx so the FK input key + the parent label field derive from the
      // codegen-actual SDK column names (SG-A for columns), not the brief-derived camelCase.
      const fks = belongsToFks(brief, table, srcDir, ctx);
      // The N:M relations THIS table owns (source side) → a relation-manager section per
      // junction. [] for a non-N:M table → the page emits no manager (byte-identical canary).
      // srcDir + ctx so the linked table's label column resolves to its codegen-actual name.
      const m2mRels = manyToManyRelations(brief, table, srcDir, ctx);
      const { label } = emitEntityPage(srcDir, route, table, ctx, fks, m2mRels, density);
      appendRoute(srcDir, route, ctx, { context: 'app', access: 'protected' });
      appendNavItem(srcDir, route, label, ctx);
    } else {
      emitStubPage(srcDir, route, ctx, density);
      // A primary dashboard at '/' is the root — don't add a route/nav (the root
      // already exists). Other non-CRUD surfaces get a protected route entry.
      if (route.path && route.path !== '/') {
        appendRoute(srcDir, route, ctx, { context: 'app', access: 'protected' });
        appendNavItem(srcDir, route, route.label || titleCase(kebab(route.path)), ctx);
      }
    }
  }

  // (e) AUTH ROUTES — sign-in + sign-up wrappers for the email-password flow (gap #4):
  // the block→route + host-token-persist bridge so the RouteGuard sees an authed
  // session. No-op unless `email-password` is a chosen flow.
  emitAuthPages(srcDir, brief, crudRoutes, ctx);

  // (f) FLOW-BLOCK MOUNTING — mount each brief flow's installed blocks on a reachable,
  // testid-carrying surface (the #1 harness bug), and write build/flow-surfaces.json.
  // GATED on brief.flows → the canary (flows: [email-password]) emits ZERO new pages.
  emitFlowSurfaces(srcDir, brief, crudRoutes, ctx);

  // Report
  const verb = dryRun ? 'would write' : 'wrote';
  console.log(`scaffold-frontend: ${verb} ${ctx.written.length} files, skipped ${ctx.skipped.length} (already present) into ${rel(srcDir)}`);
  for (const f of ctx.written) console.log(`  + ${rel(f)}`);
  for (const f of ctx.skipped) console.log(`  = ${typeof f === 'string' ? f : rel(f)} (exists)`);
  for (const w of ctx.warnings) console.warn(`  ! ${w}`);
  console.log(`  routes: ${routes.length} (${crudRoutes.length} crud) for app at ${rel(srcDir)}`);
  if (ctx.warnings.length) {
    console.warn('scaffold-frontend: completed WITH warnings (see ! lines) — some route/nav appends were skipped; wire them by hand (see constructive-frontend).');
  }
}

main();
