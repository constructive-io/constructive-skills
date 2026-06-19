---
version: 1
name: lint-clean-fixture
description: Fully invariant-satisfying design — lintDesign ok:true, zero errors.
colors:
  primary: "oklch(0.45 0.04 250)"
  primary-foreground: "oklch(0.98 0 0)"
  neutral: "oklch(0.50 0.008 250)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.22 0.005 250)"
  error: "oklch(0.55 0.18 27)"
  success: "oklch(0.60 0.12 155)"
  warning: "oklch(0.75 0.13 80)"
  info: "oklch(0.45 0.04 250)"
typography:
  sans: Geist
  mono: Geist Mono
rounded:
  md: "0.5rem"
radius: "0.5rem"
default_mode: light
allow_brand_hue: false
---

# lint-clean fixture

A design that satisfies every invariant: exactly one accent (primary), all chroma below
the saturation cap, no pure black (min L 0.22), no AI-purple-band primary (hue 250, just
below the band), a present primary, dimension units in rem, and passing contrast pairs.
`lintDesign` must return `ok:true` with **zero error-severity findings** (info/warn
notes, if any, are acceptable). The positive control for the lint suite.
