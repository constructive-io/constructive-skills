---
name: Solaris
description: A warm, soft, luminous archetype — sun-warmed off-white, a gentle peach-coral primary, big radii and diffuse shadows; approachable and human.
dials: { variance: 5, motion: 4, density: 4 }
font: { sans: "Nunito", mono: "Spline Sans Mono" }
radius: "1rem"
# Light-mode palette as shadcn ROLE values in OKLCH. The agent derives
# card/popover/secondary/sidebar/chart-* as elevation/hue steps of these per design-guide.md.
colors:
  background: "oklch(0.985 0.012 75)"        # warm off-white, sun on paper — never clinical #fff
  foreground: "oklch(0.28 0.018 50)"          # warm near-black ink, soft not stark
  primary: "oklch(0.72 0.135 45)"             # soft peach-coral — friendly warmth, chroma well under 0.20
  primary-foreground: "oklch(0.99 0.010 75)"
  muted: "oklch(0.955 0.014 72)"              # a touch-warmer fill, whisper-quiet
  muted-foreground: "oklch(0.52 0.020 55)"    # warm secondary ink
  accent: "oklch(0.78 0.115 60)"              # the ONE accent — a warm amber sibling of the primary, gentler
  border: "oklch(0.90 0.014 70)"              # warm hairline, low chroma, soft
  ring: "oklch(0.72 0.135 45)"
  destructive: "oklch(0.58 0.18 27)"          # kept warm-leaning so it harmonizes, still unmistakably alert
  success: "oklch(0.64 0.115 150)"
  warning: "oklch(0.78 0.13 78)"
  info: "oklch(0.62 0.085 230)"               # the lone cool note, low chroma so it never fights the warmth
# Dark-mode KEY overrides (only the roles that must shift; the agent derives the rest):
dark:
  background: "oklch(0.22 0.014 50)"          # warm near-black, like lamplight on dark wood — never #000
  foreground: "oklch(0.94 0.012 75)"
  primary: "oklch(0.76 0.13 48)"              # peach lifts in L to glow against the warm dark
  border: "oklch(0.32 0.014 50)"              # soft warm hairline
---

# Solaris

> Art direction: sun-warmed off-white and a gentle peach glow, with generous rounding and soft diffuse light — an interface that feels welcoming the moment it loads.

## Atmosphere
The feel of morning light through a window: warm, soft, and unhurried. This is a surface for people, not operators — a product that wants to be liked, where nothing has a hard edge and every shadow is a soft fall of light rather than a drawn line. Calm and generous, with just enough warmth to feel cared-for.

## Palette — with intent
Everything is pulled **warm** (hue ~50–75): the canvas is a sun-on-paper off-white, and the ink is a soft warm near-black, so even the neutrals feel friendly rather than clinical. The primary is a **peach-coral** (hue ~45, chroma held under 0.20) — it reads as warmth and welcome, carrying the primary action and focus without ever shouting. The lone accent is a slightly lighter **amber sibling** of that primary — same family, a half-step warmer — used for a highlight or a soft status glow, never a competing voice. Status hues lean warm so they harmonize, with a single low-chroma cool **info** as the one calm counterpoint.

## Type
Lead with a **rounded humanist sans** — Nunito, or a peer like Quicksand or Varela Round — whose soft terminals carry the whole friendly signal; never Inter / Roboto / Open Sans / Lato / system-ui as the headline face. Pair it with a gently rounded mono (Spline Sans Mono) for ids, counts, and keys so even the numeric layer stays warm. Keep weight contrast soft and generous: a heavier rounded display for headings, a comfortable body, open leading. Hierarchy comes from size + weight + air, not from anything sharp.

## Layout & density
A **sidebar** shell that shares the warm canvas hue (no cold "rail world"), over roomy **gallery** cards or a relaxed **list** — composed to breathe (DENSITY ~4), with a soft, even rhythm. Depth strategy is **soft-shadow**: surfaces lift on wide, low-opacity, warm-tinted shadows — diffuse light, not a hard drop — which is the signature that sets this apart from the borders-only archetypes. Big radius (`1rem`) on cards, inputs, and buttons so every corner feels rounded and kind; inputs read gently inset.

## Motion
Lively but soft (MOTION ~4): easings settle with a gentle ease-out, hovers warm and lift slightly, surfaces fade in like light arriving — never snappy or mechanical. Always honor `prefers-reduced-motion`.

## Banned
- Clinical pure-white canvas or pure-black ink/surfaces — everything is warm, soft, off-true.
- Sharp or near-0 corners; hairline-only "engineered" depth — this archetype lifts on soft light.
- A cold, neutral-gray primary, or any second chromatic voice competing with the peach.
- The generic AI blue-purple band (hue ~265–295) for the primary — the warmth is the point.
- Tight, dense data-table chrome or rigid grids that fight the gentle, roomy feel.

## Reach for it when
Consumer and lifestyle products, onboarding and wellness surfaces, friendly community or personal apps — anything that should feel warm, human, and welcoming rather than technical.
