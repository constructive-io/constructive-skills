---
name: Concrete
description: A brutalist archetype — stark near-black on raw white, heavy display type, square corners, thick visible borders, one hazard accent.
dials: { variance: 8, motion: 1, density: 6 }
font: { sans: "Space Grotesk", mono: "Space Mono" }
radius: "0rem"
# Light-mode palette as shadcn ROLE values in OKLCH. The agent derives
# card/popover/secondary/sidebar/chart-* as elevation/hue steps of these per design-guide.md.
colors:
  background: "oklch(0.98 0 0)"              # raw, near-paper white — true neutral, no cast
  foreground: "oklch(0.18 0 0)"              # near-black ink, structural and heavy (never pure #000)
  primary: "oklch(0.18 0 0)"                 # the action IS ink — a black slab, not a hue
  primary-foreground: "oklch(0.99 0 0)"
  muted: "oklch(0.95 0 0)"                    # a flat concrete-gray fill, no tint
  muted-foreground: "oklch(0.42 0 0)"         # secondary ink, still firm
  accent: "oklch(0.62 0.18 40)"               # ONE hazard accent — a loud safety-orange/vermilion, far from the AI band
  border: "oklch(0.18 0 0)"                   # THICK and near-black — borders are the structure, not a hairline
  ring: "oklch(0.62 0.18 40)"
  destructive: "oklch(0.53 0.19 27)"
  success: "oklch(0.55 0.13 150)"
  warning: "oklch(0.72 0.15 75)"
  info: "oklch(0.52 0.10 233)"
# Dark-mode KEY overrides (only the roles that must shift; the agent derives the rest):
dark:
  background: "oklch(0.18 0 0)"               # near-black concrete (not pure #000)
  foreground: "oklch(0.96 0 0)"               # stark off-white ink
  primary: "oklch(0.96 0 0)"                  # ink inverts to off-white; the slab stays neutral
  border: "oklch(0.96 0 0)"                   # thick borders invert to off-white — still loud, still structural
---

# Concrete

> Art direction: black ink on raw white, fenced by thick square borders and stamped with one hazard accent — unapologetic, structural, loud.

## Atmosphere
The feel of poured concrete and stamped signage: a blueprint, a loading dock, a printed manifest with no decoration left in. Nothing is soft or apologetic — every region is a hard rectangle with a heavy edge, and the interface announces itself rather than receding. Honest, industrial, and a little defiant.

## Palette — with intent
The world is built from one stark high-contrast pair: a raw near-white slab and a near-black ink (never pure `#000`, so it stays a deliberate ink rather than a void). Neutrals carry **zero chroma** — flat concrete grays — so the surface reads as raw material, not a tinted brand. The single hazard **vermilion** (hue ~40, chroma held under 0.20) is the only color in the room: it marks the live action and the active edge the way safety paint marks a structural hazard — used sparingly so it *shouts* when it appears. Status hues stay chromatic so red / green / amber always read as state against the monochrome field.

## Type
Lead with a **heavy geometric grotesque with idiosyncratic detailing** — prefer Space Grotesk, or a peer like a condensed industrial grotesque — set BOLD and large for display, with hard weight contrast (700+ headings against 400 body). Pair it with a stark **monospace** (Space Mono) for ids, counts, labels, and the technical layer — mono leans into the manifest/blueprint feel. Hierarchy is brutal and obvious: big heavy headings, tight tracking, generous jumps in size; uppercase labels with wide tracking for section stamps. Never reach for Inter / Roboto / Open Sans / Lato / system-ui as the headline face — the display weight is the signature.

## Layout & density
A **top-nav** banner over a wide working canvas, or a hard-ruled **sidebar** fenced from the content by a thick border — pick one and let the edges do the framing. Compose entities as a dense **data-table** or divided **list** where every row is boxed by a heavy rule. Depth strategy is **borders-only**, taken to the extreme: 2–3px near-black edges (not hairlines) are the entire structural system — surfaces never lift on a shadow, they are *fenced*. Radius is a hard **0** everywhere; corners are square by law. Spacing is firm and grid-locked (DENSITY ~6) — compact but never cramped, every block aligned to a visible structure.

## Motion
Near-zero (MOTION 1): instant state changes, hard cuts, no eases or springs — the interface snaps. Always honor `prefers-reduced-motion`.

## Banned
- Any rounded corner, pill, or soft radius — corners are square, full stop.
- Drop shadows, glows, or "lifted card" depth — separation is thick borders only.
- Thin low-opacity hairlines — the border is heavy and near-black by design.
- A second accent hue, gradients, or color spent on anything but the one hazard signal.
- Pure-black (`#000`) ink or surfaces, and humanist / soft / rounded display faces.

## Reach for it when
Tools that want to feel raw, structural, and unmistakable — developer utilities, internal manifests, editorial-brutalist products, or any surface that should look engineered and a little defiant rather than friendly.
