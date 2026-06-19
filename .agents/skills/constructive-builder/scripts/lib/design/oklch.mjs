/**
 * scripts/lib/design/oklch.mjs — OKLCH <-> sRGB color math, WCAG contrast, and
 * the hue-band / lightness / chroma helpers the design compiler leans on.
 *
 * ZERO-DEP. Node >=18 ESM. Pure functions, no I/O.
 *
 * Color objects are `{ l, c, h, a }`:
 *   l  OKLCH lightness   0..1
 *   c  OKLCH chroma      >= 0 (typ. 0..~0.37)
 *   h  OKLCH hue degrees 0..360
 *   a  alpha             0..1 (default 1)
 *
 * The OKLCH<->sRGB pipeline uses the standard Björn Ottosson Oklab matrices.
 * Reference: https://bottosson.github.io/posts/oklab/ (public-domain formulas).
 */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const round = (n, p = 4) => {
  const f = 10 ** p;
  return Math.round(n * f) / f;
};

/* ----------------------------------------------------------------------------
 * sRGB <-> linear
 * ------------------------------------------------------------------------- */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/* ----------------------------------------------------------------------------
 * OKLCH <-> linear sRGB
 * ------------------------------------------------------------------------- */

/** OKLCH ({l,c,h}) -> linear-light sRGB {r,g,b}. */
function oklchToLinearRgb({ l, c, h }) {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  // Oklab -> LMS' (cube root space)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  // LMS -> linear sRGB
  return {
    r: +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  };
}

/** linear-light sRGB {r,g,b} -> OKLCH {l,c,h}. */
function linearRgbToOklch({ r, g, b }) {
  const L = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const M = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const S = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(L);
  const m_ = Math.cbrt(M);
  const s_ = Math.cbrt(S);

  const ll = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const aa = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(aa * aa + bb * bb);
  let h = (Math.atan2(bb, aa) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: ll, c, h };
}

/* ----------------------------------------------------------------------------
 * Public conversions
 * ------------------------------------------------------------------------- */

/** OKLCH -> gamut-clamped sRGB in 0..1 ({r,g,b}). */
export function toSrgb({ l, c, h }) {
  const lin = oklchToLinearRgb({ l, c, h });
  return {
    r: clamp01(linearToSrgb(clamp01(lin.r))),
    g: clamp01(linearToSrgb(clamp01(lin.g))),
    b: clamp01(linearToSrgb(clamp01(lin.b))),
  };
}

/** sRGB 0..1 ({r,g,b}) -> OKLCH ({l,c,h}). */
export function fromSrgb({ r, g, b }) {
  return linearRgbToOklch({
    r: srgbToLinear(r),
    g: srgbToLinear(g),
    b: srgbToLinear(b),
  });
}

/* ----------------------------------------------------------------------------
 * Parsing
 * ------------------------------------------------------------------------- */

function parseHex(str) {
  let s = str.trim().replace(/^#/, '');
  let a = 1;
  if (s.length === 3 || s.length === 4) {
    s = s.split('').map((ch) => ch + ch).join('');
  }
  if (s.length === 8) {
    a = parseInt(s.slice(6, 8), 16) / 255;
    s = s.slice(0, 6);
  }
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) {
    throw new Error(`Invalid hex color: "${str}"`);
  }
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return { ...fromSrgb({ r, g, b }), a };
}

function parseRgb(str) {
  const m = str.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!m) throw new Error(`Invalid rgb color: "${str}"`);
  const parts = m[1].split(/[,/\s]+/).filter(Boolean);
  const chan = (v) => (v.includes('%') ? parseFloat(v) / 100 : parseFloat(v) / 255);
  const r = chan(parts[0]);
  const g = chan(parts[1]);
  const b = chan(parts[2]);
  let a = 1;
  if (parts[3] != null) a = parts[3].includes('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return { ...fromSrgb({ r, g, b }), a };
}

function parseOklchFn(str) {
  const m = str.trim().match(/^oklch\(([^)]+)\)$/i);
  if (!m) throw new Error(`Invalid oklch color: "${str}"`);
  // Split on whitespace and an optional `/ alpha`.
  const [main, alphaPart] = m[1].split('/');
  const parts = main.trim().split(/\s+/).filter(Boolean);
  const num = (v, scale = 1) => (v.includes('%') ? (parseFloat(v) / 100) * scale : parseFloat(v));
  const l = num(parts[0], 1); // 0..1 or 0..100%
  const c = num(parts[1], 0.4); // chroma; % is uncommon but map to 0.4 ref
  const h = parts[2] != null ? parseFloat(parts[2]) : 0;
  let a = 1;
  if (alphaPart != null) {
    const av = alphaPart.trim();
    a = av.includes('%') ? parseFloat(av) / 100 : parseFloat(av);
  }
  return { l, c, h: ((h % 360) + 360) % 360, a };
}

