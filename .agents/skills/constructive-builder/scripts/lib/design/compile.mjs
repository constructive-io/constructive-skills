/**
 * scripts/lib/design/compile.mjs — the load-bearing compiler.
 *
 *   compileDesign(design, { defaultMode }) ->
 *     { light:{ '--background':'oklch(..)', ... }, dark:{...}, radius, fonts:{sans,mono}, warnings:[] }
 *   renderOverrideBlock({ light, dark }) -> cssString  (a SINGLE marked block)
 *
 * Hard rules honored here:
 *   (a) emits ONLY thematic override-surface vars — NEVER structural ones.
 *   (b) runs WCAG-AA contrast repair (ensureContrast) on critical pairs.
 *   (c) derives `.dark` from light by OKLCH lightness inversion + foreground
 *       re-pair when `design.dark` is absent.
 *   (d) honors the success/warning text-on-tint contract (dark-on-tint in light
 *       mode, light-on-tint in dark mode — never naive white).
 *
 * `design` is a design.md frontmatter object: `colors` (role->css color),
 * `rounded`/`radius`, `typography`/`font`, optional `dark` override map, and
 * extension flags. All inputs are color ROLES — no app/entity literals.
 *
 * ZERO-DEP. Node >=18 ESM. Pure (no I/O).
 */

import {
  parseColor,
  formatOklch,
  withLightness,
  adjustLightness,
  withChroma,
  rotateHue,
  ensureContrast,
  contrastRatio,
  relativeLuminance,
  toSrgb,
} from './oklch.mjs';
import { resolveFont } from './fonts.mjs';

/* The ONLY vars compile may emit (the override surface). renderOverrideBlock
 * asserts every emitted key is on this list — a structural-safety guard. */
export const OVERRIDE_SURFACE = new Set([
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'radius',
]);

export const BEGIN_SENTINEL = '/* >>> constructive-builder design overrides (generated) */';
export const END_SENTINEL = '/* <<< constructive-builder design overrides */';

// Sensible default roles (≈ today's neutral light look) when a design omits them.
const DEFAULTS = {
  surface: 'oklch(1 0 0)',
  'on-surface': 'oklch(0.21 0.006 285.885)',
  primary: 'oklch(0.55 0.16 250)',
  error: 'oklch(0.55 0.2 25)',
};

const W = (warnings, msg) => warnings.push(msg);

function pick(colors, role, fallback) {
  return colors[role] != null ? colors[role] : fallback;
}

/**
 * A contrast-repaired foreground for `bg`: start from near-white or near-black
 * by the background luminance, then ensureContrast nudges it to AA. If `bg` is
 * an inherently mid-luminance brand color that cannot carry AA-4.5 text of
 * either polarity (e.g. a vivid mid orange used as a SOLID button surface), we
 * do NOT crash the whole compile — we pick the higher-contrast pole and, when a
 * `warnings`/`label` sink is supplied, record an honest warning. This is the
 * standard shadcn behavior for accent/destructive surfaces; the lint layer
 * already surfaces such pairs to the author.
 */
function autoForeground(bg, target = 4.5, warnings, label) {
  const bgLum = relativeLuminance(toSrgb(bg));
  const seed = bgLum < 0.5 ? { l: 0.985, c: 0, h: bg.h } : { l: 0.18, c: 0, h: bg.h };
  try {
    return ensureContrast(seed, bg, target);
  } catch {
    // Best achievable: pure white vs pure black, whichever wins on this bg.
    const white = { l: 1, c: 0, h: bg.h, a: 1 };
    const black = { l: 0, c: 0, h: bg.h, a: 1 };
    const best = contrastRatio(white, bg) >= contrastRatio(black, bg) ? white : black;
    if (warnings && label) {
      W(
        warnings,
        `${label}: no AA-4.5 foreground exists on ${formatOklch(bg)} (best ${contrastRatio(best, bg).toFixed(2)}:1); used the higher-contrast pole.`
      );
    }
    return best;
  }
}

