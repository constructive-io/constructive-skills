/**
 * scripts/lib/scaffold-frontend/codegen-columns.mjs — CODEGEN-ACTUAL COLUMN NAMES
 * (SG-A for COLUMNS): derive every emitted column field name from what CODEGEN produced,
 * not from the brief.
 *
 * SG-A already derives the TABLE-facing identifiers (hooks / data accessor / `_meta`
 * tableName) from the table NAME so the page imports the REAL codegen'd hooks. The
 * SAME hazard exists one level down, on COLUMNS: the platform's construct_blueprint can
 * emit a column under a name that does NOT equal the brief's `camel(field_name)` — e.g.
 * it strips the `_` before a single-char trailing segment, so the brief column
 * `elevation_m` deploys (and codegens) as `elevationm`, `temperature_c` as
 * `temperaturec`, while a multi-char trailing segment (`area_sqm`) survives as `areaSqm`.
 * Emitting the brief-derived camelCase (`elevationM` / `temperatureC`) then breaks tsc
 * (the SDK row/input type has no such member). The fix MIRRORS SG-A: read the names
 * codegen ACTUALLY produced and use those — for EVERY column — so ANY platform name
 * transformation is transparent. There is NO mangling rule encoded here; we never
 * special-case `_<char>` — we just adopt whatever codegen wrote.
 *
 * SOURCE = the generated SDK row interfaces in `@sdk/app`'s types.ts
 * (<src>/graphql/sdk/app/types.ts), which codegen emits at Phase 3 — BEFORE this
 * scaffolder runs at Phase 4. Each table is one `export interface <EntityPascal> { … }`
 * whose members are the codegen-actual camelCase column names (the SAME EntityPascal the
 * page already uses for the `_meta` tableName, so the lookup key is free). When that file
 * is ABSENT (the codegen-free dry-run / the rot-canaries, which scaffold into a bare temp
 * src/ with no SDK) the resolver returns null and EVERY caller falls back to the
 * brief-derived `camel()` name — so a non-mangled brief (every canary fixture) stamps
 * BYTE-IDENTICALLY and the genericity proof holds.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Normalize a camel/identifier to its mangling-insensitive key: lowercase, alnum only.
 *  `elevationM` → `elevationm`, codegen `elevationm` → `elevationm` (they collapse to the
 *  same key); `areaSqm` ↔ `areaSqm` likewise. This is what lets a brief-derived name match
 *  whatever codegen wrote WITHOUT encoding the platform's transform. */
export function normalizeColKey(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Parse the generated SDK `types.ts` once → Map<EntityPascal, string[] memberNames>.
 *  Each `export interface <Name> { a: …; b: …; }` block contributes its member identifiers
 *  (the codegen-actual column names). Tolerant: a missing/unreadable file → empty Map (every
 *  caller then falls back to the brief name). Cached on `ctx` so we read the file at most once
 *  per scaffold run. */
export function codegenInterfaces(srcDir, ctx) {
  if (ctx && ctx._codegenIfaces) return ctx._codegenIfaces;
  const map = new Map();
  // @sdk/app → <src>/graphql/sdk/app (see the app tsconfig `paths`); types.ts holds the rows.
  const typesPath = path.join(srcDir, 'graphql', 'sdk', 'app', 'types.ts');
  let text = '';
  try {
    text = fs.readFileSync(typesPath, 'utf8');
  } catch {
    if (ctx) ctx._codegenIfaces = map;
    return map; // no SDK yet (dry-run / canary) — callers fall back to the brief name.
  }
  // Match each `export interface <Name> { … }` body, then pull the `member:` identifiers.
  const ifaceRe = /export\s+interface\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = ifaceRe.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    const members = [];
    const memRe = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g;
    let mm;
    while ((mm = memRe.exec(body)) !== null) members.push(mm[1]);
    if (members.length) map.set(name, members);
  }
  if (ctx) ctx._codegenIfaces = map;
  return map;
}

/**
 * A per-table column remapper: given the codegen interface for `EntityPascal`, return a
 * function naive→actual that maps a brief-derived camelCase column name to the name codegen
 * ACTUALLY emitted. Resolution:
 *   • exact hit  — the naive name IS a codegen member (the common, non-mangled case) → unchanged.
 *   • unique normalized hit — exactly ONE codegen member shares the naive name's
 *     mangling-insensitive key (normalizeColKey) → adopt that codegen member (e.g. naive
 *     `elevationM` → codegen `elevationm`). The single-match guard means we never guess when a
 *     normalization is ambiguous.
 *   • otherwise   — return the naive name unchanged (no SDK / unknown column / ambiguous) so
 *     behavior degrades to today's brief-derived name (canary byte-identical).
 * GENERIC: derives purely from the codegen output; encodes no entity/column literal and no
 * `_<char>` mangling rule — it adopts whatever codegen wrote, so any platform name transform
 * (this one or a future one) is handled the same way.
 */
export function makeColMapper(srcDir, EntityPascal, ctx) {
  const ifaces = codegenInterfaces(srcDir, ctx);
  const members = ifaces.get(EntityPascal) || null;
  if (!members || members.length === 0) {
    return (naive) => naive; // codegen-free (dry-run/canary) or table not in the SDK → brief name.
  }
  const exact = new Set(members);
  // Build the normalized index, but only keep keys that map to a UNIQUE member (so an
  // ambiguous normalization never silently rewrites to the wrong column).
  const byNorm = new Map();
  const ambiguous = new Set();
  for (const mem of members) {
    const k = normalizeColKey(mem);
    if (byNorm.has(k)) ambiguous.add(k);
    else byNorm.set(k, mem);
  }
  return (naive) => {
    if (exact.has(naive)) return naive; // codegen has this exact name — nothing to remap.
    const k = normalizeColKey(naive);
    if (!ambiguous.has(k) && byNorm.has(k)) return byNorm.get(k); // adopt the codegen-actual name.
    return naive; // unknown/ambiguous — fall back to the brief name (unchanged behavior).
  };
}
