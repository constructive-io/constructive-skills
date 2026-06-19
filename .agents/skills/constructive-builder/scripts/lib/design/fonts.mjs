/**
 * scripts/lib/design/fonts.mjs — a curated allowlist of `next/font/google`
 * families, with a resolver that returns the loader name + import line + the
 * CSS variable to bind.
 *
 * The boilerplate `layout.tsx` declares:
 *   const geistSans = Geist({ variable: '--font-geist-sans', subsets:['latin'] })
 *   const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets:['latin'] })
 * and `@theme inline` maps `--font-sans: var(--font-geist-sans)`,
 * `--font-mono: var(--font-geist-mono)`. So a custom font swaps ONLY the loader
 * import + call, KEEPING the variable strings `--font-geist-sans` /
 * `--font-geist-mono` and the body className tokens. fonts.mjs therefore never
 * renames the variable; `variable` below is always one of those two.
 *
 * Non-allowlisted family => Geist fallback + a warning (so a custom font can
 * never break the build).
 *
 * ZERO-DEP. Node >=18 ESM. Pure.
 */

// loaderName is the exact `next/font/google` export. Google font families with
// a space import under an underscored name (e.g. "JetBrains Mono" -> JetBrains_Mono).
const SANS_FONTS = {
  geist: { family: 'Geist', loaderName: 'Geist' },
  outfit: { family: 'Outfit', loaderName: 'Outfit' },
  sora: { family: 'Sora', loaderName: 'Sora' },
  manrope: { family: 'Manrope', loaderName: 'Manrope' },
  inter: { family: 'Inter', loaderName: 'Inter' },
  'plus jakarta sans': { family: 'Plus Jakarta Sans', loaderName: 'Plus_Jakarta_Sans' },
  'ibm plex sans': { family: 'IBM Plex Sans', loaderName: 'IBM_Plex_Sans' },
  'dm sans': { family: 'DM Sans', loaderName: 'DM_Sans' },
  'space grotesk': { family: 'Space Grotesk', loaderName: 'Space_Grotesk' },
  figtree: { family: 'Figtree', loaderName: 'Figtree' },
};

const MONO_FONTS = {
  'geist mono': { family: 'Geist Mono', loaderName: 'Geist_Mono' },
  'jetbrains mono': { family: 'JetBrains Mono', loaderName: 'JetBrains_Mono' },
  'ibm plex mono': { family: 'IBM Plex Mono', loaderName: 'IBM_Plex_Mono' },
  'space mono': { family: 'Space Mono', loaderName: 'Space_Mono' },
  'fira code': { family: 'Fira Code', loaderName: 'Fira_Code' },
  'roboto mono': { family: 'Roboto Mono', loaderName: 'Roboto_Mono' },
  'jetbrains mono variable': { family: 'JetBrains Mono', loaderName: 'JetBrains_Mono' },
};

const SANS_FALLBACK = { family: 'Geist', loaderName: 'Geist', variable: '--font-geist-sans' };
const MONO_FALLBACK = { family: 'Geist Mono', loaderName: 'Geist_Mono', variable: '--font-geist-mono' };

function importLineFor(loaderName) {
  return `import { ${loaderName} } from 'next/font/google';`;
}

/**
 * resolveFont(name, { role } = {}) -> { family, loaderName, importLine, variable, warning? }
 *   role: 'sans' (default) | 'mono' — picks which allowlist + which variable name
 *   to bind. Unknown family => Geist/Geist Mono fallback + a `warning`.
 */
export function resolveFont(name, { role = 'sans' } = {}) {
  const isMono = role === 'mono';
  const table = isMono ? MONO_FONTS : SANS_FONTS;
  const fallback = isMono ? MONO_FALLBACK : SANS_FALLBACK;
  const variable = isMono ? '--font-geist-mono' : '--font-geist-sans';

  if (name == null || String(name).trim() === '') {
    return { ...fallback, importLine: importLineFor(fallback.loaderName) };
  }
  const key = String(name).trim().toLowerCase();
  const hit = table[key];
  if (!hit) {
    return {
      ...fallback,
      importLine: importLineFor(fallback.loaderName),
      warning: `Font "${name}" is not on the ${role} allowlist; falling back to ${fallback.family}.`,
    };
  }
  return {
    family: hit.family,
    loaderName: hit.loaderName,
    importLine: importLineFor(hit.loaderName),
    variable,
  };
}

/** The full allowlist (families only) — handy for docs/validation. */
export function listFonts() {
  return {
    sans: Object.values(SANS_FONTS).map((f) => f.family),
    mono: Object.values(MONO_FONTS).map((f) => f.family),
  };
}