/** Parse a CSS color string into OKLCH `{l,c,h,a}`. Accepts oklch(), hex, rgb(). */
export function parseColor(str) {
  if (typeof str !== 'string') throw new Error(`parseColor expects a string, got ${typeof str}`);
  const s = str.trim();
  if (/^oklch\(/i.test(s)) return parseOklchFn(s);
  if (s.startsWith('#')) return parseHex(s);
  if (/^rgba?\(/i.test(s)) return parseRgb(s);
  // Bare 6/3-digit hex without '#'.
  if (/^[0-9a-fA-F]{3,8}$/.test(s)) return parseHex(s);
  throw new Error(`Unsupported color format: "${str}"`);
}

/** Format an OKLCH color object as a CSS `oklch(...)` string. */
export function formatOklch({ l, c, h, a = 1 }) {
  const L = round(clamp01(l), 4);
  const C = round(Math.max(0, c), 4);
  const H = round(((h % 360) + 360) % 360, 2);
  const base = `oklch(${L} ${C} ${H})`;
  if (a != null && a < 1) return `oklch(${L} ${C} ${H} / ${round(clamp01(a), 3)})`;
  return base;
}

/* ----------------------------------------------------------------------------
 * Luminance + WCAG contrast
 * ------------------------------------------------------------------------- */

/** WCAG relative luminance from sRGB 0..1 ({r,g,b}). */
export function relativeLuminance({ r, g, b }) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio between two colors (each {l,c,h} OKLCH). 1..21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(toSrgb(a));
  const lb = relativeLuminance(toSrgb(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ----------------------------------------------------------------------------
 * Lightness / chroma / hue helpers
 * ------------------------------------------------------------------------- */

/** Return a copy of `color` with lightness set to `l` (clamped 0..1). */
export function withLightness(color, l) {
  return { ...color, l: clamp01(l) };
}

/** Return a copy of `color` with lightness shifted by `delta`. */
export function adjustLightness(color, delta) {
  return { ...color, l: clamp01(color.l + delta) };
}

/** Return a copy of `color` with chroma set to `c` (clamped >= 0). */
export function withChroma(color, c) {
  return { ...color, c: Math.max(0, c) };
}

/** Return a copy of `color` with hue rotated by `deg` (wrapped 0..360). */
export function rotateHue(color, deg) {
  return { ...color, h: ((color.h + deg) % 360 + 360) % 360 };
}

/**
 * The "AI purple/blue" band test. Generic blue-purple hues with non-trivial
 * chroma read as the default-AI look; the taste rules ban them for primary/
 * accent unless explicitly opted in. Band ~ h 255..310 with c > ~0.12.
 */
export function isAiPurpleBand({ h, c }) {
  const hue = ((h % 360) + 360) % 360;
  return hue >= 255 && hue <= 310 && c > 0.12;
}

/**
 * Nudge `fg`'s lightness toward whichever pole improves contrast against `bg`
 * until it reaches `target` (WCAG AA 4.5 by default). Hue/chroma are preserved.
 * Returns the adjusted foreground OKLCH. Throws if even pure black/white can't
 * reach the target against this background (a genuinely impossible pairing).
 */
export function ensureContrast(fg, bg, target = 4.5) {
  if (contrastRatio(fg, bg) >= target) return { ...fg };

  // Decide direction: a dark background wants a lighter fg, and vice-versa.
  const bgLum = relativeLuminance(toSrgb(bg));
  const goLighter = bgLum < 0.5;

  // First, can we even reach target at the extreme (preserving hue/chroma)?
  // Try the extreme; if chroma blocks it, progressively desaturate the extreme.
  const tryAt = (l, c) => contrastRatio({ ...fg, l, c }, bg);

  const extremeL = goLighter ? 1 : 0;
  if (tryAt(extremeL, fg.c) < target) {
    // Chroma may be capping luminance at the extreme — try fully desaturated.
    if (tryAt(extremeL, 0) < target) {
      throw new Error(
        `ensureContrast: cannot reach ${target}:1 against background ${formatOklch(bg)} ` +
          `even with pure ${goLighter ? 'white' : 'black'} foreground.`
      );
    }
    // Desaturating the extreme works — binary-search chroma at the extreme L.
    let loC = 0;
    let hiC = fg.c;
    for (let i = 0; i < 30; i++) {
      const midC = (loC + hiC) / 2;
      if (tryAt(extremeL, midC) >= target) loC = midC;
      else hiC = midC;
    }
    return { ...fg, l: extremeL, c: loC };
  }

  // Binary-search the minimal lightness move (keep as close to original as
  // possible while passing) in the chosen direction, full chroma.
  let lo = goLighter ? fg.l : 0;
  let hi = goLighter ? 1 : fg.l;
  // Ensure the bracket actually straddles the threshold.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const ok = tryAt(mid, fg.c) >= target;
    if (goLighter) {
      // larger L => more contrast (light bg already returned). bg dark here.
      if (ok) hi = mid;
      else lo = mid;
    } else {
      if (ok) lo = mid;
      else hi = mid;
    }
  }
  const finalL = goLighter ? hi : lo;
  return { ...fg, l: clamp01(finalL) };
}
