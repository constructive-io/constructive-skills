---
name: constructive
preset: constructive
description: The stock platform default — calm sky-blue on near-neutral gray, dependable and trust-first, the deliberate zero-restyle opt-out.
dials: { variance: 3, motion: 2, density: 5 }
font: { sans: "Geist", mono: "Geist Mono" }
radius: "0.5rem"
# Light-mode palette as shadcn ROLE values in OKLCH — TODAY'S scaffolded look, recorded verbatim.
# The agent derives card/popover/secondary/sidebar/chart-* as elevation steps of these per design-guide.md.
colors:
  background: "oklch(1 0 0)"                  # plain white surface — the calm, neutral canvas
  foreground: "oklch(0.21 0.006 265)"         # near-black ink with a faint cool cast, never #000
  primary: "oklch(0.688 0.1754 245.6)"        # the signature sky-blue (hue ~246 — true sky, just BELOW the AI band)
  primary-foreground: "oklch(0.985 0.002 250)"
  muted: "oklch(0.967 0.003 265)"             # whisper-quiet near-neutral fill
  muted-foreground: "oklch(0.55 0.012 265)"   # secondary ink
  accent: "oklch(0.688 0.1754 245.6)"         # the SAME single sky-blue — no second hue
  border: "oklch(0.922 0.004 265)"            # hairline, near-neutral
  ring: "oklch(0.688 0.1754 245.6)"
  destructive: "oklch(0.577 0.19 27)"
  success: "oklch(0.60 0.13 150)"
  warning: "oklch(0.72 0.14 75)"
  info: "oklch(0.688 0.1754 245.6)"           # info shares the signature sky-blue
# Dark-mode KEY overrides (only the roles that must shift; the agent derives the rest):
dark:
  background: "oklch(0.18 0.008 265)"         # deep cool charcoal, not #000
  foreground: "oklch(0.94 0.004 265)"
  primary: "oklch(0.72 0.16 245.6)"           # sky-blue lifts in L to hold against charcoal
  border: "oklch(0.30 0.008 265)"             # hairline stays a hairline
---

# constructive

> Art direction: the platform's calm stock face — a sky-blue action on near-neutral gray, dependable to a fault, with nothing custom layered on top.

## Atmosphere
The default an admin surface ships with before anyone reaches for a theme: composed, trustworthy, and unsurprising. The world is a settings panel or a back-office console that wants to feel safe and familiar — no personality forced on it, just a clean canvas and a friendly blue that says "this is the live thing." Choosing this look is choosing *not* to design: you accept the stock palette as-is.

## Palette — with intent
The signature is a single **sky-blue** (hue ~246, chroma ~0.18) — a true sky tone deliberately one step *below* the generic AI blue-purple band, so it reads as dependable rather than templated. It is the only color in the room: it carries the primary action, the focus ring, and links. Everything structural is near-neutral gray on a white surface (deep cool charcoal in dark), with the faintest cool cast so it never feels clinical. Status hues (red / green / amber) appear only as semantic signal.

## Type
Geist for everything in the chrome — a clean geometric grotesk that stays neutral and legible — paired with Geist Mono for ids, counts, keys, and timestamps. Hierarchy comes from weight and size on a calm scale (600 headings, 400 body), never from color or flourish. This is the stock pairing; the opt-out keeps it rather than choosing a more distinctive face.

## Layout & density
A persistent left **sidebar** over a moderate-density working canvas — the conventional admin shell, kept as scaffolded. Compose entities as a readable **list** of divided rows; balanced spacing (DENSITY ~5) that neither sprawls nor cramps. Depth strategy is **borders-only**: surfaces separate by near-neutral hairlines and small lightness steps, never drop shadows. Medium radius (`0.5rem`) softens controls just enough to feel approachable.

## Motion
Minimal (MOTION ~2): short opacity/position fades on state change, no springs. Always honor `prefers-reduced-motion`.

## Banned
- Restyling for its own sake — this preset's whole point is to leave the stock look untouched.
- A second accent hue or gradients — one sky-blue and near-neutrals, full stop.
- Pure black (#000) ink or surfaces; pushing the primary up into the AI blue-purple band.
- Drop shadows or glows as the depth device — separation is hairlines only.

## Reach for it when
You want a dependable, trust-first admin surface and **no custom design work at all** — the agent skips the authoring pass and leaves the scaffolded `globals.css` exactly as-is (it already satisfies Rail 2). Reach past it for any product that wants a remembered identity.