/**
 * The text-on-tint contract. Status tints (info/success/warning) are surfaces
 * that carry text, so the SURFACE lightness must leave room for legible text of
 * the contract polarity:
 *   light mode -> a LIGHT pastel tint with DARK-on-tint text
 *   dark  mode -> a DEEP   tint with LIGHT-on-tint text
 * A mid-luminance tint cannot carry AA-4.5 text of either polarity, so we tone
 * the tint into the right band first, then contrast-repair the foreground.
 * Returns { tint, foreground } (both OKLCH). Never naive white.
 */
function tintPair(src, mode) {
  if (mode === 'dark') {
    const tint = withLightness(withChroma(src, Math.min(src.c, 0.09)), 0.32);
    const seed = { l: 0.96, c: Math.min(src.c, 0.04), h: src.h };
    return { tint, foreground: ensureContrast(seed, tint, 4.5) };
  }
  const tint = withLightness(withChroma(src, Math.min(src.c, 0.06)), 0.94);
  const seed = { l: 0.4, c: Math.min(src.c, 0.12), h: src.h };
  return { tint, foreground: ensureContrast(seed, tint, 4.5) };
}

/**
 * Build the LIGHT token set from the design roles. Returns a map of OKLCH color
 * objects (not strings) so .dark derivation can do math; stringified at the end.
 */
function buildLight(colors, warnings) {
  const surface = parseColor(pick(colors, 'surface', pick(colors, 'background', DEFAULTS.surface)));
  const onSurface = parseColor(pick(colors, 'on-surface', pick(colors, 'foreground', DEFAULTS['on-surface'])));
  const primary = parseColor(pick(colors, 'primary', DEFAULTS.primary));
  const destructive = parseColor(pick(colors, 'error', pick(colors, 'destructive', DEFAULTS.error)));

  // Neutral foundation: derive from surface/on-surface so grays share a temperature.
  const surfIsLight = relativeLuminance(toSrgb(surface)) >= 0.5;
  const towardFg = (delta) => adjustLightness(surface, surfIsLight ? -delta : delta);

  const out = {};

  // surfaces
  out.background = surface;
  out.foreground = onSurface;
  out.card = adjustLightness(surface, surfIsLight ? -0.0 : 0.02); // small elevation
  out.card = withLightness(out.card, surfIsLight ? surface.l : surface.l + 0.02);
  out['card-foreground'] = onSurface;
  out.popover = out.card;
  out['popover-foreground'] = onSurface;

  // primary
  out.primary = primary;
  out['primary-foreground'] = autoForeground(primary, 4.5, warnings, 'primary-foreground');

  // secondary / muted (neutral subtle surfaces)
  const neutralBase = colors.neutral ? parseColor(colors.neutral) : withChroma(surface, Math.min(surface.c, 0.01));
  out.secondary = withLightness(withChroma(neutralBase, Math.min(neutralBase.c, 0.01)), surfIsLight ? 0.967 : 0.274);
  out['secondary-foreground'] = ensureContrast(onSurface, out.secondary, 4.5);
  out.muted = withLightness(withChroma(neutralBase, Math.min(neutralBase.c, 0.01)), surfIsLight ? 0.967 : 0.244);
  // muted-foreground is RENDERED on `muted` (a subtle tinted surface), not on the
  // page background — so repair it against `muted` (the actual painted surface).
  // Repairing against `surface` left it ~4.41:1 on the slightly-darker muted tint
  // (a real WCAG miss). secondary shares muted's lightness band, so the same fg
  // clears it too.
  out['muted-foreground'] = ensureContrast(withLightness(onSurface, surfIsLight ? 0.55 : 0.7), out.muted, 4.5);

  // accent: explicit accent/tertiary, else a desaturated primary
  const accentSrc = colors.accent || colors.tertiary;
  if (accentSrc) {
    out.accent = parseColor(accentSrc);
    out['accent-foreground'] = autoForeground(out.accent, 4.5, warnings, 'accent-foreground');
  } else {
    // app-appropriate quiet accent surface (neutral tint), foreground = on-surface
    out.accent = out.muted;
    out['accent-foreground'] = out['secondary-foreground'];
  }

  // destructive
  out.destructive = destructive;
  out['destructive-foreground'] = autoForeground(destructive, 4.5, warnings, 'destructive-foreground');

  // borders / input / ring
  out.border = towardFg(0.08);
  out.input = towardFg(0.13);
  out.ring = primary;

  // chart ramp: primary hue rotations [0,+40,-40,+90,-90], fixed chroma/L
  const chartC = Math.max(0.12, Math.min(primary.c, 0.2));
  const chartL = surfIsLight ? 0.62 : 0.68;
  const rots = [0, 40, -40, 90, -90];
  rots.forEach((deg, i) => {
    out[`chart-${i + 1}`] = withLightness(withChroma(rotateHue(primary, deg), chartC), chartL);
  });

  // sidebar: derived from surface/neutral + primary
  out.sidebar = withLightness(neutralBase, surfIsLight ? 0.985 : 0.244);
  out['sidebar-foreground'] = ensureContrast(onSurface, out.sidebar, 4.5);
  out['sidebar-primary'] = primary;
  out['sidebar-primary-foreground'] = autoForeground(primary);
  out['sidebar-accent'] = out.muted;
  out['sidebar-accent-foreground'] = out['secondary-foreground'];
  out['sidebar-border'] = out.border;
  out['sidebar-ring'] = primary;

  // status tints (info/success/warning) — derive tints if the design gives a hue,
  // else use canonical hues. Foregrounds follow the text-on-tint contract.
  const tintFor = (role, fallbackHue) => {
    const src = colors[role] ? parseColor(colors[role]) : { l: 0.6, c: 0.13, h: fallbackHue, a: 1 };
    const { tint, foreground } = tintPair(src, 'light');
    out[role] = tint;
    out[`${role}-foreground`] = colors[`${role}-foreground`]
      ? ensureContrast(parseColor(colors[`${role}-foreground`]), tint, 4.5)
      : foreground;
  };
  tintFor('info', 250);
  tintFor('success', 150);
  tintFor('warning', 75);

  // Final critical-pair repair (fg/bg) — never green-wash, ensureContrast moves L.
  out.foreground = ensureContrast(out.foreground, out.background, 4.5);
  out['card-foreground'] = ensureContrast(out['card-foreground'], out.card, 4.5);
  out['popover-foreground'] = ensureContrast(out['popover-foreground'], out.popover, 4.5);

  return out;
}

