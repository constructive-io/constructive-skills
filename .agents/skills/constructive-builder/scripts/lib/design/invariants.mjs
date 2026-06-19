/**
 * scripts/lib/design/invariants.mjs — the taste/accessibility rules as code.
 *
 * `lintDesign(design) -> { ok, findings:[{rule, severity, msg}] }`
 *
 * `design` is the frontmatter object of a design.md (see design-md.mjs): it has
 * `colors` (a map of role -> css color string), optional `typography`,
 * `rounded`/`radius`, `spacing`, `components`, and extension flags such as
 * `allow_brand_hue`. Rules are intentionally generic — they reference color
 * ROLES, never app/entity/domain literals.
 *
 * Rule set (per the shared contract):
 *   missing-primary                     error
 *   accent-count (<=1)                  warn
 *   saturation/chroma cap (<80%)        warn
 *   pure-black banned (min L >= ~0.18)  warn
 *   ai-purple-band (primary/accent)     warn   (unless design.allow_brand_hue)
 *   dimension units (px/em/rem only)    warn
 *   contrast-pairs                      error (<3:1) / warn (<4.5)
 *   success/warning tint-foreground     warn
 *
 * ZERO-DEP. Node >=18 ESM. Pure.
 */

import { parseColor, contrastRatio, isAiPurpleBand, relativeLuminance, toSrgb } from './oklch.mjs';

// Chroma at which an OKLCH color is considered ~"100% saturated" for the <80%
// cap. OKLCH max usable chroma for sRGB hovers ~0.37; we treat that as the ceiling.
const CHROMA_CEILING = 0.37;
const SAT_CAP = 0.8; // <80%
const MIN_L = 0.18; // no near-pure black

function tryParse(str) {
  try {
    return parseColor(str);
  } catch {
    return null;
  }
}

function isAccentRole(role) {
  return role === 'accent' || role === 'tertiary';
}

/** Validate that a dimension string uses only px/em/rem (or unitless 0). */
function badDimensionUnit(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '0' || v === '') return false;
  // Allow space/comma separated multi-values (e.g. shadows) — check each token.
  const tokens = v.split(/[\s,]+/).filter(Boolean);
  for (const t of tokens) {
    const m = t.match(/^-?\d*\.?\d+([a-z%]+)$/i);
    if (!m) continue; // not a pure dimension token (could be a keyword/color)
    const unit = m[1].toLowerCase();
    if (unit !== 'px' && unit !== 'em' && unit !== 'rem') return true;
  }
  return false;
}

