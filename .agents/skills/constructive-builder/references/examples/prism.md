---
name: Prism
description: Colorful-but-structured workspace — a white canvas where several signature color surfaces act as full blocks, with a near-black action.
dials: { variance: 6, motion: 4, density: 5 }
font: { sans: "DM Sans", mono: "Fira Code" }
radius: "0.5rem"
# Light-mode palette as shadcn ROLE values in OKLCH. The agent derives card/popover/secondary/sidebar
# from these as elevation steps, and derives the chart-* ramp into the SIGNATURE tinted surfaces.
colors:
  background: "oklch(0.995 0.001 250)"      # a clean white canvas — the color comes from the surfaces, not the page
  foreground: "oklch(0.24 0.012 265)"       # neutral near-black ink; text stays quiet so the surfaces carry hue
  primary: "oklch(0.21 0.018 265)"          # near-black action — the CTA is ink, NOT a chromatic hue
  primary-foreground: "oklch(0.985 0.001 250)"
  muted: "oklch(0.965 0.003 250)"           # the faintest cool gray for rails/fills
  muted-foreground: "oklch(0.50 0.012 265)"
  accent: "oklch(0.62 0.13 238)"            # ONE chromatic highlight — a clean azure, safely below the AI band
  border: "oklch(0.92 0.004 250)"           # hairline; surfaces are separated by tinted fills, not heavy lines
  ring: "oklch(0.62 0.13 238)"
  destructive: "oklch(0.55 0.19 27)"
  success: "oklch(0.60 0.12 152)"
  warning: "oklch(0.75 0.13 78)"
  info: "oklch(0.62 0.13 238)"
# The disciplined multi-hue spectrum that names this look — full-block surface tints, each modest chroma:
  chart-1: "oklch(0.62 0.13 238)"           # azure
  chart-2: "oklch(0.64 0.12 150)"           # green
  chart-3: "oklch(0.76 0.13 82)"            # amber
  chart-4: "oklch(0.63 0.15 18)"            # coral
  chart-5: "oklch(0.58 0.12 300)"           # a restrained violet — modest chroma keeps it OUT of the slop band
dark:
  background: "oklch(0.20 0.012 265)"       # cool near-black canvas (never pure #000)
  foreground: "oklch(0.96 0.003 250)"
  primary: "oklch(0.96 0.003 250)"          # ink inverts to near-white; the action stays neutral, not chromatic
  border: "oklch(0.30 0.008 265)"
---

# Prism

> Art direction: a white worksheet where each section snaps into its own confident color block — organized, multi-hue, and disciplined, with the only solid action rendered in plain ink.

## Atmosphere
The feel of a well-kept structured-data product: rows, groups, and views, each labeled by a calm color. It is friendly and organized rather than loud — the page is white and quiet, and the hues live in the surfaces (group headers, tagged cards, view chips), never in the prose.

## Palette — with intent
Color is **architecture, not decoration**: a modest spectrum (azure / green / amber / coral / restrained violet) tags and separates regions as full tinted blocks, so structure reads at a glance. The one true `accent` is the azure — used for focus and a single highlight — while the `primary` action is deliberately **near-black ink**, so the most important button never competes with the colorful surfaces. Neutrals are a faint cool gray; every hue is held to modest chroma so five colors coexist without clashing.

## Type
Reach for **DM Sans** — a clean, lightly geometric grotesque that stays neutral against the colored surfaces; pair with **Fira Code** for IDs, counts, and record keys (the structured-data tell). Modest weight contrast on purpose: `400` body, `500` labels, `600` headings — hierarchy comes from the colored surfaces and spacing, not from heavy display type. Avoid Inter/Roboto/system-ui as the headline face.

## Layout & density
Top-nav over a white canvas with view chips; compose entities as a **data-table** or a tagged card **gallery**, each group introduced by its own color-surface header. Slightly dense (DENSITY 5) so a structured grid breathes without sprawling. Depth strategy = **surface-shift**: regions separate by tinted fills + hairline borders, not drop shadows.

## Motion
Restrained (MOTION 4): quick crisp tints and view switches, no bounce; always honor `prefers-reduced-motion`.

## Banned
- A chromatic (azure/violet) PRIMARY action — the solid CTA stays near-black ink.
- More than the five disciplined surface hues, or any one pushed to a screaming chroma.
- The generic AI blue-violet band (hue ~265–295) as `primary` or `accent`.
- Drop shadows or gradients standing in for the color-surface structure.
- A flat all-gray grid that throws away the signature multi-hue surfaces.

## Reach for it when
Structured-data and collaborative products — anything organized into labeled groups, tags, and switchable views.
