#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * config.mjs — loader + accessors for constructive.config.json (the single
 * per-ENVIRONMENT source of truth for the infrastructure coordinates a
 * Constructive app build talks to: the GraphQL hub, the component registry, the
 * local dev server, the mail catcher).
 *
 * One file feeds BOTH worlds:
 *   • .mjs scripts  →  `import { getConfig, getEndpoint, ... } from './lib/config.mjs'`
 *   • .sh scripts   →  `node scripts/lib/config.mjs get <dotted.key>`  (prints the
 *                       resolved value, one line, no quotes — safe for `$(...)`).
 *
 * Resolution order for every value: the matching ENV VAR (per the `env` maps in
 * the JSON) wins; otherwise the JSON default. De-hardcoding changes WHERE a value
 * is read from, not WHAT it defaults to — every default here equals today's value.
 *
 * CLI:
 *   node config.mjs get <dotted.key>          # e.g.  get hub.port  → 3000
 *   node config.mjs endpoint <role> [<sub>]   # per-app role host (sub) or platform (no sub)
 *   node config.mjs json                       # the fully-resolved config as JSON
 *   node config.mjs --help
 *
 * Zero dependencies. Pure Node (>=18).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/lib/config.mjs → repo root is two levels up.
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const CONFIG_PATH = process.env.CONSTRUCTIVE_CONFIG_PATH
  ? resolve(process.env.CONSTRUCTIVE_CONFIG_PATH)
  : resolve(REPO_ROOT, 'constructive.config.json');

// ── raw load (cached) ───────────────────────────────────────────────────────
let _raw = null;
function loadRaw() {
  if (_raw) return _raw;
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`constructive.config.json not found at ${CONFIG_PATH} (set CONSTRUCTIVE_CONFIG_PATH to override its location)`);
  }
  try {
    _raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`could not parse ${CONFIG_PATH}: ${e.message}`);
  }
  return _raw;
}

// Coerce an env-var string to the type of the JSON default (number stays number).
function coerce(value, like) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof like === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

// Resolve ONE section: copy its scalar keys, applying any env override named in
// that section's `env` map. `$comment` and the `env` map itself are dropped.
function resolveSection(section) {
  const out = {};
  const envMap = (section && section.env) || {};
  for (const [k, v] of Object.entries(section || {})) {
    if (k === 'env' || k === '$comment') continue;
    let val = v;
    const envName = envMap[k];
    if (envName && process.env[envName] !== undefined && process.env[envName] !== '') {
      const o = coerce(process.env[envName], v);
      if (o !== undefined) val = o;
    }
    out[k] = val;
  }
  return out;
}

// ── fully-resolved config (cached) ────────────────────────────────────────────
let _config = null;
export function getConfig() {
  if (_config) return _config;
  const raw = loadRaw();
  _config = {
    hub: resolveSection(raw.hub),
    db: resolveSection(raw.db),
    registry: resolveSection(raw.registry),
    app: resolveSection(raw.app),
    mail: resolveSection(raw.mail),
  };
  return _config;
}

// Test/utility hook: drop the caches so a later getConfig() re-reads env + file.
export function _resetConfigCache() {
  _raw = null;
  _config = null;
}

