#!/usr/bin/env node
/**
 * scripts/scaffold-app.mjs <brief> <appDir> [--phase provision|frontend|all] [--dry-run]
 *
 * The thin WRAPPER over the two staged scaffolders. It exists so a build can call
 * one command, but the two halves run at DIFFERENT points in the 4-phase method —
 * they are NOT a single uninterrupted step, because the frontend generator needs
 * the Phase-3 codegen output (the typed @sdk/app hooks) to exist first.
 *
 *   ┌─ PHASE 2 (Provision) ─ scaffold-provision.mjs ──────────────────────────┐
 *   │  brief → <app>/packages/provision/src/{config,helpers,blueprint,create-db, │
 *   │  provision}.ts + schemas/core.ts. Then the build runs the provisioner +    │
 *   │  `pgpm` to create the DB and provision the modules/blueprint.              │
 *   └────────────────────────────────────────────────────────────────────────┘
 *   ┌─ PHASE 3 (Wire + Codegen) ─ wire-app.mjs + graphql-codegen ──────────────┐
 *   │  NOT done here. The build wires env/providers (scripts/wire-app.mjs) and   │
 *   │  runs codegen so the typed @sdk/app hooks exist.                           │
 *   └────────────────────────────────────────────────────────────────────────┘
 *   ┌─ PHASE 4 (Frontend) ─ scaffold-frontend.mjs ─────────────────────────────┐
 *   │  brief → per-entity CRUD pages + CRUD infra + routes/nav. REQUIRES the     │
 *   │  Phase-3 SDK hooks. Auth/account/org UI is the Blocks on-ramp (shadcn add  │
 *   │  + wire-app), NOT this generator.                                          │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * The presentation (theme) is NOT a pass here: the agent hand-authors the app's
 * globals.css + frontend from its design.md (guided by references/design-guide.md +
 * references/examples/), and the only surviving machine check on it is the FUNCTIONAL
 * Blocks-token gate in check-design.mjs — there is no theme-compiler step to sequence.
 *
 * So: `--phase provision` runs at Phase 2; `--phase frontend` at Phase 4;
 * `--phase all` (default) runs BOTH back-to-back — only correct in a re-run when
 * the app scaffold + codegen ALREADY exist (e.g. regenerating after a brief edit).
 * On a cold first build, call the two phases separately around codegen.
 *
 * GENERIC BY CONSTRUCTION. This wrapper adds no domain knowledge — it only sequences
 * the two brief-driven scaffolders (which carry all the generic intent→blueprint /
 * entity→UI maps in scripts/lib/brief.mjs + the templates).
 *
 * PER-APP STATE (RECON-3). This wrapper takes the brief as an explicit positional and
 * forwards it untouched — it never reads or writes the build/ singletons, so it needs no
 * resolver logic. Under the per-app state convention the brief canonically lives at
 * build/<app-id>/app-brief.yaml (app-id = the brief's naming.db_name), with run-state at
 * build/<app-id>/run-state.json; the legacy build/app-brief.yaml + build/run-state.json
 * remain the single-tenant default. Pass whichever path you scaffolded into.
 *
 * Usage:
 *   node scripts/scaffold-app.mjs build/app-brief.yaml ./my-app                    # both (re-run)
 *   node scripts/scaffold-app.mjs build/app-brief.yaml ./my-app --phase provision  # Phase 2
 *   node scripts/scaffold-app.mjs build/app-brief.yaml ./my-app --phase frontend   # Phase 4
 *   node scripts/scaffold-app.mjs build/app-brief.yaml ./my-app --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHASES = new Set(['provision', 'frontend', 'all']);

function parseArgs(argv) {
  const out = { phase: 'all', dryRun: false, positionals: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--phase') out.phase = argv[++i];
    else if (a.startsWith('--phase=')) out.phase = a.slice('--phase='.length);
    else out.positionals.push(a);
  }
  return out;
}

/** Run a sibling scaffolder as a child process, inheriting stdio. */
function runScaffolder(script, briefPath, appDir, dryRun) {
  const args = [path.join(__dirname, script), briefPath, appDir];
  if (dryRun) args.push('--dry-run');
  const res = spawnSync('node', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`${script} exited with code ${res.status ?? 'null'}`);
  }
}

/**
 * Has Phase-3 codegen run? We look for the @sdk/app target the frontend pages
 * import (the codegen output dir). Best-effort across the nested/flat app layouts.
 */
function sdkLikelyPresent(appDir) {
  const roots = [
    path.join(appDir, 'app', 'src'),
    path.join(appDir, 'packages', 'app', 'src'),
    path.join(appDir, 'src'),
  ];
  for (const r of roots) {
    // graphql/sdk/app is where codegen lands the app namespace hooks.
    if (fs.existsSync(path.join(r, 'graphql', 'sdk', 'app'))) return true;
  }
  return false;
}

function main() {
  const { phase, dryRun, positionals } = parseArgs(process.argv.slice(2));
  const [briefPath, appDir] = positionals;

  if (!briefPath || !appDir) {
    console.error('Usage: node scripts/scaffold-app.mjs <brief.yaml> <appDir> [--phase provision|design|frontend|all] [--dry-run]');
    process.exit(2);
  }
  if (!PHASES.has(phase)) {
    console.error(`scaffold-app: unknown --phase "${phase}". Use provision | frontend | all.`);
    process.exit(2);
  }
  if (!fs.existsSync(briefPath)) {
    console.error(`scaffold-app: brief not found: ${briefPath}`);
    process.exit(2);
  }

  const doProvision = phase === 'provision' || phase === 'all';
  const doFrontend = phase === 'frontend' || phase === 'all';

  if (doProvision) {
    console.log('── scaffold-app: PHASE 2 (provision) ───────────────────────────');
    runScaffolder('scaffold-provision.mjs', briefPath, appDir, dryRun);
  }

  if (doFrontend) {
    // Guard: the frontend pages import the Phase-3 codegen hooks. If they are not
    // present yet, warn (don't hard-fail) — the agent may be intentionally
    // pre-staging, and scaffold-frontend itself only writes files (it does not
    // import the SDK), so the emitted pages just won't typecheck until codegen runs.
    if (phase === 'all' && !dryRun && !sdkLikelyPresent(appDir)) {
      console.warn(
        '── scaffold-app: WARNING — no graphql/sdk/app found under the app dir.\n' +
          '   The frontend pages import the Phase-3 codegen hooks (@sdk/app); they will\n' +
          '   not typecheck until codegen has run. On a COLD build, run provision (Phase 2),\n' +
          '   then wire + codegen (Phase 3), THEN `--phase frontend` (Phase 4) — not `all`.',
      );
    }
    console.log('── scaffold-app: PHASE 4 (frontend) ────────────────────────────');
    runScaffolder('scaffold-frontend.mjs', briefPath, appDir, dryRun);
  }

  console.log('── scaffold-app: done ──────────────────────────────────────────');
}

main();
