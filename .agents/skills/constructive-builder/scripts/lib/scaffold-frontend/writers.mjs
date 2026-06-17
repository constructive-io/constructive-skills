/**
 * scripts/lib/scaffold-frontend/writers.mjs — the file-writer + template + small text
 * primitives every emitter shares.
 *
 *   readTemplate          read a template file from a templates dir.
 *   write / skip          record + (unless --dry-run) write a file; record a skip. Both take
 *                         the run `ctx` ({ dryRun, written[], skipped[], warnings[] }).
 *   rel                   path relative to process.cwd() (for log/warn messages).
 *   escapeRegex           escape a string for use inside a RegExp.
 *   indentBlock           indent every line of a fragment by N spaces.
 *   assertNoUnsubstituted fail loudly if a template placeholder survived substitution.
 *
 * All are pure / ctx-threaded — no scaffold-frontend internal state. Lifted VERBATIM so the
 * emitted output (and the dry-run/skip bookkeeping) is byte-identical.
 */

import * as fs from 'fs';
import * as path from 'path';

export function readTemplate(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

export function write(filePath, content, ctx) {
  ctx.written.push(filePath);
  if (ctx.dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function skip(filePath, ctx) {
  ctx.skipped.push(filePath);
}

export function rel(p) {
  return path.relative(process.cwd(), p);
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Indent every line of a JSX fragment by `pad` spaces (first line included). */
export function indentBlock(text, pad) {
  const p = ' '.repeat(pad);
  return String(text)
    .split('\n')
    .map((l) => (l.length ? p + l : l))
    .join('\n');
}

/**
 * Fail loudly if any template placeholder survived substitution (outside comments).
 * `allow` lists INTENTIONAL placeholders that are real, documented seams (e.g. the
 * org ORG_ID_SEAM const) — those are skipped by the guard.
 */
export function assertNoUnsubstituted(name, content, allow = []) {
  for (const line of content.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    const m = line.match(/__[A-Z][A-Z0-9_]*__|__[a-zA-Z]+__/);
    if (m && !allow.includes(m[0])) {
      throw new Error(
        `scaffold-frontend: ${rel(name)} still contains unsubstituted placeholder ${m[0]} — ` +
          'template/substitution drift (see the entity-page.tsx header for the token list).',
      );
    }
  }
}