/** Invert a LIGHT OKLCH token map into a derived DARK map (lightness inversion
 * around mid + foreground re-pair). Hue/chroma preserved; surfaces clamped. */
function deriveDark(light, warnings) {
  const dark = {};
  // 1) Surfaces: invert lightness (1 - L) but clamp into a comfortable dark band.
  const invertSurface = (col) => {
    const l = 1 - col.l;
    // Map a near-white surface (~1) to ~0.21, keep mid-tones reasonable.
    const clamped = Math.max(0.16, Math.min(0.3, l <= 0.3 ? 0.21 : l));
    return withLightness(col, clamped);
  };
  dark.background = invertSurface(light.background);
  dark.card = adjustLightness(dark.background, 0.03);
  dark.popover = dark.card;
  dark.secondary = adjustLightness(dark.background, 0.06);
  dark.muted = adjustLightness(dark.background, 0.04);
  dark.accent = light.accent ? withLightness(light.accent, light.accent.l < 0.5 ? light.accent.l : 0.27) : dark.muted;
  dark.sidebar = adjustLightness(dark.background, 0.04);
  dark.border = adjustLightness(dark.background, 0.09);
  dark.input = adjustLightness(dark.background, 0.09);

  // 2) Chromatic brand colors: keep hue/chroma, lift L a touch for dark legibility.
  const lift = (col) => withLightness(col, Math.max(col.l, 0.6));
  dark.primary = light.primary; // primary stays the brand color
  dark.destructive = light.destructive;
  dark.ring = lift(light.ring);
  dark['sidebar-primary'] = light['sidebar-primary'];
  dark['sidebar-ring'] = lift(light['sidebar-ring']);
  for (let i = 1; i <= 5; i++) dark[`chart-${i}`] = withLightness(light[`chart-${i}`], 0.7);

  // 3) Foregrounds re-paired against the NEW dark surfaces (light-on-dark).
  dark.foreground = autoForeground(dark.background);
  dark['card-foreground'] = autoForeground(dark.card);
  dark['popover-foreground'] = autoForeground(dark.popover);
  dark['secondary-foreground'] = autoForeground(dark.secondary);
  // Repair against `muted` — the surface this text is actually painted on — not
  // the page background (the two differ slightly, so background-repair could leave
  // the rendered pair under AA).
  dark['muted-foreground'] = ensureContrast(withLightness(dark.foreground, 0.7), dark.muted, 4.5);
  dark['accent-foreground'] = autoForeground(dark.accent);
  dark['primary-foreground'] = autoForeground(dark.primary);
  dark['destructive-foreground'] = autoForeground(dark.destructive);
  dark['sidebar-foreground'] = autoForeground(dark.sidebar);
  dark['sidebar-primary-foreground'] = autoForeground(dark['sidebar-primary']);
  dark['sidebar-accent'] = dark.muted;
  dark['sidebar-accent-foreground'] = autoForeground(dark.muted);
  dark['sidebar-border'] = dark.border;

  // 4) Status tints: keep hue/chroma, lift L for dark surfaces; foreground is
  //    LIGHT-on-tint per the text-on-tint contract in dark mode.
  for (const role of ['info', 'success', 'warning']) {
    const { tint, foreground } = tintPair(light[role], 'dark');
    dark[role] = tint;
    dark[`${role}-foreground`] = foreground;
  }

  return dark;
}

