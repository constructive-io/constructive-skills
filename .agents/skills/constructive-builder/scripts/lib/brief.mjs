/**
 * scripts/lib/brief.mjs — the single home for app-brief parsing + the
 * intent → blueprint maps the scaffolders share.
 *
 * GENERIC BY CONSTRUCTION. Nothing here hard-codes `todos` or `email-password`
 * as a value: the brief drives everything.
 *
 * As of the structural decomposition this is a THIN FACADE: the implementation
 * lives in four cohesive modules, and this file re-exports their public surface
 * UNCHANGED (so every importer — scaffold-provision/frontend, live-qa, and the
 * check-* canaries — keeps importing the SAME names from `./lib/brief.mjs`). The
 * only original logic that still lives HERE is §9 (app-identity resolution), which
 * bridges the brief parser with the config/psql layer:
 *   - brief-yaml.mjs       §1  parseBrief — the ZERO-DEP YAML reader.
 *   - brief-policy.mjs     §2  validateBrief — fail-fast brief validation.
 *                          §3  POLICY_INTENTS — policy-intent → { nodes[], policies[] }.
 *                          §4  RESTRICT_MODIFIERS — restrict tag → fields + restrictive policy.
 *                          §5  FEATURE_NODES — feature tag → a data-behavior node (+field/fts).
 *                          §6  NODE_MODULE_DEPS — node $type → module deps.
 *                          §7  presetBaseModules / flowModules / computeModuleClosure.
 *   - brief-blueprint.mjs  §8  buildTableDefinition / buildRelation / buildBlueprintDefinition.
 *   - (this file)          §9  loadBrief / resolveAppId / subdomainFor.
 *
 * The maps are the generator's CORE KNOWLEDGE. They emit the COMMON CASE as
 * explicit literal arrays; the long tail is reached via the brief's `nodes_raw` /
 * `policies_raw` escape hatches (passed through verbatim) and `// TODO: advanced`
 * seams the emitter writes. See:
 *   - constructive-blueprints/references/blueprint-definition-format.md (every key)
 *   - constructive-security/references/authz-types.md (the 20 Authz* shapes)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getHubDatabase } from './config.mjs';

import { parseBrief } from './brief-yaml.mjs';
import { validateBrief } from './brief-policy.mjs';

// ── Re-export the full public surface (unchanged) ────────────────────────────
// §1 YAML reader
export { parseBrief } from './brief-yaml.mjs';
// §2–§7 policy kernel + module closure
export {
  validateBrief,
  POLICY_INTENTS,
  RESTRICT_MODIFIERS,
  FEATURE_NODES,
  NODE_MODULE_DEPS,
  APP_DOMAIN_SCHEMA_SENTINEL,
  loadFlows,
  flowModules,
  presetBaseModules,
  computeModuleClosure,
  BriefError,
} from './brief-policy.mjs';
// §8 blueprint assembly
export {
  buildTableDefinition,
  buildRelation,
  buildBlueprintDefinition,
} from './brief-blueprint.mjs';

// ════════════════════════════════════════════════════════════════════════════
// 1. BRIEF LOADER (parse + validate)
// ════════════════════════════════════════════════════════════════════════════

/** Read + parse a brief file from disk. */
export function loadBrief(briefPath) {
  const text = fs.readFileSync(briefPath, 'utf8');
  const brief = parseBrief(text);
  validateBrief(brief, briefPath);
  return brief;
}

// ════════════════════════════════════════════════════════════════════════════
// 9. APP-IDENTITY RESOLUTION (the single home for the db_name → APP_ID derivation
//    and the subdomain precedence the .sh phase scripts share)
// ════════════════════════════════════════════════════════════════════════════
// These centralize two identity derivations that were copy-pasted across the .sh
// scripts (golden-path / genericity-check / verify-phase): turning a brief's
// db_name into the per-app build-state id (APP_ID), and resolving the GraphQL
// subdomain for a database. .sh callers reach them through `node -e` exactly like
// they reach config.mjs/ports.mjs, so there is one definition, not three.

/** Sanitize a db_name into the per-app build-state id: plain lowercase [a-z0-9].
 *  Mirrors the historical `gsub(/[^a-z0-9]/,"",v)` the .sh scripts ran on db_name. */
function sanitizeAppId(dbName) {
  return String(dbName == null ? '' : dbName).replace(/[^a-z0-9]/g, '');
}

