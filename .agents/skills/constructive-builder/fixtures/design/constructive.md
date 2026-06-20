---
version: 1
name: constructive
preset: constructive
description: The current default Constructive look — the opt-out preset. The `preset: constructive` key above makes this design.md self-identify as the opt-out, so `wire-design --design …/constructive.md` (and a brief `design: { preset: constructive }`) both resolve to a byte NO-OP that keeps today's look.
atmosphere: "the stock Constructive baseline — calm sky-blue trust-first dashboard, unchanged"
dials:
  variance: 3
  motion: 3
  density: 4
art_direction:
  shell: sidebar
  composition: list
  density: cozy
  notes: "OPT-OUT — keep the shipped shell/composition exactly; this preset authors NO custom frontend"
colors:
  primary: "oklch(0.688 0.1754 245.6151)"
  primary-foreground: "oklch(0.979 0.021 166.113)"
  neutral: "oklch(0.552 0.016 285.938)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.3211 0 0)"
  error: "oklch(0.55 0.2 25)"
  success: "oklch(0.62 0.14 158)"
  warning: "oklch(0.75 0.14 78)"
  info: "oklch(0.688 0.1754 245.6151)"
typography:
  sans: Geist
  mono: Geist Mono
type:
  sans: Geist
  mono: Geist Mono
  scale:
    base: "1rem"
    ratio: "1.25"
  weights:
    body: 400
    medium: 500
    heading: 600
  pairing: "Stock Geist sans / Geist Mono — the shipped boilerplate type. This preset changes nothing."
rounded:
  md: "0.5rem"
spacing:
  base: "1rem"
radius: "0.5rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.688 0.1754 245.6151)"
  primary-foreground: "oklch(0.979 0.021 166.113)"
  neutral: "oklch(0.705 0.015 286.067)"
  surface: "oklch(0.21 0.006 285.885)"
  on-surface: "oklch(0.985 0 0)"
  error: "oklch(0.55 0.2 25)"
  success: "oklch(0.696 0.17 162.48)"
  warning: "oklch(0.828 0.189 84.429)"
  info: "oklch(0.688 0.1754 245.6151)"
---

# Constructive (default)

## Overview

This is **today's Constructive look transcribed into design.md role form** — the
explicit opt-out. Selecting it (`design: { preset: constructive }`) is a NO-OP that
reproduces the current boilerplate palette exactly, so a build keeps the look it has
always had. The values here are a faithful record of `globals.css` `:root` and `.dark`,
re-expressed as the small set of design roles (`surface`, `on-surface`, `primary`,
`neutral`, status hues) the compiler remaps onto the shadcn token surface.

The identity is a **calm sky-blue primary** (`oklch(0.688 0.1754 245.6)`, hue ~246 — a
genuine sky blue that sits just *below* the banned blue-purple band, never "AI purple")
on a **clean, near-neutral gray** scale with a barely-warm-cool temperature. Surfaces are
pure white in light and a deep cool charcoal in dark; foregrounds are near-black / near-
white for crisp body text. The radius is a moderate `0.5rem` and type is Geist sans /
Geist mono.

Use it when you want zero restyling — the dependable, trust-first dashboard baseline.

> **Opt-out semantics (the new model).** Every *other* preset is a rich art-direction the agent
> AUTHORS the whole frontend from (customized components, distinctive type, intentional layout). This
> one is the deliberate exception: `preset: constructive` authors **nothing** — `wire-design` is a byte
> NO-OP, the shipped shell + composition stay exactly as scaffolded, and the boilerplate `globals.css`
> is untouched. The rich keys above (`type`, `art_direction`, dials) are documentary only; they record
> what the stock look *is*, not a restyle to apply.

> Fidelity note: `primary-foreground` is transcribed verbatim from the boilerplate
> (`oklch(0.979 0.021 166.113)`, a near-white greenish tint). Its measured contrast on the sky-blue
> primary is ~2.6:1, *below* WCAG AA for small text — a property of the **current** default, preserved
> here so the opt-out is byte-faithful. Under the faithful+advisory compiler this value would now emit
> **verbatim** if this preset were ever compiled (the contrast clamp is gone; low contrast is an
> ADVISORY warning, not a repair) — but as the opt-out it is never compiled, so today's pixels are
> reproduced exactly, sub-AA on-primary label and all.
