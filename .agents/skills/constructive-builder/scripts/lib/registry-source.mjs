#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * registry-source.mjs — resolve WHERE the component (Blocks) registry's block JSON
 * comes from, so a build is reproducible on a fresh machine and not only beside a
 * co-located registry checkout.
 *
 * The on-ramp's flow blocks (auth / account / org) are served as static JSON over
 * HTTP from a registry's `public/` tree (its `r/<slug>.json` files + any index).
 * Historically that tree was found ONLY by auto-discovering a registry checkout
 * placed next to this toolkit. That is fast for a warm local build but is NOT
 * reproducible: a clean checkout of the toolkit with no co-located registry beside
 * it had no way to obtain the blocks. This module makes the registry source
 * CONFIGURABLE (constructive.config.json `registry.source`, overridable by
 * CONSTRUCTIVE_REGISTRY_SOURCE) with three modes:
 *
 *   (a) "sibling" (DEFAULT) — auto-discover a registry checkout placed beside this
 *       toolkit (one parent-dir level), preferring a dir whose name carries the
 *       active blocks worktree suffix. Identical to the long-standing behavior, so
 *       a warm local build is unchanged. Build-capable (its public/ is rebuilt from
 *       source when stale).
 *
 *   (b) a local repo/dir PATH (any value that resolves to an existing directory) —
 *       serve `<path>/<publicSubpath>` from a local registry repo/dir. The PATH may
 *       be the repo root (then publicSubpath, default apps/registry/public, locates
 *       its built public tree) OR the apps/registry dir itself OR the public dir
 *       itself. Build-capable when an apps/registry package is identified.
 *
 *   (c) a GIT source — "git:<url>#<branch>" (or the registry.url + registry.branch
 *       keys). Shallow-clone + sparse-checkout the registry's built public subtree
 *       (publicSubpath) into a gitignored cache dir under the toolkit
 *       (.registry-cache/) and serve from there, refreshing when stale. The remote
 *       is expected to carry the BUILT public tree (the r/<slug>.json files); we
 *       serve it as-is (no build step on the clone).
 *
 * One resolver feeds BOTH worlds:
 *   • .mjs scripts → `import { resolveRegistrySource } from './lib/registry-source.mjs'`
 *   • .sh scripts  → `node scripts/lib/registry-source.mjs resolve [--no-fetch]`
 *                    prints the resolution as JSON on stdout (one object), exit 0;
 *                    a human-readable, actionable error on stderr + exit non-zero
 *                    when no source resolves (fail LOUD — never silently empty).
 *
 * The shape it returns (so callers don't re-derive policy):
 *   {
 *     mode: 'sibling' | 'path' | 'git',
 *     registryAppDir: <abs apps/registry dir> | null,  // present + BUILD-CAPABLE for sibling/path
 *     publicDir:      <abs dir to SERVE>,               // always present (holds r/<slug>.json)
 *     prebuilt:       boolean,                          // true (git): already built, do NOT build
 *     source:         <the configured source string>,
 *     detail:         <short human note about how it resolved>
 *   }
 *
 * Zero deps beyond the sibling config loader + git/node on PATH. Pure Node (>=18).
 */

import { existsSync, readdirSync, mkdirSync, statSync, rmSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { getValue } from './config.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/lib/registry-source.mjs → repo root is two levels up.
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');

// The gitignored cache dir the GIT mode clones into (kept under the toolkit so
// teardown/`git status` ignore it). Overridable for tests via the env below.
const CACHE_DIRNAME = '.registry-cache';
export function cacheRoot() {
  return process.env.CONSTRUCTIVE_REGISTRY_CACHE_DIR
    ? resolve(process.env.CONSTRUCTIVE_REGISTRY_CACHE_DIR)
    : resolve(REPO_ROOT, CACHE_DIRNAME);
}

// Cache freshness window (seconds). A clone newer than this is reused as-is; older
// is refreshed (re-fetched). Default 1h. Override with CONSTRUCTIVE_REGISTRY_CACHE_TTL.
function cacheTtlSeconds() {
  const v = Number(process.env.CONSTRUCTIVE_REGISTRY_CACHE_TTL);
  return Number.isFinite(v) && v >= 0 ? v : 3600;
}

class RegistrySourceError extends Error {
  constructor(message, fix) {
    super(message);
    this.name = 'RegistrySourceError';
    this.fix = fix;
  }
}

// Does a dir look like the SERVABLE public tree? (holds r/<slug>.json block files)
function looksLikePublicDir(dir) {
  return existsSync(join(dir, 'r'));
}
// Does a dir look like an apps/registry PACKAGE? (has package.json — build entry).
function looksLikeRegistryPackage(dir) {
  return existsSync(join(dir, 'package.json'));
}

// ── (a) sibling auto-discovery — EXACT port of serve-registry.sh's logic ───────
// Probe one parent-dir level for a child holding the configured publicSubpath's
// registry package, preferring a dashboard-*blocks* worktree (carries FLOW blocks).
// REGISTRY_DIR (env) still wins, identically to today.
function discoverSibling(publicSubpath) {
  if (process.env.REGISTRY_DIR) {
    const dir = process.env.REGISTRY_DIR;
    if (!existsSync(dir)) {
      throw new RegistrySourceError(
        `REGISTRY_DIR=${dir} does not exist`,
        'unset REGISTRY_DIR to auto-discover, or point it at a registry checkout apps/registry dir',
      );
    }
    return dir;
  }
  // publicSubpath is e.g. "apps/registry/public"; the registry PACKAGE dir is its parent.
  const registryRel = dirname(publicSubpath); // "apps/registry"
  const parent = resolve(REPO_ROOT, '..');
  let preferred = '';
  let fallback = '';
  let children = [];
  try {
    children = readdirSync(parent, { withFileTypes: true });
  } catch {
    children = [];
  }
  for (const ent of children) {
    if (!ent.isDirectory()) continue;
    const regDir = join(parent, ent.name, registryRel);
    if (!existsSync(join(regDir, 'package.json'))) continue;
    if (/dashboard.*blocks|blocks.*dashboard/.test(ent.name)) preferred = regDir;
    else if (!fallback) fallback = regDir;
  }
  const regDir = preferred || fallback;
  if (!regDir) {
    throw new RegistrySourceError(
      `could not auto-discover a co-located registry dir (${registryRel}) under ${parent}`,
      `place a dashboard-blocks worktree beside this toolkit (the default "sibling" source), or set registry.source in constructive.config.json (CONSTRUCTIVE_REGISTRY_SOURCE) to an absolute registry PATH or a "git:<url>#<branch>" source, or set REGISTRY_DIR=/abs/.../${registryRel}`,
    );
  }
  return regDir;
}

// ── (b) a local PATH → resolve to {registryAppDir?, publicDir} ─────────────────
// Accept: the public dir itself, an apps/registry package dir, or a repo ROOT that
// contains the configured publicSubpath. Fail LOUD if none of those locate a public
// tree (so a typo can never serve an empty registry).
function resolvePath(rawPath, publicSubpath) {
  const abs = isAbsolute(rawPath) ? rawPath : resolve(REPO_ROOT, rawPath);
  if (!existsSync(abs)) {
    throw new RegistrySourceError(
      `registry.source path '${rawPath}' (resolved ${abs}) does not exist`,
      `point registry.source / CONSTRUCTIVE_REGISTRY_SOURCE at an existing local registry repo, its ${dirname(publicSubpath)} dir, or its ${publicSubpath} dir`,
    );
  }
  // 1. the public dir itself.
  if (looksLikePublicDir(abs)) {
    // …and if its parent is a registry package, expose it so a rebuild stays possible.
    const maybePkg = dirname(abs);
    const registryAppDir = looksLikeRegistryPackage(maybePkg) ? maybePkg : null;
    return { registryAppDir, publicDir: abs, detail: `local PATH (public dir): ${abs}` };
  }
  // 2. an apps/registry PACKAGE dir → serve its public/.
  if (looksLikeRegistryPackage(abs) && (basename(abs) === basename(dirname(publicSubpath)) || existsSync(join(abs, 'public')))) {
    return { registryAppDir: abs, publicDir: join(abs, 'public'), detail: `local PATH (registry package): ${abs}` };
  }
  // 3. a repo ROOT that contains publicSubpath.
  const repoPublic = join(abs, publicSubpath);
  if (existsSync(repoPublic) || existsSync(dirname(repoPublic))) {
    const registryAppDir = dirname(repoPublic); // <path>/apps/registry
    return {
      registryAppDir: looksLikeRegistryPackage(registryAppDir) ? registryAppDir : null,
      publicDir: repoPublic,
      detail: `local PATH (repo root + publicSubpath ${publicSubpath}): ${abs}`,
    };
  }
  throw new RegistrySourceError(
    `registry.source path '${abs}' does not look like a registry (no r/ public tree, no ${dirname(publicSubpath)}/package.json, no ${publicSubpath})`,
    `point registry.source at a registry repo root (holding ${publicSubpath}), its ${dirname(publicSubpath)} dir, or the built public dir itself`,
  );
}

// ── parse a git source spec ────────────────────────────────────────────────────
// "git:<url>#<branch>" → {url,branch}; bare "git:<url>" → {url, branch:''}. Also
// accepts an explicit url + branch from the config keys (passed in by the caller).
export function parseGitSpec(source, urlKey, branchKey) {
  let url = (urlKey || '').trim();
  let branch = (branchKey || '').trim();
  if (typeof source === 'string' && source.startsWith('git:')) {
    const rest = source.slice('git:'.length);
    const hash = rest.indexOf('#');
    if (hash >= 0) {
      url = rest.slice(0, hash).trim();
      branch = rest.slice(hash + 1).trim();
    } else {
      url = rest.trim();
    }
  }
  return { url, branch };
}

// A short, filesystem-safe cache key for a (url, branch, subpath) triple.
function cacheKeyFor(url, branch, publicSubpath) {
  const raw = `${url}@@${branch}@@${publicSubpath}`;
  // djb2 → hex (stable, no deps). Plus a readable slug from the repo name.
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  const repoSlug = (url.split('/').pop() || 'registry').replace(/\.git$/, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'registry';
  return `${repoSlug}-${h.toString(16)}`;
}

function isFresh(dir, ttl) {
  if (!existsSync(dir)) return false;
  try {
    const ageSec = (Date.now() - statSync(dir).mtimeMs) / 1000;
    return ageSec <= ttl;
  } catch {
    return false;
  }
}

// ── (c) GIT mode → shallow clone + sparse-checkout into the cache, serve from it ─
// `allowFetch=false` (the --no-fetch CLI flag) uses an existing fresh cache but
// never reaches the network — for offline coverage checks.
function resolveGit(source, publicSubpath, { allowFetch = true } = {}) {
  const url = (source.url || '').trim();
  const branch = (source.branch || '').trim();
  if (!url) {
    throw new RegistrySourceError(
      'registry.source is a git source but no URL is set',
      'use registry.source = "git:<url>#<branch>" (CONSTRUCTIVE_REGISTRY_SOURCE), or set registry.url (+ registry.branch) in constructive.config.json',
    );
  }
  const key = cacheKeyFor(url, branch, publicSubpath);
  const root = cacheRoot();
  const checkoutDir = join(root, key);
  const servedPublic = join(checkoutDir, publicSubpath);
  const ttl = cacheTtlSeconds();

  const haveFreshPublic = looksLikePublicDir(servedPublic) && isFresh(checkoutDir, ttl);
  if (haveFreshPublic) {
    return { registryAppDir: null, publicDir: servedPublic, prebuilt: true, detail: `git cache (fresh): ${checkoutDir}` };
  }
  if (!allowFetch) {
    // Offline: a stale-but-present public tree is still better than nothing.
    if (looksLikePublicDir(servedPublic)) {
      return { registryAppDir: null, publicDir: servedPublic, prebuilt: true, detail: `git cache (stale, --no-fetch): ${checkoutDir}` };
    }
    throw new RegistrySourceError(
      `git registry source not in cache and fetching is disabled (--no-fetch): no built public tree at ${servedPublic}`,
      `run a fetch-enabled step first (scripts/serve-registry.sh) to populate ${root}, or use registry.source = a local PATH / "sibling"`,
    );
  }

  if (typeof execFileSync !== 'function') {
    throw new RegistrySourceError('git fetch requires Node child_process (unavailable)', 'use a local PATH source instead');
  }
  // Ensure a clean checkout dir (refresh = re-clone; sparse so we pull only the public subtree).
  mkdirSync(root, { recursive: true });
  if (existsSync(checkoutDir)) rmSync(checkoutDir, { recursive: true, force: true });

  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  try {
    git(['--version']);
  } catch (e) {
    throw new RegistrySourceError(
      `git is required for a git registry source but is not available: ${e.message}`,
      'install git, or switch registry.source to a local PATH / "sibling"',
    );
  }
  try {
    // Shallow, no-checkout clone, then sparse-checkout ONLY the public subtree.
    const cloneArgs = ['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--sparse'];
    if (branch) cloneArgs.push('--branch', branch);
    cloneArgs.push(url, checkoutDir);
    git(cloneArgs);
    git(['sparse-checkout', 'set', '--no-cone', publicSubpath], checkoutDir);
    git(['checkout'], checkoutDir);
  } catch (e) {
    const stderr = (e.stderr && e.stderr.toString && e.stderr.toString().trim()) || e.message;
    throw new RegistrySourceError(
      `failed to fetch git registry source ${url}${branch ? '#' + branch : ''}: ${stderr}`,
      `confirm the URL/branch are correct and reachable (the remote must carry the BUILT public tree at ${publicSubpath}), or use a local PATH / "sibling" source`,
    );
  }
  if (!looksLikePublicDir(servedPublic)) {
    throw new RegistrySourceError(
      `git registry source ${url}${branch ? '#' + branch : ''} has no built public tree at ${publicSubpath} (no r/ block dir after sparse-checkout)`,
      `the GIT source must carry the BUILT registry public tree (the r/<slug>.json files). Point registry.url/branch at a branch that publishes ${publicSubpath}/r/, set registry.publicSubpath to its real public path, or use a local PATH that can be built`,
    );
  }
  return { registryAppDir: null, publicDir: servedPublic, prebuilt: true, detail: `git fetched → ${checkoutDir}` };
}

/**
 * Resolve the configured registry source to a servable public dir (+ build-capable
 * registry package dir for the build-capable modes). Reads registry.source /
 * registry.url / registry.branch / registry.publicSubpath from the config (env
 * overrides applied by config.mjs). Throws RegistrySourceError (with `.fix`) when
 * nothing resolves.
 *
 * @param {{allowFetch?: boolean}} opts  allowFetch=false → never touch the network
 *        (git mode reuses an existing cache or throws).
 */
export function resolveRegistrySource(opts = {}) {
  const allowFetch = opts.allowFetch !== false;
  const sourceRaw = (getValue('registry.source') || 'sibling').toString().trim();
  const publicSubpath = (getValue('registry.publicSubpath') || 'apps/registry/public').toString().trim();

  // GIT mode: an explicit "git:" prefix, OR a configured registry.url with the
  // source left as "sibling"/empty would NOT count (default must stay sibling) —
  // a git source is opted into only by source starting "git:" (or source==='git'
  // with url/branch keys). This keeps the DEFAULT path byte-for-byte unchanged.
  const isGit = sourceRaw.startsWith('git:') || sourceRaw === 'git';
  if (isGit) {
    const { url, branch } = parseGitSpec(sourceRaw, getValue('registry.url'), getValue('registry.branch'));
    const r = resolveGit({ url, branch }, publicSubpath, { allowFetch });
    return { mode: 'git', registryAppDir: r.registryAppDir, publicDir: r.publicDir, prebuilt: !!r.prebuilt, source: sourceRaw, detail: r.detail };
  }

  // SIBLING mode (DEFAULT): the literal "sibling" (or empty) → today's auto-discovery.
  if (sourceRaw === '' || sourceRaw === 'sibling') {
    const registryAppDir = discoverSibling(publicSubpath);
    return {
      mode: 'sibling',
      registryAppDir,
      publicDir: join(registryAppDir, 'public'),
      prebuilt: false,
      source: 'sibling',
      detail: `auto-discovered co-located registry: ${registryAppDir}`,
    };
  }

  // PATH mode: anything else is treated as a local path (absolute or repo-relative).
  const r = resolvePath(sourceRaw, publicSubpath);
  return { mode: 'path', registryAppDir: r.registryAppDir, publicDir: r.publicDir, prebuilt: false, source: sourceRaw, detail: r.detail };
}

// ── CLI (so serve-registry.sh can resolve via node and read JSON) ──────────────
// Robust against a SYMLINKED checkout (e.g. /tmp → /private/tmp on macOS, or a
// symlinked toolkit dir): Node resolves import.meta.url through the realpath while
// process.argv[1] keeps the symlinked spelling, so a plain string compare would say
// "not main" and the CLI would silently no-op (empty stdout, exit 0). We compare
// REALPATHS so `node scripts/lib/registry-source.mjs ...` still runs its CLI from a
// symlinked path — which is exactly the reproducibility case (a fresh clone may live
// anywhere). Falls back to the string compare if realpath can't resolve a side.
function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const here = fileURLToPath(import.meta.url);
  const real = (p) => {
    try { return realpathSync(p); } catch { return resolve(p); }
  };
  return real(argv1) === real(here);
}

if (isMain()) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const allowFetch = !args.includes('--no-fetch');
  // Set process.exitCode and let the process exit NATURALLY — never process.exit().
  // serve-registry.sh reads this CLI's stdout via $(...) (a pipe), and an immediate
  // process.exit() after console.log can TRUNCATE the buffered pipe write (Node only
  // flushes stdout synchronously to a TTY). A natural exit drains stdout/stderr first,
  // so the JSON the .sh consumer parses is never silently empty.
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      console.log(
        `registry-source.mjs — resolve the configured registry source to a servable public dir.

Usage:
  node scripts/lib/registry-source.mjs resolve [--no-fetch]   print {mode,registryAppDir,publicDir,prebuilt,source,detail} as JSON
  node scripts/lib/registry-source.mjs cache-dir              print the gitignored clone cache dir
  node scripts/lib/registry-source.mjs --help

Modes (constructive.config.json registry.source / CONSTRUCTIVE_REGISTRY_SOURCE):
  sibling (default)  auto-discover a registry checkout beside this toolkit (unchanged)
  <abs PATH>         serve apps/registry/public from a local registry repo/dir
  git:<url>#<branch> shallow clone the built public tree into ${CACHE_DIRNAME}/ and serve it
--no-fetch: never reach the network (git mode reuses an existing cache or fails).`,
      );
      process.exitCode = 0;
    } else if (cmd === 'cache-dir') {
      console.log(cacheRoot());
      process.exitCode = 0;
    } else if (cmd === 'resolve') {
      const r = resolveRegistrySource({ allowFetch });
      console.log(JSON.stringify(r));
      process.exitCode = 0;
    } else {
      console.error(`unknown command: ${cmd} (try: resolve | cache-dir | --help)`);
      process.exitCode = 2;
    }
  } catch (e) {
    if (e instanceof RegistrySourceError) {
      console.error(`  FAIL: ${e.message}`);
      if (e.fix) console.error(`        FIX: ${e.fix}`);
      process.exitCode = 1;
    } else {
      console.error(`registry-source.mjs: ${e && e.stack ? e.stack : e}`);
      process.exitCode = 2;
    }
  }
}

export { RegistrySourceError };
