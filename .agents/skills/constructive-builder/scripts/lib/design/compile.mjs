/**
 * scripts/lib/design/compile.mjs — the FAITHFUL design.md → shadcn-token compiler.
 *
 *   compileDesign(design, { defaultMode }) ->
 *     { light:{ '--background':'oklch(..)', ... }, dark:{...}, radius, fonts:{sans,mono}, warnings:[] }
 *   renderOverrideBlock({ light, dark }) -> cssString  (a SINGLE marked block)
 *
 * THE PIVOT (RELAX): this is a FAITHFUL HELPER, not an enforcer. The design.md is
 * the FULL design spec; the agent AUTHORS from it. The only hard rail this file
 * upholds is RAIL 2 — the SHADCN-TOKEN CONTRACT: every shadcn token NAME must end
 * up DEFINED in :root + .dark so Blocks render. So:
 *   (a) FAITHFUL EMIT — an authored design.md value is emitted VERBATIM. No
 *       contrast-clamp, no allowlist-cap, no hue/saturation/pure-black correction.
 *       Taste lives in invariants.mjs as ADVISORY warnings (never clamps here).
 *   (b) SYNTHESIS — any shadcn contract name the design.md leaves UNSPECIFIED is
 *       still DERIVED via OKLCH math (so RAIL 2 always holds). An authored value
 *       for any of these wins verbatim; synthesis is the fallback only.
 *   (c) `.dark` is DERIVED from light (OKLCH lightness inversion) when the design
 *       omits a `dark:` map; an authored `dark:` still wins, emitted verbatim.
 *   (d) PASS-THROUGH — the design.md MAY declare custom tokens (a `tokens:`/`extra:`
 *       map, or non-standard `colors.*` roles) and they flow THROUGH into the
 *       emitted :root/.dark block verbatim, alongside the synthesized shadcn names.
 *
 * `design` is a design.md frontmatter object: `colors` (role->css color),
 * `tokens`/`extra` (custom `--var` -> value, passed through), `rounded`/`radius`,
 * `typography`/`font`, optional `dark` override map, and extension flags. All
 * inputs are color ROLES / custom token names — no app/entity literals.
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

/* The shadcn-token CONTRACT names (RAIL 2). This is the SYNTHESIS set: every name
 * here is GUARANTEED to exist in the emitted :root + .dark — synthesized via OKLCH
 * math when the design.md leaves it unspecified — so Blocks always render. It is
 * NO LONGER a creative cap: the design.md may emit ANY OTHER custom token alongside
 * these (see passThroughTokens). Kept exported as OVERRIDE_SURFACE for back-compat
 * with consumers (wire-design, tests). */
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

/* Alias under the post-pivot name. OVERRIDE_SURFACE is now the SYNTHESIS-GUARANTEE
 * set (the shadcn contract names), not a creative cap. */
export const CONTRACT_NAMES = OVERRIDE_SURFACE;

/* The structural CSS the override block must NEVER carry — emitting any of these
 * inside the marked :root/.dark block would corrupt the Tailwind-v4 wiring (RAIL 2)
 * the agent depends on. These are the only names a passed-through custom token is
 * refused for (still advisory at the design.md level, hard here only because they
 * would break the wiring if injected into the override block). */
const STRUCTURAL_FORBIDDEN = [/^--color-/, /^--font-/, /^--z-layer/, /^--tw-/];

function isStructuralForbidden(bare) {
  return STRUCTURAL_FORBIDDEN.some((re) => re.test(`--${bare}`));
}

/**
 * Collect the design.md's CUSTOM tokens — declared via a `tokens:` or `extra:` map
 * (`{ '--brand-glow': 'oklch(...)', '--space-rhythm': '1.5rem', ... }`) — that are
 * NOT shadcn contract names. These PASS THROUGH verbatim into the emitted block so
 * the design.md can declare its own design language (custom props, ornament tokens,
 * extra fonts) without the compiler dropping them. Keys may be written with or
 * without the leading `--`. Structural-wiring names are skipped (advisory warning).
 */