/**
 * Repair an EXPLICITLY-AUTHORED foreground against its surface WITHOUT ever
 * throwing. ensureContrast hard-throws when a surface cannot carry AA-4.5 text of
 * either polarity (a vivid mid-luminance brand color used as a SOLID surface), so
 * a raw `ensureContrast(authored, surface)` in the explicit-dark-override branch
 * would propagate that throw out of compileDesign entirely (the pipeline then
 * silently degrades to the default look). We mirror autoForeground's graceful
 * contract: try to honor + repair the authored color toward AA; if even that is
 * impossible on this surface, fall back to the best-contrast pole (white/black)
 * and record an honest warning. NEVER crashes — same discipline as every other
 * foreground path in this compiler.
 */
function repairAuthoredForeground(authored, surface, warnings, label) {
  try {
    return ensureContrast(authored, surface, 4.5);
  } catch {
    // Authored color cannot reach AA against this surface even at its extreme —
    // defer to autoForeground's best-pole fallback (which also warns).
    return autoForeground(surface, 4.5, warnings, label);
  }
}

/** Merge an explicit `design.dark` color-role override (strings) over a derived
 * dark token map, re-pairing affected foregrounds. Every foreground pairing here
 * goes through the graceful best-pole fallback (repairAuthoredForeground /
 * autoForeground), so a legible-impossible authored pairing produces a WARN +
 * best-pole color — it NEVER throws out of compileDesign. */
function applyDarkOverride(derivedDark, darkColors, warnings) {
  const map = { ...derivedDark };
  const setSurface = (key, role, fgKey) => {
    if (darkColors[role]) {
      map[key] = parseColor(darkColors[role]);
      if (fgKey) map[fgKey] = autoForeground(map[key], 4.5, warnings, fgKey);
    }
  };
  setSurface('background', 'surface', 'foreground');
  setSurface('background', 'background', 'foreground');
  if (darkColors['on-surface'])
    map.foreground = repairAuthoredForeground(parseColor(darkColors['on-surface']), map.background, warnings, 'foreground');
  if (darkColors.foreground)
    map.foreground = repairAuthoredForeground(parseColor(darkColors.foreground), map.background, warnings, 'foreground');
  if (darkColors.primary) {
    map.primary = parseColor(darkColors.primary);
    // Honor an explicitly authored dark primary-foreground (contract: an explicit
    // dark: block is used, not re-derived) — but route it through the graceful
    // best-pole fallback so a vivid mid-luminance primary can never crash compile.
    map['primary-foreground'] = darkColors['primary-foreground']
      ? repairAuthoredForeground(parseColor(darkColors['primary-foreground']), map.primary, warnings, 'primary-foreground')
      : autoForeground(map.primary, 4.5, warnings, 'primary-foreground');
    map.ring = withLightness(map.primary, Math.max(map.primary.l, 0.6));
  } else if (darkColors['primary-foreground']) {
    map['primary-foreground'] = repairAuthoredForeground(
      parseColor(darkColors['primary-foreground']),
      map.primary,
      warnings,
      'primary-foreground'
    );
  }
  if (darkColors.accent) {
    map.accent = parseColor(darkColors.accent);
    map['accent-foreground'] = darkColors['accent-foreground']
      ? repairAuthoredForeground(parseColor(darkColors['accent-foreground']), map.accent, warnings, 'accent-foreground')
      : autoForeground(map.accent, 4.5, warnings, 'accent-foreground');
  }
  if (darkColors.error || darkColors.destructive) {
    map.destructive = parseColor(darkColors.error || darkColors.destructive);
    map['destructive-foreground'] = autoForeground(map.destructive, 4.5, warnings, 'destructive-foreground');
  }
  return map;
}

