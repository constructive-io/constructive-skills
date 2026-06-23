---
name: Eclipse
description: Dark-mode-first product UI — deep cool charcoal canvas, one restrained low-chroma teal, depth from borders, dense and exact.
dials: { variance: 5, motion: 3, density: 7 }
font: { sans: "Sora", mono: "Geist Mono" }
radius: "0.25rem"
# Light-mode palette as shadcn ROLE values (the quieter, derived mode — author the dark block first, then quiet it down).
colors:
  background: "oklch(0.985 0.003 230)"
  foreground: "oklch(0.24 0.012 250)"
  primary: "oklch(0.55 0.08 195)"
  primary-foreground: "oklch(0.985 0.004 230)"
  muted: "oklch(0.955 0.004 240)"
  muted-foreground: "oklch(0.52 0.012 245)"
  accent: "oklch(0.55 0.08 195)"
  border: "oklch(0.90 0.006 240)"
  ring: "oklch(0.55 0.08 195)"
  destructive: "oklch(0.55 0.19 27)"
  success: "oklch(0.58 0.12 158)"
  warning: "oklch(0.74 0.13 80)"
  info: "oklch(0.55 0.08 195)"
# Dark-mode KEY overrides (the PRIMARY intent — deep charcoal, lifted teal, a visible-but-quiet border):
dark:
  background: "oklch(0.20 0.012 250)"
  foreground: "oklch(0.94 0.006 240)"
  primary: "oklch(0.70 0.09 195)"
  border: "oklch(0.30 0.012 245)"
---

# Eclipse

> Art direction: a deep cool-charcoal console where structure is drawn in **borders, not shadows**, and a single muted teal is the only light in the room.

## Atmosphere
An operator's product UI built to be lived in after dark — a control surface for someone who keeps it open all day. Calm and exact, never moody-for-its-own-sake: the dimness is functional (low glare, long sessions), and the one cool accent reads as a signal, not decoration.

## Palette — with intent
The canvas is a deep cool charcoal (`oklch(0.20 0.012 250)`), never pure black — `#000` reads harsh and flattens depth. The one accent is a **restrained teal** (`~hue 195`, chroma held to ~0.08): deliberately on the cool, *non-purple* side of blue so it never drifts into the generic AI blue-purple band, and quiet enough to sit in a dim room without buzzing. It lifts to `L 0.70` in dark so the single primary action still carries against charcoal. Status hues stay chromatic so red/green/amber always mean *state* in an otherwise monochrome field.

## Type
Lead with **Sora** — a geometric grotesk with a slightly technical, even cadence that suits a console (prefer it over Inter/Roboto/system-ui as the headline face). Pair it with **Geist Mono** for ids, counts, timestamps, and table data — numerics live in mono here. Hierarchy is carried by **weight + size together** (heavy headings, `font-medium` to lead a row against `muted-foreground`), with tight tracking on display; the dense scale keeps steps small.

## Layout & density
A **dense-dashboard** shell: a tight persistent rail, a compact top bar, a wide working canvas — chrome that stays put because the user never leaves. Entity surfaces favor a **data-table** (columnar, scannable, right-aligned numerics) over roomy cards. Depth strategy is **borders-only**: on a dark canvas shadows are invisible, so separate surfaces with quiet 1px borders (`oklch(0.30 …)`) and a faint lightness step, never a drop shadow. Tight rhythm; symmetrical padding.

## Motion
Restrained (MOTION 3): short, fast micro-interactions on a calm ease-out; no spring, no entrance theater. Always honor `prefers-reduced-motion`.

## Banned
- Pure-black (`#000`) canvas or text — use the near-black charcoal so depth survives.
- Drop shadows or glows as the depth device (invisible/ugly on dark — use borders + a lightness step).
- A purple/indigo primary (the AI blue-purple tell) — the accent is cool teal, with intent.
- More than one chromatic accent; color spent on decoration instead of signal/status.
- Roomy three-equal-card grids where a dense table would scan better.

## Reach for it when
Operator consoles, monitoring/observability, trading or analytics dashboards, dev tools — anything kept open all day where a dark, dense, signal-over-decoration surface earns its place.
