#!/usr/bin/env node
/**
 * scripts/check-registry-coverage.mjs — assert the served registry covers EVERY
 * flow block the harness's flows.json references (not just the one sentinel block
 * serve-registry.sh curl-verifies).
 *
 * WHY: serve-registry.sh only proves a single KNOWN_FLOW_BLOCK (auth-sign-in-card)
 * resolves. That distinguishes a dashboard-blocks registry from a primitives-only
 * one, but it does NOT catch a *partial* flow registry — one that carries
 * auth-sign-in-card yet is missing, say, org-roles-editor or use-step-up. An agent
 * mid-build would then `shadcn add @constructive/<that-block>` and hit a 404 deep in
 * the on-ramp, far from the registry step. This check closes that gap: it derives the
 * FULL slug set from references/flows.json (the frozen SoT — read-only) and asserts
 * each one resolves, reporting the exact missing slugs as a loud list.
 *
 * SOURCE OF TRUTH: references/flows.json `flows[].blocks[]` — the union of every block
 * each GA flow installs. This file is FROZEN/generated (check:flows guards it byte-for-
 * byte); this script only READS it, never writes it.
 *
 * TWO MODES (auto-selected; override with a flag):
 *   • online  (default): GET http://localhost:${REGISTRY_PORT:-4081}/r/<slug>.json for
 *              every slug and require HTTP 200. 4081 is the canonical serve target —
 *              the same port serve-registry.sh / check-harness-drift.mjs pin. This is
 *              the mode serve-registry.sh wires in after it has the server up.
 *   • offline (--offline, or auto when no server answers on the port): resolve each
 *              <slug>.json under the registry's public/r/ ON DISK, using the SAME
 *              config-driven source serve-registry.sh uses (scripts/lib/registry-source.mjs):
 *              the DEFAULT "sibling" auto-discovers a registry checkout beside the toolkit
 *              (unchanged; still honors REGISTRY_DIR), an absolute PATH points at a local
 *              registry, and a git: source reuses an existing clone cache (never fetches
 *              offline). Lets you check coverage of a built/fetched registry without serving
 *              it — and without a co-located registry checkout when a PATH/git source is set.
 *
 * Exit: 0 = every flows.json block slug is covered · 1 = one or more missing (the
 *       loud list names them) · 2 = usage/IO error (flows.json or registry not found).
 *
 * Usage:
 *   node scripts/check-registry-coverage.mjs                 # online, :${REGISTRY_PORT:-4081}
 *   node scripts/check-registry-coverage.mjs --offline       # disk, discovered public/r/
 *   REGISTRY_PORT=4099 node scripts/check-registry-coverage.mjs --online
 *   REGISTRY_DIR=/abs/.../apps/registry node scripts/check-registry-coverage.mjs --offline
 *   node scripts/check-registry-coverage.mjs --flows references/flows.json --base http://localhost:4081
 *
 * Env (shared with serve-registry.sh):
 *   REGISTRY_PORT  serve port for the online probe         (default 4081)
 *   REGISTRY_DIR   absolute dashboard-blocks apps/registry  (offline; skips discovery)
 *   REGISTRY_BASE  full base URL override for online probe  (default http://localhost:$REGISTRY_PORT)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveRegistrySource, RegistrySourceError } from './lib/registry-source.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARNESS = path.resolve(__dirname, '..');

// ── tiny colorized reporter (mirrors serve-registry.sh's vocabulary) ──────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = {
  red: (s) => (useColor ? `\x1b[0;31m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[0;32m${s}\x1b[0m` : s),
  yellow: (s) => (useColor ? `\x1b[1;33m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};
const pass = (m) => console.log(`${C.green('  PASS')}: ${m}`);
const info = (m) => console.log(`  INFO: ${m}`);
const warn = (m) => console.log(`${C.yellow('  WARN')}: ${m}`);
function fail(msg, fix) {
  console.error(`${C.red('  FAIL')}: ${msg}`);
  if (fix) console.error(`        FIX: ${fix}`);
  process.exit(1);
}
function bail(msg, fix) {
  // usage / IO error — exit 2 so callers can distinguish "couldn't run" from "missing slugs".
  console.error(`${C.red('  ERROR')}: ${msg}`);
  if (fix) console.error(`        FIX: ${fix}`);
  process.exit(2);
}

// ── args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { mode: null, flows: null, base: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') o.mode = 'offline';
    else if (a === '--online') o.mode = 'online';
    else if (a === '--flows') o.flows = argv[++i];
    else if (a === '--base') o.base = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else bail(`unknown argument: ${a}`, 'see the header comment for usage (--offline | --online | --flows <p> | --base <url>).');
  }
  return o;
}

const HELP = `check-registry-coverage.mjs — assert the registry covers every flows.json block slug

  node scripts/check-registry-coverage.mjs [--online|--offline] [--flows <path>] [--base <url>]

  (default) online : GET <base>/r/<slug>.json, require HTTP 200
            --offline: resolve <slug>.json under the discovered dashboard-blocks public/r/
  base default: http://localhost:\${REGISTRY_PORT:-4081}  (canonical serve target)
  env: REGISTRY_PORT, REGISTRY_BASE, REGISTRY_DIR
`;

// ── read the FROZEN flows.json and extract the union of block slugs ────────────
function loadFlowBlockSlugs(flowsPath) {
  let raw;
  try {
    raw = fs.readFileSync(flowsPath, 'utf8');
  } catch (e) {
    bail(`cannot read flows.json at ${flowsPath}: ${e.message}`,
      'run from the harness root, or pass --flows <path> to references/flows.json.');
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    bail(`flows.json is not valid JSON (${flowsPath}): ${e.message}`,
      'flows.json is generated — do NOT hand-edit it; regen via the SoT (apps/blocks gen:flows).');
  }
  if (!Array.isArray(json.flows)) {
    bail(`flows.json has no "flows" array (${flowsPath})`,
      'this does not look like the harness flows.json — pass the right --flows path.');
  }
  const slugs = new Set();
  for (const flow of json.flows) {
    for (const b of flow.blocks || []) {
      if (typeof b === 'string' && b.trim()) slugs.add(b.trim());
    }
  }
  return [...slugs].sort();
}

// ── offline: locate the registry's public/r on disk (serve-registry parity) ────
// Resolves the SAME config-driven source serve-registry.sh uses (scripts/lib/
// registry-source.mjs): "sibling" (DEFAULT — auto-discover a registry checkout
// beside the toolkit, byte-for-byte the old behavior, still honoring REGISTRY_DIR),
// an absolute PATH, or a git: cache. Offline ⇒ allowFetch:false: a git source reuses
// an existing clone cache (populated by a prior fetch-enabled serve-registry.sh) but
// never reaches the network — so coverage works without a co-located registry, while
// the default sibling path is unchanged.
function discoverPublicR() {
  // explicit REGISTRY_DIR override wins (same env var serve-registry.sh honors), with
  // the exact pre-existing semantics — preserved so the default path is byte-for-byte.
  if (process.env.REGISTRY_DIR) {
    const dir = process.env.REGISTRY_DIR;
    const pubR = path.join(dir, 'public', 'r');
    if (!fs.existsSync(pubR)) {
      bail(`REGISTRY_DIR=${dir} has no public/r (looked at ${pubR})`,
        'unset REGISTRY_DIR to auto-discover, or point it at a built dashboard-blocks apps/registry dir (its public/r/ holds the block JSON). Build first: scripts/serve-registry.sh.');
    }
    return pubR;
  }
  let resolved;
  try {
    resolved = resolveRegistrySource({ allowFetch: false });
  } catch (e) {
    if (e instanceof RegistrySourceError) {
      bail(`could not resolve a registry source for offline coverage: ${e.message}`,
        e.fix || 'set registry.source in constructive.config.json (CONSTRUCTIVE_REGISTRY_SOURCE) to "sibling", an absolute PATH, or "git:<url>#<branch>" (run scripts/serve-registry.sh once to populate a git cache), or run --online against a served registry.');
    }
    bail(`could not resolve a registry source for offline coverage: ${e.message}`,
      'set REGISTRY_DIR=/abs/.../apps/registry, or run --online against a served registry.');
  }
  const pubR = path.join(resolved.publicDir, 'r');
  if (!fs.existsSync(pubR)) {
    bail(`resolved registry source (mode=${resolved.mode}) is not built (no public/r at ${resolved.publicDir})`,
      'build/populate it first — scripts/serve-registry.sh builds (sibling/PATH) or fetches (git) the registry; then re-run --offline. (For a git source, --offline reuses an existing clone cache and never fetches.)');
  }
  return pubR;
}

// ── online: probe one slug → boolean covered (HTTP 200) ────────────────────────
async function probeOnline(base, slug) {
  const url = `${base}/r/${slug}.json`;
  try {
    // HEAD is enough to learn presence and is cheap; npx serve answers HEAD with the
    // same status as GET. Fall back to GET if HEAD is unsupported (405/501).
    let res = await fetch(url, { method: 'HEAD' });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET' });
    }
    return { ok: res.status === 200, status: res.status, url };
  } catch (e) {
    return { ok: false, status: 0, url, err: e.message };
  }
}

// Is anything answering on the base URL at all? Used to auto-pick offline when no server.
async function serverAnswers(base) {
  try {
    const res = await fetch(`${base}/`, { method: 'HEAD' });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }

  const flowsPath = opts.flows
    ? path.resolve(process.cwd(), opts.flows)
    : path.join(HARNESS, 'references', 'flows.json');
  const slugs = loadFlowBlockSlugs(flowsPath);

  console.log(C.bold('\ncheck:registry-coverage — every flows.json flow block must resolve\n'));
  info(`flows.json:    ${path.relative(HARNESS, flowsPath) || flowsPath}`);
  info(`flow blocks:   ${slugs.length} unique slug(s) referenced by flows[].blocks[]`);

  const port = process.env.REGISTRY_PORT || '4081';
  const base = (opts.base || process.env.REGISTRY_BASE || `http://localhost:${port}`).replace(/\/+$/, '');

  // Decide mode: explicit flag wins; else online if a server answers on the base, else offline.
  let mode = opts.mode;
  if (!mode) {
    mode = (await serverAnswers(base)) ? 'online' : 'offline';
    info(`mode auto-selected: ${mode} (${mode === 'online' ? `a server answers on ${base}` : `no server on ${base} — checking disk`})`);
  }

  const missing = [];

  if (mode === 'online') {
    info(`target:        ${base}/r/<slug>.json  (canonical serve port ${port})`);
    // Probe sequentially-bounded (small N) — keep it simple and ordered for a stable report.
    const results = await Promise.all(slugs.map((s) => probeOnline(base, s)));
    for (let i = 0; i < slugs.length; i++) {
      const r = results[i];
      if (!r.ok) missing.push({ slug: slugs[i], detail: r.status ? `HTTP ${r.status}` : `unreachable (${r.err || 'no response'})` });
    }
    if (missing.length === 0) {
      pass(`all ${slugs.length} flow block slugs resolve at ${base}/r/*.json (HTTP 200)`);
    }
  } else {
    const pubR = discoverPublicR();
    info(`target:        ${pubR}/<slug>.json  (on disk)`);
    for (const slug of slugs) {
      if (!fs.existsSync(path.join(pubR, `${slug}.json`))) missing.push({ slug, detail: 'not on disk' });
    }
    if (missing.length === 0) {
      pass(`all ${slugs.length} flow block slugs exist under ${path.relative(HARNESS, pubR) || pubR} (on disk)`);
    }
  }

  if (missing.length > 0) {
    // Loud, enumerated list — the whole point is to name EVERY missing slug (and why),
    // not just count them, so an agent sees exactly which blocks won't `shadcn add`.
    console.error('');
    console.error(`${C.red('  MISSING flow block slugs')} (${missing.length}/${slugs.length}):`);
    for (const m of missing) console.error(`    ${C.red('✗')} ${m.slug}  ${C.dim(`(${m.detail})`)}`);
    console.error('');
    fail(
      `${missing.length}/${slugs.length} flow block slug(s) NOT covered by the registry — this is a primitives-only or PARTIAL flow registry:`,
      `you built/served a registry missing flow blocks. The auth/account/org FLOW blocks build ONLY from the dashboard-blocks worktree's apps/registry (AGENTS.md sibling pattern). Point REGISTRY_DIR at that worktree and re-run: scripts/serve-registry.sh ${port}` +
        (mode === 'online' ? `, then re-check.` : ` (offline checks disk).`),
    );
  }

  // (fail() exits non-zero before here when anything is missing)
  console.log('');
  pass(`registry coverage COMPLETE — every flows.json flow block (${slugs.length}) is served/present.`);
  process.exit(0);
}

main().catch((e) => bail(`unexpected error: ${e && e.stack ? e.stack : e}`));
