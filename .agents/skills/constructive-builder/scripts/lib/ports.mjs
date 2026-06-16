#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ports.mjs — dynamic free-port allocation so concurrent Constructive apps never collide.
 *
 * A per-app brief may carry a `frontend_port` (the desired dev-server port), but it is only a
 * BASE: if two apps share a base (or it is already taken by an earlier dev server), they would
 * collide on the same Next.js port. allocateAppPort() walks UP from the base and returns the
 * first port that is actually FREE to bind, so each app gets its own port deterministically.
 *
 * One file feeds BOTH worlds:
 *   • .mjs scripts  →  `import { allocateAppPort } from './lib/ports.mjs'`
 *   • .sh scripts   →  `node scripts/lib/ports.mjs allocate [<base>]`  (prints the chosen port,
 *                       one line, no quotes — safe for `$(...)`).
 *
 * The BASE defaults to the app dev-port base in constructive.config.json (app.devPortBase = 3011,
 * the same `${PORT:-3011}` floor the generated app's dev/start script honors). De-hardcoding
 * changes WHERE the base is read from, not WHAT it defaults to.
 *
 * Zero dependencies. Pure Node net probe (fast: each probe binds+closes an ephemeral listener).
 */

import net from 'node:net';
import { getAppDevPortBase } from './config.mjs';

// Highest dev-server port we will hand out before giving up (base + this span). A generous window
// so many concurrent apps each get their own port; small enough that an exhausted range fails fast.
const MAX_PORT_SPAN = 200;
const ABSOLUTE_MAX_PORT = 65535;

/**
 * Resolve the allocation base: an explicit argument wins, else the config app dev-port base
 * (app.devPortBase, default 3011). A non-finite / out-of-range value falls back to the config base.
 */
export function resolveBase(base) {
  const cfgBase = Number(getAppDevPortBase());
  const fallback = Number.isFinite(cfgBase) && cfgBase > 0 ? Math.floor(cfgBase) : 3011;
  if (base == null || base === '') return fallback;
  const n = Number(base);
  if (!Number.isFinite(n) || n <= 0 || n > ABSOLUTE_MAX_PORT) return fallback;
  return Math.floor(n);
}

/**
 * True when `port` can be bound on 0.0.0.0 (i.e. it is free for a dev server to listen on).
 * Uses a one-shot listener with exclusive bind; resolves false on EADDRINUSE/EACCES, true otherwise.
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => {
      // EADDRINUSE (taken) / EACCES (privileged) → treat as not free; never throw.
      try {
        srv.close();
      } catch {
        /* ignore */
      }
      resolve(false);
    });
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    // exclusive:true so we don't get a shared bind that a real listener would still conflict with.
    srv.listen({ port, host: '0.0.0.0', exclusive: true });
  });
}

/**
 * allocateAppPort(base?) → the first FREE TCP port at/above the base.
 *
 *   • base omitted → config app.devPortBase (default 3011).
 *   • Probes base, base+1, … up to base+MAX_PORT_SPAN (capped at 65535).
 *   • Returns the first free port. Throws only if the whole window is occupied.
 *
 * NOTE: this is a point-in-time probe — the returned port is free NOW. The caller should bind it
 * (start the dev server) promptly; we persist it into the per-app run-state so every consumer
 * targets the SAME chosen port instead of re-deriving a possibly-different one.
 */
export async function allocateAppPort(base) {
  const start = resolveBase(base);
  const end = Math.min(start + MAX_PORT_SPAN, ABSOLUTE_MAX_PORT);
  for (let port = start; port <= end; port++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `allocateAppPort: no free port in [${start}, ${end}] — too many dev servers are running, or the range is blocked. Free a port or set a different app.devPortBase (CONSTRUCTIVE_APP_DEV_PORT_BASE).`
  );
}

// ── CLI (so .sh scripts can allocate via `node ports.mjs allocate [<base>]`) ───────
const HELP = `ports.mjs — allocate the first FREE TCP port at/above a base (default app.devPortBase=3011).

Usage:
  node ports.mjs allocate [<base>]   print the first free port >= base (or the config dev-port base)
  node ports.mjs free <port>         exit 0 if <port> is free to bind, 1 if taken
  node ports.mjs --help

The base defaults to constructive.config.json app.devPortBase (env CONSTRUCTIVE_APP_DEV_PORT_BASE).`;

function isMain() {
  const here = new URL(import.meta.url).pathname;
  return process.argv[1] && process.argv[1] === here;
}

if (isMain()) {
  const [cmd, ...rest] = process.argv.slice(2);
  (async () => {
    try {
      if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'allocate') {
        if (cmd === '--help' || cmd === '-h') {
          console.log(HELP);
          process.exit(0);
        }
        const port = await allocateAppPort(rest[0]);
        console.log(String(port));
        process.exit(0);
      } else if (cmd === 'free') {
        const port = Number(rest[0]);
        if (!Number.isFinite(port)) {
          console.error('free: needs <port>');
          process.exit(2);
        }
        process.exit((await isPortFree(port)) ? 0 : 1);
      } else {
        console.error(`unknown command: ${cmd}\n\n${HELP}`);
        process.exit(2);
      }
    } catch (e) {
      console.error(`ports.mjs: ${e.message}`);
      process.exit(2);
    }
  })();
}