/** Stringify an OKLCH color map into `--var: oklch(...)` value strings,
 * keeping ONLY override-surface keys. Adds the radius scalar. */
function stringify(map, radius) {
  const out = {};
  for (const [key, val] of Object.entries(map)) {
    if (!OVERRIDE_SURFACE.has(key)) continue; // structural-safety
    out[`--${key}`] = formatOklch(val);
  }
  out['--radius'] = radius;
  return out;
}

/**
 * compileDesign(design, { defaultMode } = {}) — the public entry.
 */
export function compileDesign(design, { defaultMode } = {}) {
  const warnings = [];
  const d = design || {};
  const colors = d.colors || {};

  if (!colors.primary) W(warnings, 'No primary color provided; using a neutral default primary.');

  const lightObjs = buildLight(colors, warnings);

  let darkObjs;
  if (d.dark && typeof d.dark === 'object' && d.dark.colors && typeof d.dark.colors === 'object') {
    // Explicit dark palette: derive baseline then overlay the explicit roles.
    darkObjs = applyDarkOverride(deriveDark(lightObjs, warnings), d.dark.colors, warnings);
  } else if (d.dark && typeof d.dark === 'object') {
    // `dark:` is itself a color-role map.
    darkObjs = applyDarkOverride(deriveDark(lightObjs, warnings), d.dark, warnings);
  } else {
    darkObjs = deriveDark(lightObjs, warnings);
  }

  // radius: design.radius || rounded.md || 0.5rem
  const radius =
    (typeof d.radius === 'string' && d.radius) ||
    (d.rounded && typeof d.rounded === 'object' && (d.rounded.md || d.rounded.default)) ||
    '0.5rem';

  // fonts (only family names resolved here; the layout codemod consumes them)
  const fontCfg = d.font || (d.typography && d.typography.font) || {};
  const sans = resolveFont(fontCfg.sans || (d.typography && d.typography.sans), { role: 'sans' });
  const mono = resolveFont(fontCfg.mono || (d.typography && d.typography.mono), { role: 'mono' });
  if (sans.warning) W(warnings, sans.warning);
  if (mono.warning) W(warnings, mono.warning);

  const result = {
    light: stringify(lightObjs, radius),
    dark: stringify(darkObjs, radius),
    radius,
    fonts: { sans, mono },
    warnings,
  };
  if (defaultMode) result.defaultMode = defaultMode === 'dark' ? 'dark' : 'light';
  return result;
}

/** Render the single MARKED override block. Asserts override-surface only. */
export function renderOverrideBlock({ light, dark }) {
  const emit = (vars) =>
    Object.entries(vars)
      .map(([k, v]) => {
        const bare = k.replace(/^--/, '');
        if (!OVERRIDE_SURFACE.has(bare)) {
          throw new Error(`renderOverrideBlock: refusing to emit non-override-surface var "${k}".`);
        }
        return `    ${k}: ${v};`;
      })
      .join('\n');

  return [
    BEGIN_SENTINEL,
    ':root {',
    emit(light),
    '}',
    '.dark {',
    emit(dark),
    '}',
    END_SENTINEL,
    '',
  ].join('\n');
}
