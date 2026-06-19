#!/usr/bin/env node
/**
 * check-harness-drift.mjs — endpoint + CONFIG-DRIFT guard for the agentic-flow
 * Blocks build toolkit.
 *
 * Where check-flows.mjs guards the flow CATALOG (hash parity across copies),
 * this guards two flat, easy-to-rot CONVENTIONS that the Blocks on-ramp depends
 * on. It scans the toolkit docs (*.md) + scripts (*.sh, *.mjs) under the repo
 * root and asserts:
 *
 *   (a) NO doc/script names `app-public-<sub>` (or `app-public-${...}`)
 *       as a GraphQL / DATA endpoint. The per-DB data endpoint is `api-<sub>`
 *       (Host header routes); the `app-public-<sub>` host is DEAD.
 *       ALLOW-LISTED (NOT flagged):
 *         - the Postgres schema-family token `${SCHEMA_PREFIX}-app-public`
 *           (also `<prefix>-app-public`, `%-app-public`) — a schema name,
 *           not a host,
 *         - the codegen output filename `app-public.graphql`,
 *         - SDK directory paths like `<db>-sdk/app-public` / `src/app-public/`,
 *         - the CLI flag name `--app-public` (verify-graphql-contract.mjs),
 *         - explicit "app-public is dead / do NOT use" redirect lines.
 *
 *   (b) every infra PORT literal AGREES WITH constructive.config.json. This is a
 *       CONFIG-AWARE lint, not a hardcoded-constant assertion: the registry / app
 *       / hub ports are read from the config (env-overridable) and a literal that
 *       DISAGREES with the configured value — in a line that is plainly about that
 *       service (a served URL, a port default, a serve/registry/dev-server line) —
 *       is flagged as config drift. The check catches a real regression in BOTH
 *       directions: a stray hardcoded port that contradicts the config (e.g. a
 *       served URL on `:4000` while registry.port is 4081), AND a stale literal
 *       left behind after the config value moved (e.g. config bumped to 5000 but a
 *       served URL still says `:4081`). Because the config makes every coordinate
 *       overridable, two shapes are NOT drift and are allow-listed:
 *         - an env-override DEMO: a port assigned to the service's own override
 *           variable (`REGISTRY_PORT=4099 …`, `CONSTRUCTIVE_APP_PORT_BASE=5050 …`) —
 *           that is the documented way to relocate the stack, so the RHS may differ,
 *         - a `${VAR:-<default>}` / `cfg key <default>` fallback whose default
 *           EQUALS the configured value (it agrees with config by construction).
 *
 * Zero runtime deps beyond the sibling lib/config.mjs loader. Pure Node (>=18).
 * Run from anywhere (auto-roots via this script's dir), or pass --root:
 *
 *   node check-harness-drift.mjs                  # scan this toolkit
 *   node check-harness-drift.mjs --root /path     # scan a different toolkit root
 *   node check-harness-drift.mjs --json           # machine-readable report
 *   node check-harness-drift.mjs --help
 *
 * Exit codes (mirroring check-flows.mjs):
 *   0  clean — no config drift
 *   1  DRIFT — at least one violation (each printed as file:line + text + fix)
 *   2  could not run (bad args / root unreadable / config unreadable)
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRegistryPort,
  getAppPortBase,
  getAppDevPortBase,
  getHubPort,
  getHubPrivatePort,
  getValue,
} from './lib/config.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// reporting (mirrors check-flows.mjs / check-sdk.mjs)
// ---------------------------------------------------------------------------
const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m` }
  : { red: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s, yellow: (s) => s };

function fail(code, msg) {
  console.error(`${C.red('✗')} ${msg}`);
  process.exit(code);
}

const HELP = `check-harness-drift.mjs — endpoint + config-drift guard for the Blocks build toolkit.

Usage:
  node check-harness-drift.mjs [--root DIR] [--json] [--help]

  --root DIR   toolkit root to scan (default: the repo this script lives in)
  --json       emit a machine-readable report
  --help       show this help

Checks:
  (a) no doc/script names app-public-<sub> as a GraphQL/DATA endpoint
      (allow-listed: \${SCHEMA_PREFIX}-app-public schema token, app-public.graphql
       codegen filename, SDK dir paths, the --app-public flag, "dead/do NOT use" lines)
  (b) every infra PORT literal AGREES with constructive.config.json (registry / app /
      hub ports). A literal that DISAGREES with the configured value in a line about
      that service is flagged as config drift. Allow-listed: an env-override demo
      (PORT assigned to the service's own override var) and a \${VAR:-<default>} /
      cfg-fallback whose default equals the configured value.

Exit codes: 0 clean · 1 config drift · 2 can't run.
Fix: align the offending value with constructive.config.json (or with api-<sub> for the
data endpoint); to relocate a coordinate, change the config (or its override env var),
not a hardcoded literal.`;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { root: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '-r') opts.root = resolve(argv[++i] ?? '.');
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else { fail(2, `unknown argument: ${a}\n\n${HELP}`); }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// file walk — collect harness docs + scripts, skipping vendored / build dirs.
// ---------------------------------------------------------------------------
const SCAN_EXTS = new Set(['.md', '.sh', '.mjs']);
// Vendored / build dirs skipped by exact name. The scan must only cover TRACKED
// harness sources — never the run-local + generated artifact trees a build leaves
// behind. `.run/` (run-state), `build/` (generated per-app dirs `build/<app>/`),
// and `dist/.next/coverage` are all such artifacts; a stray endpoint/port in a
// generated app is not harness drift.
const SKIP_DIRS = new Set(['node_modules', '.git', '.run', 'dist', 'build', '.next', 'coverage']);
// Scratch/working trees are named `.scratch-<purpose>` (e.g. .scratch-stress) —
// a glob, not a fixed name — so they get a prefix test rather than a set entry.
// Their contents are throwaway experiments, not tracked harness sources.
const SKIP_DIR_PREFIXES = ['.scratch'];

function shouldSkipDir(name) {
  if (SKIP_DIRS.has(name)) return true;
  return SKIP_DIR_PREFIXES.some((p) => name.startsWith(p));
}
// This script must never flag ITSELF (it necessarily names the very tokens it bans).
const SELF = basename(fileURLToPath(import.meta.url));

function collectFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!shouldSkipDir(e.name)) stack.push(full);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf('.');
        const ext = dot === -1 ? '' : e.name.slice(dot);
        if (SCAN_EXTS.has(ext) && e.name !== SELF) out.push(full);
      }
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// (a) app-public-<sub> as a GraphQL/DATA endpoint.
//
// FLAG when a line contains a HOST-SHAPED app-public token:
//   - `app-public-<sub>.localhost`  (the dead per-DB data host), or
//   - `app-public-<sub>` immediately followed (within the same URL) by a
//     `/graphql` path or `localhost:PORT`.
// `<sub>` is any subdomain-ish token: <db>, ${...}, $VAR, xxx, a real name, etc.
//
// ALLOW (never flagged), checked BEFORE the host test:
//   - the line is an explicit redirect ("dead", "NOT", "do not", "legacy", …)
//     or names the --app-public CLI flag,
//   - the only app-public hits on the line are schema-family tokens
//     (`<x>-app-public` with a non-host left neighbour) or the codegen filename
//     `app-public.graphql` or an SDK path (`…/app-public/…`, `…/app-public.`).
// The host regex itself only matches the host shape, so schema tokens /
// filenames / SDK paths don't match it; the redirect/flag allow-list covers the
// remaining legitimate prose that DOES mention a host (the "do NOT use
// app-public-<sub>" teaching lines).
// ---------------------------------------------------------------------------

// Host-shaped: `app-public-<token>.localhost`  OR  `app-public-<token>` directly
// inside a graphql URL (…app-public-x.localhost… already covered; also catch a
// bare `app-public-x:PORT` / `app-public-x/graphql`). <token> excludes `.`,`/`,
// whitespace, quotes, backticks so it can't span out of the host segment.
const HOST_APP_PUBLIC = /app-public-[^\s.`'"/)]+(?:\.localhost|:\d|\/graphql)/;

// Redirect / teaching / flag contexts that legitimately NAME the dead host to
// warn against it. Case-insensitive substrings on the whole line.
const REDIRECT_HINTS = [
  'dead',
  'do not',
  "don't",
  'does not',
  'is not',
  'not `app-public', // "NOT `app-public-<sub>`"
  'not app-public',
  'not assume',
  "don't assume",
  'legacy',
  'was app-public',
  'override',
  '--app-public', // the CLI flag name (verify-graphql-contract.mjs / verify-phase.sh feed api-<sub> through it)
  'no longer',
  'instead of',
];

function lineIsAppPublicRedirect(line) {
  const low = line.toLowerCase();
  return REDIRECT_HINTS.some((h) => low.includes(h.toLowerCase()));
}

function checkAppPublicEndpoint(line) {
  if (!HOST_APP_PUBLIC.test(line)) return null; // no host-shaped app-public token
  if (lineIsAppPublicRedirect(line)) return null; // explicit "dead / do NOT use" / flag line
  const m = line.match(HOST_APP_PUBLIC);
  return {
    rule: 'app-public-endpoint',
    text: (m && m[0]) || line.trim(),
    fix: 'the per-DB DATA/GraphQL endpoint is api-<sub> (http://api-<sub>.localhost:3000/graphql; Host header routes). app-public-<sub> is DEAD — rename it to api-<sub>, or, if this is a teaching line, make it an explicit "app-public-<sub> is dead, do NOT use" redirect.',
  };
}

// ---------------------------------------------------------------------------
// (b) config-aware port drift.
//
// Instead of asserting hardcoded constants (the historical "exactly 4081 / 3081,
// flag 4000 / 3001"), we read the GOVERNED infra ports from constructive.config.json
// — registry.port, app.portBase (+ app.devPortBase), hub.port, hub.privatePort — and
// assert that the port LITERALS the toolkit still spells out AGREE with the config.
// The config is the single source of truth (env-overridable per machine), so "drift"
// now means "a literal disagrees with config", caught in BOTH directions:
//   • a stray hardcoded port that contradicts config (a served/dev/hub URL on
//     `localhost:4000` while registry.port is 4081), and
//   • a stale literal left behind after the config value moved (config bumped to
//     5000 but a `cfg registry.port 4081` fallback or `${REGISTRY_PORT:-4081}` still
//     says 4081).
//
// CONSERVATIVE BY DESIGN — only two precise literal shapes are judged, so a prose
// integer (a year `2026`, a heap size `8192`, a `file.ts:51` line ref, a timeout
// `setTimeout(fn, 4000)`) is never mistaken for a port, and ports the config does NOT
// govern (Mailpit 8025, SMTP 1025, Postgres 5432, the send-email-link sidecar 8082)
// are left entirely alone (those lines carry no governed-service context):
//
//   (b1) NETWORK-ADDRESS drift — a `localhost:PORT` / `127.0.0.1:PORT` literal on a
//        line that is plainly about a GOVERNED service (registry / app / hub context),
//        whose PORT is none of the configured governed ports. Membership against the
//        WHOLE governed set (not just the line's own service) keeps a legitimate
//        cross-reference — a hub URL `localhost:3000` mentioned on a registry line —
//        from false-flagging, while a truly stray `localhost:4000` still trips.
//
//   (b2) SERVICE-DEFAULT drift — a literal BOUND to a specific config coordinate's
//        default, which must equal THAT coordinate exactly:
//          • `cfg <dotted.key> <N>`        → N must equal config[dotted.key]
//          • `${REGISTRY_PORT:-N}`         → N must equal registry.port
//          • `${PORT:-N}`                  → N must equal app.devPortBase (the app
//                                            dev-server floor the loader/template use)
//        These are the fallback defaults that go stale when the config moves; binding
//        each to its exact key is precise (no context guessing) and false-positive-free.
//
// Because every coordinate is overridable, an env-override DEMO is NOT drift: a port
// on the RHS of the service's own override variable (`REGISTRY_PORT=4099 …`,
// `CONSTRUCTIVE_APP_PORT_BASE=5050 …`) is the documented relocate path, so the value
// may differ from config. (b2) deliberately matches only the `:-N` default form and
// the `cfg key N` fallback, never a bare `VAR=N` assignment, so the demo is untouched.
// ---------------------------------------------------------------------------

// Resolve the configured governed ports once. config.mjs applies env overrides and
// falls back to the JSON defaults. If the config cannot be read at all we surface it
// as a run error (exit 2) in main().
let _portCfg = null;
function portConfig() {
  if (_portCfg) return _portCfg;
  _portCfg = {
    registry: Number(getRegistryPort()),
    app: Number(getAppPortBase()),
    appDev: Number(getAppDevPortBase()),
    hub: Number(getHubPort()),
    hubPrivate: Number(getHubPrivatePort()),
  };
  return _portCfg;
}

// The set of CONFIGURED governed-port values. A network-address literal that equals
// ANY of these agrees with config — it is a Constructive coordinate, not drift — so
// we don't have to perfectly attribute a host:port to one service.
function configuredPortSet(cfg) {
  return new Set(
    [cfg.registry, cfg.app, cfg.appDev, cfg.hub, cfg.hubPrivate].filter((n) => Number.isFinite(n))
  );
}

// Per-service line context (b1). A line must match one of these for its network
// addresses to be judged — this is what keeps ungoverned ports (mailpit/postgres/…)
// and prose integers out of scope.
const SERVICE_CTX = {
  registry: /(\bserve\b|registr(y|ies)|REGISTRY_PORT|REGISTRY_BASE|CONSTRUCTIVE_REGISTRY_|\/r\/\{name\}|\/r\/[a-z0-9-]+\.json)/i,
  app: /(dev[ -]?server|\bnext\b|frontend|--port|\bAPP_PORT\b|CONSTRUCTIVE_APP_PORT|portBase|devPortBase|the app port|app\/dev port)/i,
  // The hub is the per-app/platform GraphQL server: api-/auth-/admin-/modules- hosts,
  // postgraphile, or an explicit hub/graphql reference.
  hub: /(graphql[- ]?hub|\bhub\b|postgraphile|(api|auth|admin|modules)-[a-z0-9$.{}-]*\.localhost|(api|auth|admin|modules)\.localhost|HUB_PORT|CONSTRUCTIVE_HUB_)/i,
};

// A loopback network address (the only host shapes the original check keyed on:
// `localhost:PORT` / `127.0.0.1:PORT`). Capturing the port; global to scan all on a line.
const RX_LOOPBACK_ADDR = /(?:localhost|127\.0\.0\.1):(\d{2,5})\b/gi;

// (b2) service-default bindings. Each maps a literal to the EXACT config coordinate
// it defaults, so we compare against that coordinate (not a guessed service):
//   cfg <dotted.key> <N>   — the .sh `cfg`/`cfg_endpoint` fallback (config.mjs CLI)
//   ${REGISTRY_PORT:-N}    — registry serve-port default expansion
//   ${PORT:-N}             — the app dev-server floor (app.devPortBase)
const RX_CFG_FALLBACK = /\bcfg(?:_endpoint)?\s+([a-z]+\.[a-zA-Z]+)\s+(\d{2,5})\b/g;
const RX_REGISTRY_DEFAULT = /\$\{REGISTRY_PORT:-(\d{2,5})\}/g;
const RX_APP_DEV_DEFAULT = /\$\{PORT:-(\d{2,5})\}/g;

function lineService(line) {
  for (const svc of ['registry', 'app', 'hub']) {
    if (SERVICE_CTX[svc].test(line)) return svc;
  }
  return null;
}

function svcLabel(svc) {
  return svc === 'registry' ? 'registry' : svc === 'app' ? 'app' : svc === 'hub' ? 'hub' : 'infra';
}
function svcKey(svc) {
  return svc === 'registry' ? 'registry.port' : svc === 'app' ? 'app.portBase' : svc === 'hub' ? 'hub.port' : null;
}

function checkPortDrift(line) {
  const cfg = portConfig();
  const configured = configuredPortSet(cfg);

  // ── (b2) service-default drift — precise, key-bound (checked first; most specific) ──
  let m;
  RX_CFG_FALLBACK.lastIndex = 0;
  while ((m = RX_CFG_FALLBACK.exec(line)) !== null) {
    const key = m[1];
    const lit = Number(m[2]);
    const want = Number(getValue(key));
    // Only judge keys that resolve to a numeric config value (a real port coordinate);
    // a non-numeric / unknown key is not a port default we govern.
    if (Number.isFinite(want) && Number.isFinite(lit) && lit !== want) {
      return {
        rule: 'config-port-drift',
        text: `cfg ${key} ${lit}`,
        fix:
          `fallback default ${lit} for \`${key}\` disagrees with constructive.config.json (${key} = ${want}). ` +
          `Update the fallback to ${want}, or — to relocate it — change ${key} in the config (the fallback only applies when the loader can't run).`,
      };
    }
  }
  RX_REGISTRY_DEFAULT.lastIndex = 0;
  while ((m = RX_REGISTRY_DEFAULT.exec(line)) !== null) {
    const lit = Number(m[1]);
    if (Number.isFinite(cfg.registry) && lit !== cfg.registry) {
      return {
        rule: 'config-port-drift',
        text: `\${REGISTRY_PORT:-${lit}}`,
        fix:
          `\${REGISTRY_PORT:-${lit}} default disagrees with constructive.config.json (registry.port = ${cfg.registry}). ` +
          `Update the default to ${cfg.registry}, or change registry.port in the config.`,
      };
    }
  }
  RX_APP_DEV_DEFAULT.lastIndex = 0;
  while ((m = RX_APP_DEV_DEFAULT.exec(line)) !== null) {
    const lit = Number(m[1]);
    if (Number.isFinite(cfg.appDev) && lit !== cfg.appDev) {
      return {
        rule: 'config-port-drift',
        text: `\${PORT:-${lit}}`,
        fix:
          `\${PORT:-${lit}} app dev-server floor disagrees with constructive.config.json (app.devPortBase = ${cfg.appDev}). ` +
          `Update the default to ${cfg.appDev}, or change app.devPortBase in the config.`,
      };
    }
  }

  // ── (b1) network-address drift — only on a GOVERNED-service line ──
  const svc = lineService(line);
  if (svc) {
    RX_LOOPBACK_ADDR.lastIndex = 0;
    while ((m = RX_LOOPBACK_ADDR.exec(line)) !== null) {
      const port = Number(m[1]);
      if (!Number.isFinite(port)) continue;
      if (configured.has(port)) continue; // equals SOME governed infra port — agrees
      const want = svc === 'registry' ? cfg.registry : svc === 'app' ? cfg.app : cfg.hub;
      const key = svcKey(svc);
      return {
        rule: 'config-port-drift',
        text: m[0],
        fix:
          `port ${port} on this ${svcLabel(svc)} endpoint disagrees with constructive.config.json` +
          (Number.isFinite(want) ? ` (${key} = ${want})` : '') +
          `. Align the literal with the configured value, or — to relocate the ${svcLabel(svc)} ` +
          `coordinate — change ${key} in constructive.config.json (or set its override env var). ` +
          `Do not hardcode a port that contradicts the config.`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------
function scanFile(file, rootForRel) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rel = relative(rootForRel, file) || file;
  const violations = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const check of [checkAppPublicEndpoint, checkPortDrift]) {
      const v = check(line);
      if (v) violations.push({ file: rel, line: i + 1, ...v, full: line.trim() });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Root: --root, else the harness this script lives in (scripts/ -> repo root).
  const root = opts.root ?? resolve(scriptDir, '..');
  if (!existsSync(root)) fail(2, `--root ${root} does not exist`);
  try {
    if (!statSync(root).isDirectory()) fail(2, `--root ${root} is not a directory`);
  } catch (e) {
    fail(2, `cannot stat --root ${root}: ${e.message}`);
  }

  // Resolve the configured ports up front so a missing/unparseable config fails as a
  // run error (exit 2) rather than mid-scan. This is the one place the config is required.
  let cfg;
  try {
    cfg = portConfig();
  } catch (e) {
    fail(2, `could not read constructive.config.json for the port-drift lint: ${e.message}`);
  }

  const files = collectFiles(root);
  const violations = [];
  for (const f of files) violations.push(...scanFile(f, root));

  // Tally per rule.
  const byRule = { 'app-public-endpoint': [], 'config-port-drift': [] };
  for (const v of violations) byRule[v.rule].push(v);

  const failed = violations.length > 0;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: !failed,
          root,
          filesScanned: files.length,
          configuredPorts: cfg,
          violations,
          summary: {
            appPublicEndpoint: byRule['app-public-endpoint'].length,
            configPortDrift: byRule['config-port-drift'].length,
          },
        },
        null,
        2
      )
    );
    process.exit(failed ? 1 : 0);
  }

  console.log(C.bold('\nConstructive Blocks build toolkit — endpoint + config-drift guard\n'));
  console.log(`${C.dim('root   ')} ${root}`);
  console.log(`${C.dim('scanned')} ${files.length} files (*.md, *.sh, *.mjs)`);
  console.log(
    `${C.dim('config ')} registry.port=${cfg.registry}  app.portBase=${cfg.app}  hub.port=${cfg.hub}  hub.privatePort=${cfg.hubPrivate}\n`
  );

  if (!failed) {
    console.log(`${C.green('✓')} app-public-<sub> never named as a GraphQL/DATA endpoint`);
    console.log(`${C.green('✓')} every infra port literal agrees with constructive.config.json`);
    console.log(C.green('\n✓ No config drift.'));
    process.exit(0);
  }

  const labels = {
    'app-public-endpoint': 'app-public-<sub> named as a GraphQL/DATA endpoint (use api-<sub>)',
    'config-port-drift': 'infra port literal disagrees with constructive.config.json',
  };
  for (const rule of ['app-public-endpoint', 'config-port-drift']) {
    const hits = byRule[rule];
    if (!hits.length) continue;
    console.log(`${C.red('✗')} ${C.bold(labels[rule])} ${C.dim(`(${hits.length})`)}`);
    for (const v of hits) {
      console.log(`    ${C.yellow(`${v.file}:${v.line}`)}  ${v.full}`);
      console.log(`      ${C.dim('offending:')} ${v.text}`);
      console.log(`      ${C.dim('fix:')} ${v.fix}`);
    }
    console.log('');
  }

  console.log(C.red(`✗ Config drift detected — ${violations.length} violation(s).`));
  console.log(
    C.dim(
      '\n  Source of truth: constructive.config.json (env-overridable). DATA endpoint = api-<sub>\n' +
        `  (Host routes; app-public-<sub> is DEAD). Configured ports: registry=${cfg.registry}, app=${cfg.app}, hub=${cfg.hub}.\n` +
        '  Align literals with the config, or change the config to relocate a coordinate.'
    )
  );
  process.exit(1);
}

main();