function passThroughTokens(source, warnings) {
  const out = {};
  for (const raw of [source && source.tokens, source && source.extra]) {
    if (!raw || typeof raw !== 'object') continue;
    for (const [k, v] of Object.entries(raw)) {
      if (v == null) continue;
      // The zero-dep YAML reader keeps surrounding quotes on a quoted key (e.g.
      // `"--brand-glow"`); strip them, then strip a leading `--` so we re-prefix once.
      const bare = String(k).trim().replace(/^["']|["']$/g, '').replace(/^--/, '');
      if (bare === '') continue;
      if (OVERRIDE_SURFACE.has(bare)) continue; // a shadcn name → handled by colors/synthesis
      if (isStructuralForbidden(bare)) {
        if (warnings)
          W(warnings, `custom token --${bare} collides with Tailwind structural wiring; dropped from the override block.`);
        continue;
      }
      out[`--${bare}`] = String(v);
    }
  }
  return out;
}

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
 * A legible text-on-tint foreground for an ALREADY-CHOSEN tint surface (used when
 * the design authors a custom tint but no foreground — we synthesize the foreground
 * against the EXACT authored tint, per mode polarity). Best-pole graceful fallback,
 * never throws.
 */
function tintForeground(tint, mode) {
  const seed =
    mode === 'dark'
      ? { l: 0.96, c: Math.min(tint.c, 0.04), h: tint.h }
      : { l: 0.4, c: Math.min(tint.c, 0.12), h: tint.h };
  try {
    return ensureContrast(seed, tint, 4.5);
  } catch {
    return autoForeground(tint, 4.5);
  }
}

/* The shadcn role NAMES a design.md may author directly (the verbatim surface).
 * When `colors[role]` is present, compile emits it VERBATIM (no clamp/repair);
 * when absent, compile SYNTHESIZES it (so RAIL 2 holds). */
const AUTHORABLE_ROLES = new Set([
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
]);

/**
 * Build the LIGHT token set from the design roles. Returns a map of OKLCH color
 * objects (not strings) so .dark derivation can do math; stringified at the end.
 *
 * FAITHFUL: where `colors[role]` is authored, the value is honored VERBATIM (the
 * `authored(role, derivedFn)` helper short-circuits to the parsed authored color
 * with NO contrast repair). Synthesis (the derivedFn) runs only when a role is
 * unspecified, so RAIL 2 still holds. Aliases (surface/background, error/destructive,
 * on-surface/foreground) map to the canonical shadcn name.
 */
function buildLight(colors, warnings) {
  // authored(role, derive): verbatim if authored, else the synthesized fallback.
  const authored = (role, derive, ...aliases) => {
    for (const name of [role, ...aliases]) {
      if (colors[name] != null) return parseColor(colors[name]);
    }
    return derive();
  };
  const isAuthored = (role, ...aliases) => [role, ...aliases].some((n) => colors[n] != null);

  const surface = parseColor(pick(colors, 'surface', pick(colors, 'background', DEFAULTS.surface)));
  const onSurface = parseColor(pick(colors, 'on-surface', pick(colors, 'foreground', DEFAULTS['on-surface'])));
  const primary = parseColor(pick(colors, 'primary', DEFAULTS.primary));
  const destructive = parseColor(pick(colors, 'error', pick(colors, 'destructive', DEFAULTS.error)));

  // Neutral foundation: derive from surface/on-surface so grays share a temperature.
  const surfIsLight = relativeLuminance(toSrgb(surface)) >= 0.5;
  const towardFg = (delta) => adjustLightness(surface, surfIsLight ? -delta : delta);

  const out = {};

  // A foreground for `surface`: VERBATIM if the design authored `fgRole`, else
  // synthesize a contrast-repaired one (so RAIL 2 holds for unspecified names).
  const fg = (fgRole, surfaceForSynthesis, ...aliases) => {
    for (const name of [fgRole, ...aliases]) {
      if (colors[name] != null) return parseColor(colors[name]); // FAITHFUL, no clamp
    }
    return autoForeground(surfaceForSynthesis, 4.5, warnings, fgRole);
  };

  // surfaces
  out.background = surface; // authored surface/background flows verbatim via `surface`
  out.foreground = onSurface; // authored on-surface/foreground flows verbatim
  out.card = authored(
    'card',
    () => withLightness(adjustLightness(surface, surfIsLight ? -0.0 : 0.02), surfIsLight ? surface.l : surface.l + 0.02)
  );
  out['card-foreground'] = fg('card-foreground', out.card, 'on-surface', 'foreground');
  out.popover = authored('popover', () => out.card);
  out['popover-foreground'] = fg('popover-foreground', out.popover, 'on-surface', 'foreground');

  // primary
  out.primary = primary;
  out['primary-foreground'] = fg('primary-foreground', primary);

  // secondary / muted (neutral subtle surfaces)
  const neutralBase = colors.neutral ? parseColor(colors.neutral) : withChroma(surface, Math.min(surface.c, 0.01));
  out.secondary = authored('secondary', () =>
    withLightness(withChroma(neutralBase, Math.min(neutralBase.c, 0.01)), surfIsLight ? 0.967 : 0.274)
  );
  out['secondary-foreground'] = isAuthored('secondary-foreground')
    ? parseColor(colors['secondary-foreground'])
    : ensureContrast(onSurface, out.secondary, 4.5);
  out.muted = authored('muted', () =>
    withLightness(withChroma(neutralBase, Math.min(neutralBase.c, 0.01)), surfIsLight ? 0.967 : 0.244)
  );
  // synthesized muted-foreground is repaired against `muted` (the painted surface);
  // an AUTHORED muted-foreground passes through verbatim.
  out['muted-foreground'] = isAuthored('muted-foreground')
    ? parseColor(colors['muted-foreground'])
    : ensureContrast(withLightness(onSurface, surfIsLight ? 0.55 : 0.7), out.muted, 4.5);

  // accent: explicit accent/tertiary, else a quiet neutral tint
  const accentSrc = colors.accent || colors.tertiary;
  if (accentSrc) {
    out.accent = parseColor(accentSrc);
    out['accent-foreground'] = fg('accent-foreground', out.accent);
  } else {
    out.accent = out.muted;
    out['accent-foreground'] = isAuthored('accent-foreground')
      ? parseColor(colors['accent-foreground'])
      : out['secondary-foreground'];
  }

  // destructive
  out.destructive = destructive;
  out['destructive-foreground'] = fg('destructive-foreground', destructive);

  // borders / input / ring
  out.border = authored('border', () => towardFg(0.08));
  out.input = authored('input', () => towardFg(0.13));
  out.ring = authored('ring', () => primary);

  // chart ramp: authored chart-N wins; else primary hue rotations [0,+40,-40,+90,-90].
  const chartC = Math.max(0.12, Math.min(primary.c, 0.2));
  const chartL = surfIsLight ? 0.62 : 0.68;
  const rots = [0, 40, -40, 90, -90];
  rots.forEach((deg, i) => {
    out[`chart-${i + 1}`] = authored(`chart-${i + 1}`, () =>
      withLightness(withChroma(rotateHue(primary, deg), chartC), chartL)
    );
  });

  // sidebar: authored wins; else derived from surface/neutral + primary
  out.sidebar = authored('sidebar', () => withLightness(neutralBase, surfIsLight ? 0.985 : 0.244));
  out['sidebar-foreground'] = isAuthored('sidebar-foreground')
    ? parseColor(colors['sidebar-foreground'])
    : ensureContrast(onSurface, out.sidebar, 4.5);
  out['sidebar-primary'] = authored('sidebar-primary', () => primary);
  out['sidebar-primary-foreground'] = fg('sidebar-primary-foreground', out['sidebar-primary']);
  out['sidebar-accent'] = authored('sidebar-accent', () => out.muted);
  out['sidebar-accent-foreground'] = isAuthored('sidebar-accent-foreground')
    ? parseColor(colors['sidebar-accent-foreground'])
    : out['secondary-foreground'];
  out['sidebar-border'] = authored('sidebar-border', () => out.border);
  out['sidebar-ring'] = authored('sidebar-ring', () => primary);

  // status tints (info/success/warning) — authored tint/foreground win VERBATIM;
  // else derive a tint (text-on-tint contract) for unspecified names.
  const tintFor = (role, fallbackHue) => {
    if (isAuthored(role)) {
      out[role] = parseColor(colors[role]);
    } else {
      const src = { l: 0.6, c: 0.13, h: fallbackHue, a: 1 };
      out[role] = tintPair(src, 'light').tint;
    }
    if (isAuthored(`${role}-foreground`)) {
      out[`${role}-foreground`] = parseColor(colors[`${role}-foreground`]); // FAITHFUL
    } else {
      // synthesize a legible text-on-tint foreground against the ACTUAL tint surface.
      out[`${role}-foreground`] = tintForeground(out[role], 'light');
    }
  };
  tintFor('info', 250);
  tintFor('success', 150);
  tintFor('warning', 75);

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

/** Merge an explicit `design.dark` color-role override (strings) over a DERIVED
 * dark token map.
 *
 * PIVOT (FAITHFUL): an authored dark value — surface OR foreground — passes through
 * VERBATIM (no clamp). When the author gives a dark SURFACE but no matching dark
 * foreground, we still SYNTHESIZE that foreground (autoForeground) so RAIL 2 holds;
 * synthesis never throws (best-pole fallback + advisory warning). Authored values
 * always win; synthesis is only the gap-filler. */
function applyDarkOverride(derivedDark, darkColors, warnings) {
  const map = { ...derivedDark };
  const has = (role) => darkColors[role] != null;
  const v = (role) => parseColor(darkColors[role]);

  // surface aliases → background; authored foreground (on-surface/foreground) verbatim.
  if (has('surface')) map.background = v('surface');
  if (has('background')) map.background = v('background');
  if (has('on-surface')) map.foreground = v('on-surface'); // FAITHFUL
  if (has('foreground')) map.foreground = v('foreground'); // FAITHFUL
  // surface authored without an authored foreground → synthesize a legible one.
  if ((has('surface') || has('background')) && !has('on-surface') && !has('foreground')) {
    map.foreground = autoForeground(map.background, 4.5, warnings, 'foreground');
  }

  if (has('primary')) {
    map.primary = v('primary');
    map.ring = withLightness(map.primary, Math.max(map.primary.l, 0.6));
  }
  if (has('primary-foreground')) {
    map['primary-foreground'] = v('primary-foreground'); // FAITHFUL
  } else if (has('primary')) {
    map['primary-foreground'] = autoForeground(map.primary, 4.5, warnings, 'primary-foreground');
  }

  if (has('accent')) map.accent = v('accent');
  if (has('accent-foreground')) {
    map['accent-foreground'] = v('accent-foreground'); // FAITHFUL
  } else if (has('accent')) {
    map['accent-foreground'] = autoForeground(map.accent, 4.5, warnings, 'accent-foreground');
  }

  if (has('error') || has('destructive')) {
    map.destructive = parseColor(darkColors.error || darkColors.destructive);
    map['destructive-foreground'] = has('destructive-foreground')
      ? v('destructive-foreground') // FAITHFUL
      : autoForeground(map.destructive, 4.5, warnings, 'destructive-foreground');
  } else if (has('destructive-foreground')) {
    map['destructive-foreground'] = v('destructive-foreground');
  }
  return map;
}

/** Stringify an OKLCH color map into `--var: oklch(...)` value strings.
 * Emits EVERY shadcn contract name (RAIL 2 synthesis guarantee); a non-contract
 * key in the synthesized map is skipped (it is an internal artifact). Custom
 * pass-through tokens are merged AFTER (see compileDesign), so they survive.
 * Adds the radius scalar. */
function stringify(map, radius) {
  const out = {};
  for (const [key, val] of Object.entries(map)) {
    if (!OVERRIDE_SURFACE.has(key)) continue; // only the synthesized contract names here
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

  // Custom pass-through tokens: top-level `tokens:`/`extra:` apply to BOTH modes;
  // a `dark.tokens:`/`dark.extra:` overrides/adds in dark only. They flow through
  // VERBATIM alongside the synthesized shadcn names (the design.md's own language).
  const sharedTokens = passThroughTokens(d, warnings);
  const darkSource = d.dark && typeof d.dark === 'object' ? d.dark : {};
  const darkTokens = passThroughTokens(darkSource, warnings);

  const light = { ...stringify(lightObjs, radius), ...sharedTokens };
  const dark = { ...stringify(darkObjs, radius), ...sharedTokens, ...darkTokens };

  const result = {
    light,
    dark,
    radius,
    fonts: { sans, mono },
    warnings,
  };
  if (defaultMode) result.defaultMode = defaultMode === 'dark' ? 'dark' : 'light';
  return result;
}

/**
 * Render the single MARKED override block.
 *
 * PIVOT: custom design.md tokens now PASS THROUGH verbatim (no allowlist cap). The
 * ONLY refusal left is a STRUCTURAL-WIRING name (`--color-*` / `--font-*` /
 * `--z-layer*` / `--tw-*`) — emitting one inside this block would corrupt the
 * Tailwind-v4 wiring (RAIL 2). Everything else — shadcn contract names AND the
 * design.md's own custom props — is emitted as the author wrote it.
 */
export function renderOverrideBlock({ light, dark }) {
  const emit = (vars) =>
    Object.entries(vars)
      .map(([k, v]) => {
        const bare = k.replace(/^--/, '');
        if (isStructuralForbidden(bare)) {
          throw new Error(
            `renderOverrideBlock: refusing to emit structural-wiring var "${k}" inside the override block (it would corrupt the Tailwind-v4 @theme/@source wiring — RAIL 2).`
          );
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
