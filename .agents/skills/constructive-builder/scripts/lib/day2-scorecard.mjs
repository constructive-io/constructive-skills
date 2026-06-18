#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * day2-scorecard.mjs — the DAY-2 SCORECARD store + renderer.
 *
 * The multi-turn runner (scripts/multi-turn-run.sh) applies one change per turn and, after
 * each, records HOW that change landed: did the skill path absorb it cleanly, did it need a
 * hand-fix, did it force a full rebuild, was it impossible skill-only, or is a leg still
 * STUBBED (hybrid mode → blocked-stage-c). This module owns that ledger. It is the single
 * place that (1) appends a row, (2) persists the whole scorecard to
 * build/<app-id>/day2-scorecard.json, and (3) renders the markdown table the runner prints.
 *
 * GENERIC BY CONSTRUCTION. Every field comes from the CALLER (the runner, which read it from
 * the turn's turns.json entry + the day2-verify verdict). Nothing here knows about any specific
 * app/domain/entity — it is a typed row store.
 *
 * ── ROW SHAPE ─────────────────────────────────────────────────────────────────
 *   {
 *     turn: <int>,                 // turn number (0 = baseline build)
 *     title: <string>,             // human title from turns.json (e.g. "Add prep_minutes column")
 *     layer: <string>,             // which layer the change touches (e.g. "schema" | "frontend" | "auth")
 *     mechanism: <string>,         // how it was applied (e.g. "additive-column" | "child-table+fk")
 *     verdict: <enum>,             // clean | hand-fixed | rebuild-forced | impossible | blocked-stage-c
 *     seconds: <number>,           // wall-clock for the turn
 *     layers_synced: <string[]>,   // layers that absorbed the change cleanly
 *     layers_drifted: <string[]>,  // layers that drifted / needed intervention
 *     blocker: <string>            // one-line blocker/explanation ('' when clean)
 *   }
 * VERDICTS is the closed set the runner + evaluator agree on; an unknown verdict is rejected.
 *
 * ── PERSISTENCE ───────────────────────────────────────────────────────────────
 *   The file path is given EXPLICITLY by the caller via --file — this lib computes no path itself
 *   (the runner passes build/<app-id>/day2-scorecard.json; that is the canonical location). Shape:
 *     { app_id, db_name, mode, generated_at, rows: [ <row>, ... ] }
 *   `append` reads the existing file (if any), pushes/UPSERTS the row by turn number, rewrites it
 *   (mkdir -p its parent), and prints the updated scorecard as a markdown table to stdout.
 *
 * ── CLI ───────────────────────────────────────────────────────────────────────
 *   node scripts/lib/day2-scorecard.mjs append --file <path> --row '<json>'   # upsert one row
 *   node scripts/lib/day2-scorecard.mjs render --file <path> [--md|--json]     # print table/JSON
 *   node scripts/lib/day2-scorecard.mjs init   --file <path> [--app-id X] [--db-name Y] [--mode M]
 *   node scripts/lib/day2-scorecard.mjs --help
 * The runner uses `append` after every turn and `render --md` at the end. `--row` is the JSON of
 * ONE row (the runner builds it); missing optional fields default sanely.
 *
 * Zero dependencies. Pure Node (>=18).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERDICTS = ['clean', 'hand-fixed', 'rebuild-forced', 'impossible', 'blocked-stage-c'];

// Glyph + (optional) ANSI for each verdict, used only by the stdout renderer (not the .json).
const useColor = process.stdout.isTTY && process.env.NO_COLOR == null;
const paint = (code, s) => (useColor ? `[${code}m${s}[0m` : String(s));
const VERDICT_GLYPH = {
  clean: '✅',
  'hand-fixed': '🔧',
  'rebuild-forced': '♻️',
  impossible: '⛔',
  'blocked-stage-c': '⏸️',
};
const VERDICT_COLOR = {
  clean: '0;32', // green
  'hand-fixed': '1;33', // yellow
  'rebuild-forced': '1;33', // yellow
  impossible: '0;31', // red
  'blocked-stage-c': '2', // dim
};

/** Coerce any value into a clean string[] (array | csv string | falsy → []). */
function asList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/** Validate + normalize a row, filling optional fields. Throws on a bad verdict/turn. */
export function normalizeRow(row) {
  const r = row || {};
  const turn = Number(r.turn);
  if (!Number.isFinite(turn)) throw new Error(`scorecard row: 'turn' must be a number (got ${JSON.stringify(r.turn)})`);
  const verdict = String(r.verdict || '').trim();
  if (!VERDICTS.includes(verdict)) {
    throw new Error(`scorecard row: 'verdict' must be one of ${VERDICTS.join(' | ')} (got ${JSON.stringify(r.verdict)})`);
  }
  const seconds = Number(r.seconds);
  return {
    turn,
    title: String(r.title || '').trim(),
    layer: String(r.layer || '').trim(),
    mechanism: String(r.mechanism || '').trim(),
    verdict,
    seconds: Number.isFinite(seconds) ? seconds : 0,
    layers_synced: asList(r.layers_synced),
    layers_drifted: asList(r.layers_drifted),
    blocker: String(r.blocker || '').trim(),
  };
}

/** Read a scorecard file → its object (or a fresh empty scorecard when absent/unreadable). */
export function readScorecard(file, seed = {}) {
  if (file && existsSync(file)) {
    try {
      const obj = JSON.parse(readFileSync(file, 'utf8'));
      if (obj && Array.isArray(obj.rows)) return obj;
    } catch {
      /* fall through to a fresh scorecard */
    }
  }
  return {
    app_id: seed.appId || '',
    db_name: seed.dbName || '',
    mode: seed.mode || '',
    generated_at: new Date().toISOString(),
    rows: [],
  };
}

/** Write a scorecard object to disk (mkdir -p the parent), refreshing generated_at. */
export function writeScorecard(file, scorecard) {
  if (!file) throw new Error('writeScorecard: a --file path is required');
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const out = { ...scorecard, generated_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
}

/**
 * appendRow — UPSERT a row (by turn number) into the scorecard at `file`, persist, return it.
 * Re-running a turn overwrites its row rather than duplicating it (rows stay sorted by turn).
 * `seed` (appId/dbName/mode) only initializes a brand-new file; it never clobbers existing meta.
 */
export function appendRow(file, row, seed = {}) {
  const scorecard = readScorecard(file, seed);
  // Backfill meta on an existing-but-thin file (keeps non-empty existing values).
  scorecard.app_id = scorecard.app_id || seed.appId || '';
  scorecard.db_name = scorecard.db_name || seed.dbName || '';
  scorecard.mode = scorecard.mode || seed.mode || '';
  const normalized = normalizeRow(row);
  const idx = scorecard.rows.findIndex((r) => Number(r.turn) === normalized.turn);
  if (idx >= 0) scorecard.rows[idx] = normalized;
  else scorecard.rows.push(normalized);
  scorecard.rows.sort((a, b) => Number(a.turn) - Number(b.turn));
  return writeScorecard(file, scorecard);
}

/** Format a seconds count as "Nm SSs" (or "SSs" under a minute), '' for 0/blank. */
function fmtSeconds(s) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  const m = Math.floor(n / 60);
  const ss = Math.round(n % 60);
  return m > 0 ? `${m}m${String(ss).padStart(2, '0')}s` : `${ss}s`;
}

/** Markdown-escape a cell (pipes/newlines would break the table). */
function mdCell(v) {
  return String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * renderMarkdown — the scorecard as a GitHub-flavored markdown table + a totals line.
 * Plain text (no ANSI) so it is safe to paste/commit. The runner prints this to stdout.
 */
export function renderMarkdown(scorecard) {
  const rows = (scorecard && scorecard.rows) || [];
  const lines = [];
  const title = `Day-2 scorecard${scorecard?.db_name ? ` — ${scorecard.db_name}` : ''}${scorecard?.mode ? ` (${scorecard.mode})` : ''}`;
  lines.push(`### ${title}`);
  lines.push('');
  lines.push('| Turn | Title | Layer | Mechanism | Verdict | Time | Synced | Drifted | Blocker |');
  lines.push('|-----:|-------|-------|-----------|---------|-----:|--------|---------|---------|');
  for (const r of rows) {
    lines.push(
      '| ' +
        [
          r.turn,
          mdCell(r.title),
          mdCell(r.layer),
          mdCell(r.mechanism),
          `${VERDICT_GLYPH[r.verdict] || ''} ${r.verdict}`.trim(),
          fmtSeconds(r.seconds),
          mdCell(asList(r.layers_synced).join(', ')),
          mdCell(asList(r.layers_drifted).join(', ')),
          mdCell(r.blocker),
        ].join(' | ') +
        ' |'
    );
  }
  // Totals: per-verdict tally + total wall-clock.
  const tally = {};
  let totalSecs = 0;
  for (const r of rows) {
    tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    totalSecs += Number(r.seconds) || 0;
  }
  const tallyStr = VERDICTS.filter((v) => tally[v]).map((v) => `${tally[v]} ${v}`).join(' · ') || '0 rows';
  lines.push('');
  lines.push(`**Total:** ${rows.length} turn(s) · ${tallyStr}${totalSecs > 0 ? ` · ${fmtSeconds(totalSecs)} wall-clock` : ''}`);
  return lines.join('\n');
}

/**
 * renderAnsi — a colorized terminal table (verdict glyph + ANSI). Used when the runner wants
 * a pretty on-screen render; the committed artifact uses renderMarkdown (plain).
 */
export function renderAnsi(scorecard) {
  const rows = (scorecard && scorecard.rows) || [];
  const headers = ['Turn', 'Title', 'Layer', 'Mechanism', 'Verdict', 'Time', 'Drifted', 'Blocker'];
  const cells = rows.map((r) => [
    String(r.turn),
    r.title || '',
    r.layer || '',
    r.mechanism || '',
    `${VERDICT_GLYPH[r.verdict] || ''} ${r.verdict}`.trim(),
    fmtSeconds(r.seconds),
    asList(r.layers_drifted).join(', '),
    r.blocker || '',
  ]);
  // column widths (strip ANSI when measuring — none here, but future-proof)
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => String(row[i]).length), 1)
  );
  const sep = '─'.repeat(widths.reduce((a, w) => a + w + 3, 1));
  const fmtRow = (row) => '│ ' + row.map((v, i) => String(v).padEnd(widths[i])).join(' │ ') + ' │';
  const out = [];
  out.push(paint('1', sep));
  out.push(paint('1', fmtRow(headers)));
  out.push(paint('2', sep));
  cells.forEach((row, idx) => {
    // colorize just the verdict cell
    const colored = row.map((v, i) =>
      i === 4 ? paint(VERDICT_COLOR[rows[idx].verdict] || '0', String(v).padEnd(widths[i])) : String(v).padEnd(widths[i])
    );
    out.push('│ ' + colored.join(' │ ') + ' │');
  });
  out.push(paint('2', sep));
  return out.join('\n');
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const HELP = `day2-scorecard.mjs — append/emit the DAY-2 scorecard (one row per turn).

Verdicts: ${VERDICTS.join(' | ')}

Usage:
  node scripts/lib/day2-scorecard.mjs init   --file <path> [--app-id X] [--db-name Y] [--mode M]
  node scripts/lib/day2-scorecard.mjs append --file <path> --row '<row-json>' \\
        [--app-id X] [--db-name Y] [--mode M]
  node scripts/lib/day2-scorecard.mjs render --file <path> [--md | --json | --ansi]
  node scripts/lib/day2-scorecard.mjs --help

Row JSON keys (append):
  turn (int, required) · title · layer · mechanism · verdict (required, from the set above) ·
  seconds (number) · layers_synced (array|csv) · layers_drifted (array|csv) · blocker (string)

Behavior:
  • append UPSERTS by turn number, persists build/<app-id>/day2-scorecard.json, and prints the
    updated scorecard as a markdown table to stdout.
  • render prints the scorecard at --file (markdown by default; --json for the raw object;
    --ansi for a colorized terminal table).`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (!out.cmd && !a.startsWith('-')) { out.cmd = a; continue; }
    switch (a) {
      case '--file': out.file = next(); break;
      case '--row': out.row = next(); break;
      case '--app-id': out.appId = next(); break;
      case '--db-name': out.dbName = next(); break;
      case '--mode': out.mode = next(); break;
      case '--md': out.fmt = 'md'; break;
      case '--json': out.fmt = 'json'; break;
      case '--ansi': out.fmt = 'ansi'; break;
      case '-h': case '--help': out.help = true; break;
      default: out._unknown = a;
    }
  }
  return out;
}