/**
 * resolveAppId(brief) → the per-app build-state id derived from the brief's db_name
 * (the brief's `naming.db_name`, else a top-level `db_name`), sanitized to plain
 * lowercase [a-z0-9]. Returns '' when no db_name is present.
 *
 * `brief` may be EITHER a parsed brief object OR the raw YAML text (the form the
 * .sh scripts have on hand — a file's contents); a string is parsed with the same
 * comment-aware parseBrief the rest of this module uses. TOLERANT by design: any
 * parse/shape problem yields '' (never throws), matching the old awk's
 * `2>/dev/null || true` behaviour so an unreadable brief just leaves APP_ID unset
 * and the caller falls back to the legacy singleton build/ path.
 *
 * This replaces the duplicated
 *   awk -F': ' '$1 ~ /^[[:space:]]*db_name$/ {v=$2; gsub(/[^a-z0-9]/,"",v); print v; exit}'
 * across golden-path.sh / genericity-check.sh / verify-phase.sh. It is also MORE
 * correct than that awk on a db_name line carrying a trailing `# comment` (the awk
 * concatenated the comment words into the id); real briefs carry no such comment so
 * the resolved id is byte-identical for every brief those scripts actually use.
 */
export function resolveAppId(brief) {
  let obj = brief;
  if (typeof brief === 'string') {
    try {
      obj = parseBrief(brief);
    } catch {
      return '';
    }
  }
  if (!obj || typeof obj !== 'object') return '';
  const db = (obj.naming && obj.naming.db_name != null) ? obj.naming.db_name
    : (obj.db_name != null ? obj.db_name : '');
  return sanitizeAppId(db);
}

/** Read `database.subdomain` from a run-state JSON file; '' if absent/unreadable. */
function subdomainFromState(statePath) {
  if (!statePath) return '';
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return (s && s.database && s.database.subdomain) ? String(s.database.subdomain) : '';
  } catch {
    return '';
  }
}

/** Query the platform metaschema for a database's provisioned subdomain; '' on any
 *  failure (no psql, no row, hub down). Mirrors verify-phase.sh's psql lookup verbatim. */
function subdomainFromPlatform(dbName, hubDatabase) {
  if (!dbName) return '';
  const sql =
    'SELECT dpm.subdomain ' +
    'FROM metaschema_modules_public.database_provision_module dpm ' +
    'JOIN metaschema_public.database d ON d.id = dpm.database_id ' +
    `WHERE d.name = '${dbName}';`;
  try {
    const out = execFileSync('psql', ['-d', hubDatabase, '-t', '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.replace(/\s+/g, ''); // tr -d ' ' (+ trim the trailing newline psql -t leaves)
  } catch {
    return '';
  }
}

/**
 * subdomainFor(dbName, opts?) → the GraphQL subdomain for a database, following the
 * SAME precedence verify-phase.sh's resolve_subdomain uses:
 *   1. the run-state's stored `database.subdomain` (opts.statePath, else $STATE_PATH),
 *   2. the platform metaschema lookup (psql against the hub database),
 *   3. fall back to dbName itself.
 *
 * opts:
 *   statePath    — run-state JSON to read the stored subdomain from
 *                  (defaults to process.env.STATE_PATH, the var the .sh scripts export)
 *   hubDatabase  — the hub Postgres database to query (defaults to
 *                  process.env.PG_HUB_DATABASE, else config db.hubDatabase, else 'constructive')
 *   noFallback   — when true, return '' (instead of dbName) if neither the run-state nor
 *                  the platform lookup resolved a subdomain. This lets a caller apply its
 *                  OWN fallback + side effects (verify-phase.sh emits a `warn` on pure
 *                  fallback, which it can only do if it can tell resolution failed). The
 *                  default (false) keeps the documented 3-step precedence ending in dbName.
 *
 * TOLERANT: a missing state file / absent psql / down hub each fall through to the
 * next step, so the worst case is the dbName fallback (or '' with noFallback) — never a throw.
 */
export function subdomainFor(dbName, opts = {}) {
  const statePath = opts.statePath != null ? opts.statePath : process.env.STATE_PATH;
  // 1. run-state
  const fromState = subdomainFromState(statePath);
  if (fromState) return fromState;
  // 2. platform lookup
  const hubDatabase = opts.hubDatabase != null ? opts.hubDatabase
    : (process.env.PG_HUB_DATABASE || resolveHubDatabase());
  const fromPlatform = subdomainFromPlatform(dbName, hubDatabase);
  if (fromPlatform) return fromPlatform;
  // 3. db-name fallback (or '' when the caller wants to own the fallback)
  if (opts.noFallback) return '';
  return String(dbName == null ? '' : dbName);
}

/** Resolve the hub Postgres database name via the single config loader (config.mjs's
 *  getHubDatabase), which applies the SAME env override (CONSTRUCTIVE_HUB_DATABASE) and
 *  'constructive' default. Wrapped in a tolerant try/catch so a missing/unreadable
 *  constructive.config.json still falls back to 'constructive' (the historical behavior),
 *  keeping subdomainFor a never-throw resolver. */
function resolveHubDatabase() {
  try {
    return getHubDatabase();
  } catch {
    return 'constructive';
  }
}