// ── endpoint builders ─────────────────────────────────────────────────────────
function fillPattern(pattern, vars) {
  return pattern.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/**
 * Per-app GraphQL endpoint for an API role + app subdomain, e.g.
 *   getEndpoint('api',  'goldenapp') → http://api-goldenapp.localhost:3000/graphql
 *   getEndpoint('auth', 'goldenapp') → http://auth-goldenapp.localhost:3000/graphql
 * Host is built from hub.hostPattern ({role}-{sub}.{host}); scheme/host/port from the hub config.
 */
export function getEndpoint(role, sub) {
  const { hub } = getConfig();
  const host = fillPattern(hub.hostPattern, { role, sub, host: hub.host });
  return `${hub.scheme}://${host}:${hub.port}${hub.graphqlPath}`;
}

/**
 * The host (no scheme, no path) for a per-app role — what a Host header / codegen
 * target uses, e.g. getEndpointHost('api','goldenapp') → api-goldenapp.localhost.
 */
export function getEndpointHost(role, sub) {
  const { hub } = getConfig();
  return fillPattern(hub.hostPattern, { role, sub, host: hub.host });
}

/**
 * PLATFORM (control-plane) GraphQL endpoint for a role — no per-app subdomain, e.g.
 *   getPlatformEndpoint('api')     → http://api.localhost:3000/graphql
 *   getPlatformEndpoint('auth')    → http://auth.localhost:3000/graphql
 *   getPlatformEndpoint('modules') → http://modules.localhost:3000/graphql
 */
export function getPlatformEndpoint(role) {
  const { hub } = getConfig();
  const host = fillPattern(hub.platformHostPattern, { role, host: hub.host });
  return `${hub.scheme}://${host}:${hub.port}${hub.graphqlPath}`;
}

// ── scalar accessors ────────────────────────────────────────────────────────
export function getHubPort() {
  return getConfig().hub.port;
}
export function getHubPrivatePort() {
  return getConfig().hub.privatePort;
}
export function getHubDatabase() {
  return getConfig().db.hubDatabase;
}
export function getRegistryPort() {
  return getConfig().registry.port;
}
export function getRegistryBaseUrl() {
  return getConfig().registry.baseUrl;
}
export function getAppPortBase() {
  return getConfig().app.portBase;
}
// The BASE for dynamic free-port allocation (lib/ports.mjs walks UP from here). Defaults to the
// `${PORT:-3011}` floor the generated app's dev/start script honors. Falls back to portBase only
// if devPortBase is absent (older config), so an old config still resolves to a sane app port.
export function getAppDevPortBase() {
  const { app } = getConfig();
  return app.devPortBase != null ? app.devPortBase : app.portBase;
}
export function getAppBaseUrl(port) {
  const { app } = getConfig();
  return `${app.scheme}://${app.host}:${port != null ? port : app.portBase}`;
}
export function getMailpitUrl() {
  return getConfig().mail.url;
}

// Resolve a dotted key (e.g. "hub.port", "registry.baseUrl") against the resolved
// config. Returns undefined for an unknown path.
export function getValue(dotted) {
  const cfg = getConfig();
  return dotted.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), cfg);
}

// ── CLI (so .sh scripts can read values via `node config.mjs get <key>`) ───────
const HELP = `config.mjs — read constructive.config.json (env overrides applied).

Usage:
  node config.mjs get <dotted.key>          print one resolved value (e.g. hub.port)
  node config.mjs endpoint <role> [<sub>]   per-app role endpoint (with <sub>) or
                                            platform endpoint (no <sub>)
  node config.mjs host <role> <sub>         per-app role HOST only (no scheme/path)
  node config.mjs app-base [<port>]         app base URL (default app.portBase)
  node config.mjs json                      the fully-resolved config as JSON
  node config.mjs --help

Every value is overridable by its env var (see the "env" maps in the JSON).`;

function isMain() {
  // True when run directly (node config.mjs ...), false when imported.
  return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (cmd === 'get') {
      const key = rest[0];
      if (!key) {
        console.error('get: missing <dotted.key>');
        process.exit(2);
      }
      const v = getValue(key);
      if (v === undefined) {
        console.error(`get: unknown key '${key}'`);
        process.exit(2);
      }
      // Print scalars bare; objects as compact JSON.
      console.log(typeof v === 'object' ? JSON.stringify(v) : String(v));
    } else if (cmd === 'endpoint') {
      const [role, sub] = rest;
      if (!role) {
        console.error('endpoint: missing <role>');
        process.exit(2);
      }
      console.log(sub ? getEndpoint(role, sub) : getPlatformEndpoint(role));
    } else if (cmd === 'host') {
      const [role, sub] = rest;
      if (!role || !sub) {
        console.error('host: needs <role> <sub>');
        process.exit(2);
      }
      console.log(getEndpointHost(role, sub));
    } else if (cmd === 'app-base') {
      console.log(getAppBaseUrl(rest[0] ? Number(rest[0]) : undefined));
    } else if (cmd === 'json') {
      console.log(JSON.stringify(getConfig(), null, 2));
    } else {
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`config.mjs: ${e.message}`);
    process.exit(2);
  }
}