function isMain() {
  try {
    return process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.cmd) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  if (args._unknown) {
    console.error(`day2-scorecard: unknown argument: ${args._unknown}\n\n${HELP}`);
    process.exit(2);
  }
  if (!args.file) {
    console.error('day2-scorecard: --file <path> is required.\n\n' + HELP);
    process.exit(2);
  }
  const seed = { appId: args.appId, dbName: args.dbName, mode: args.mode };

  try {
    if (args.cmd === 'init') {
      const sc = readScorecard(args.file, seed);
      // Stamp meta even if the file already existed (init is explicit operator intent).
      sc.app_id = sc.app_id || seed.appId || '';
      sc.db_name = sc.db_name || seed.dbName || '';
      sc.mode = seed.mode || sc.mode || '';
      const written = writeScorecard(args.file, sc);
      console.log(renderMarkdown(written));
    } else if (args.cmd === 'append') {
      if (!args.row) {
        console.error('day2-scorecard append: --row \'<json>\' is required.\n\n' + HELP);
        process.exit(2);
      }
      let row;
      try {
        row = JSON.parse(args.row);
      } catch (e) {
        console.error(`day2-scorecard append: --row is not valid JSON: ${e.message}`);
        process.exit(2);
      }
      const written = appendRow(args.file, row, seed);
      console.log(renderMarkdown(written));
    } else if (args.cmd === 'render') {
      const sc = readScorecard(args.file, seed);
      if (args.fmt === 'json') console.log(JSON.stringify(sc, null, 2));
      else if (args.fmt === 'ansi') console.log(renderAnsi(sc));
      else console.log(renderMarkdown(sc));
    } else {
      console.error(`day2-scorecard: unknown command '${args.cmd}'.\n\n${HELP}`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`day2-scorecard: ${e.message}`);
    process.exit(2);
  }
}
