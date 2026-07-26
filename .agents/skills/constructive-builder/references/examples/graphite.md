---
name: Graphite
description: Precision developer-tool minimalism — graphite ink on near-white, monochrome with one instrument-blue accent.
dials: { variance: 4, motion: 2, density: 6 }
font: { sans: "Geist", mono: "Geist Mono" }
radius: "0.125rem"
# Light-mode palette as shadcn ROLE values in OKLCH. The agent derives
# card/popover/secondary/sidebar/chart-* as elevation/hue steps of these per design-guide.md.
colors:
  background: "oklch(0.985 0.002 250)"      # near-white, a faint cool cast
  foreground: "oklch(0.22 0.012 250)"        # graphite ink, never #000
  primary: "oklch(0.55 0.13 233)"            # one instrument-blue accent (true blue, NOT the AI-purple band)
  primary-foreground: "oklch(0.99 0.002 250)"
  muted: "oklch(0.965 0.003 250)"            # whisper-quiet surface tint
  muted-foreground: "oklch(0.50 0.012 250)"  # secondary ink
  accent: "oklch(0.55 0.13 233)"             # the SAME single accent — no second hue
  border: "oklch(0.90 0.006 250)"            # hairline, low chroma
  ring: "oklch(0.55 0.13 233)"
  destructive: "oklch(0.55 0.19 27)"
  success: "oklch(0.60 0.13 150)"
  warning: "oklch(0.72 0.14 75)"
  info: "oklch(0.58 0.10 233)"
# Dark-mode KEY overrides (only the roles that must shift; the agent derives the rest):
dark:
  background: "oklch(0.19 0.006 250)"        # near-black graphite, not #000
  foreground: "oklch(0.93 0.004 250)"
  primary: "oklch(0.66 0.135 233)"           # accent lifts in L to hold on dark
  border: "oklch(0.30 0.008 250)"            # hairline stays a hairline
---

# Graphite

> Art direction: graphite ink on near-white, ruled by hairlines and a single instrument-blue — a precise tool that disappears so the data can speak.

## Atmosphere
Engineered and exacting, not friendly. The world of a focused operator surface: a CLI dressed as an app, where every pixel is accountable and nothing is decorative. Quiet, cool, and confident — the chrome recedes and the content is the only event.

## Palette — with intent
The canvas is a near-white with the faintest cool cast (hue 250), and the type is graphite — a deep neutral ink, never pure black, so it reads as deliberate rather than harsh. Everything structural is monochrome along one cool gray ramp. The single instrument-blue (hue 233, modest chroma) is the only color in the room: it marks the live thing — focus ring, active row, primary action — and carries meaning precisely *because* nothing else competes. Status (red / green / amber) appears only as semantic signal, never as decoration.

## Type
Reach for a geometric or grotesque sans with even, mechanical proportions — Geist, or a peer like Söhne or a clean grotesque — never Inter/Roboto/Open Sans/system-ui as the headline face. Pair it with a mono (Geist Mono) for the technical layer: ids, counts, code, keys, timestamps. Hierarchy comes from weight and size on a tight scale, not from color or flourish; headings sit at 600, body at 400, with slight negative tracking on display sizes for an engineered edge.

## Layout & density
A persistent left sidebar over a dense data-table workspace — the operator's console, not a marketing page. Tight, regular spacing on a consistent grid; rows are compact and scannable. Depth strategy is **borders-only**: surfaces separate by hairline low-opacity rules and tiny lightness steps, never by drop shadow. Radius is near-0 (2px) so corners read as machined, not soft. Align everything to the grid; let the rules do the structural work.

## Motion
Minimal and instant — short opacity/position fades on state change, no springs or bounce. Always honor `prefers-reduced-motion`.

## Banned
- Drop shadows, glows, or any "lifted card" depth — separation is hairlines only.
- A second accent hue, or gradients — one instrument-blue and neutrals, full stop.
- Rounded, soft, or pill shapes; large radii read as consumer, not instrument.
- Pure black (#000) ink or surfaces; the AI blue-purple band for the accent.
- Humanist or rounded display faces, emoji ornament, decorative iconography.

## Reach for it when
Developer tools, internal operator consoles, monitoring/admin surfaces, and any dense data app that should feel precise and trustworthy rather than playful.