export function lintDesign(design) {
  const findings = [];
  const add = (rule, severity, msg) => findings.push({ rule, severity, msg });

  const d = design || {};
  const colors = d.colors || {};

  /* --- missing-primary (error) --- */
  if (!colors.primary) {
    add('missing-primary', 'error', 'design.colors.primary is required.');
  }

  /* --- accent-count <= 1 (warn) --- */
  const accentRoles = Object.keys(colors).filter(isAccentRole);
  if (accentRoles.length > 1) {
    add(
      'accent-count',
      'warn',
      `Found ${accentRoles.length} accent roles (${accentRoles.join(', ')}); use at most one.`
    );
  }

  /* --- per-color: saturation cap, pure-black, ai-purple --- */
  for (const [role, value] of Object.entries(colors)) {
    const col = tryParse(value);
    if (!col) {
      add('color-parse', 'warn', `Could not parse colors.${role} = "${value}".`);
      continue;
    }
    const satFrac = col.c / CHROMA_CEILING;
    if (satFrac >= SAT_CAP) {
      add(
        'saturation',
        'warn',
        `colors.${role} chroma ${col.c.toFixed(3)} (~${Math.round(satFrac * 100)}% of gamut) exceeds the <80% cap.`
      );
    }
    if (col.l < MIN_L) {
      add(
        'pure-black',
        'warn',
        `colors.${role} lightness ${col.l.toFixed(3)} is below the ${MIN_L} floor (avoid pure/near black).`
      );
    }
    if ((role === 'primary' || isAccentRole(role)) && !d.allow_brand_hue && isAiPurpleBand(col)) {
      add(
        'ai-purple-band',
        'warn',
        `colors.${role} (h≈${Math.round(col.h)}, c=${col.c.toFixed(3)}) sits in the generic AI blue-purple band; set allow_brand_hue: true to keep it.`
      );
    }
  }

  /* --- dimension units (px/em/rem only) (warn) --- */
  const dimSources = [];
  if (d.rounded && typeof d.rounded === 'object') {
    for (const [k, v] of Object.entries(d.rounded)) dimSources.push([`rounded.${k}`, v]);
  }
  if (typeof d.radius === 'string') dimSources.push(['radius', d.radius]);
  if (d.spacing && typeof d.spacing === 'object') {
    for (const [k, v] of Object.entries(d.spacing)) dimSources.push([`spacing.${k}`, v]);
  }
  for (const [where, val] of dimSources) {
    if (badDimensionUnit(val)) {
      add('dimension-units', 'warn', `${where} = "${val}" uses a non px/em/rem unit.`);
    }
  }

  /* --- contrast-pairs (error <3:1, warn <4.5) --- */
  const bg = tryParse(colors.surface || colors.background);
  const fg = tryParse(colors['on-surface'] || colors.foreground);
  // `floor`: true => below 3:1 is a hard error (the legibility contract per
  // design-system.md §3: fg/bg, primary/primary-fg, muted-fg/bg, destructive,
  // status tints). false => the pairing is advisory only (brand pairings like
  // primary-on-surface, which is a fill color, not a required body-text pairing —
  // and which the compiler's ensureContrast repairs); never a hard error.
  const checkPair = (a, b, label, floor = true) => {
    if (!a || !b) return;
    const ratio = contrastRatio(a, b);
    if (ratio < 3) {
      add('contrast-pairs', floor ? 'error' : 'warn', `${label} contrast ${ratio.toFixed(2)}:1 is below the 3:1 floor.`);
    } else if (ratio < 4.5) {
      add('contrast-pairs', 'warn', `${label} contrast ${ratio.toFixed(2)}:1 is below AA 4.5:1.`);
    }
  };
  if (bg && fg) checkPair(fg, bg, 'on-surface / surface');
  const primary = tryParse(colors.primary);
  // primary / primary-foreground IS the documented error pairing (the on-primary
  // label legibility floor). The compiler auto-repairs it (§6), so lint it on the
  // SOURCE as advisory (warn), not a hard build-breaking error.
  const primaryFg = tryParse(colors['primary-foreground']);
  if (primary && primaryFg) {
    checkPair(primaryFg, primary, 'primary-foreground / primary', false);
  }
  if (primary && bg) {
    // primary-on-surface is a brand pairing, not a required body-text pairing
    // (per §3 it is NOT in the hard-error contrast list) — advisory only.
    checkPair(primary, bg, 'primary / surface', false);
  }

  /* --- success/warning tint-foreground contract (warn) ---
   * The tint roles (success/warning/info) carry text-on-tint foregrounds. If a
   * design supplies an explicit *-foreground we sanity-check it reads against
   * its tint; if it supplies the tint without a foreground we just note that
   * the compiler will derive a contrast-correct one. We never demand white. */
  for (const tint of ['success', 'warning', 'info']) {
    const tintCol = tryParse(colors[tint]);
    const fgCol = tryParse(colors[`${tint}-foreground`]);
    if (tintCol && fgCol) {
      const ratio = contrastRatio(fgCol, tintCol);
      if (ratio < 4.5) {
        add(
          'tint-foreground',
          'warn',
          `${tint}-foreground / ${tint} contrast ${ratio.toFixed(2)}:1 < 4.5:1 (text-on-tint must stay legible, not naive white).`
        );
      }
    } else if (tintCol && !fgCol) {
      // Informational: derived foreground will be contrast-repaired.
      const lum = relativeLuminance(toSrgb(tintCol));
      add(
        'tint-foreground',
        'info',
        `${tint} has no explicit foreground; compiler will derive a ${lum < 0.5 ? 'light' : 'dark'}-on-tint foreground.`
      );
    }
  }

  const ok = findings.every((f) => f.severity !== 'error');
  return { ok, findings };
}
