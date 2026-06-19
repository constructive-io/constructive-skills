---
version: 1
name: lint-pure-black-fixture
description: on-surface is pure black oklch(0 0 0) — must warn pure-black / min-L.
colors:
  primary: "oklch(0.50 0.10 250)"
  primary-foreground: "oklch(0.99 0 0)"
  neutral: "oklch(0.50 0.01 250)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0 0 0)"
  error: "oklch(0.55 0.18 27)"
typography:
  sans: Geist
  mono: Geist Mono
radius: "0.5rem"
default_mode: light
allow_brand_hue: false
---

# lint-pure-black fixture (INTENTIONALLY FLAGGED)

`on-surface` is pure black `oklch(0 0 0)` (and the surface is pure white). The invariants
ban pure black (and effectively a too-low minimum lightness, L >= ~0.18) because true
`#000`/`#fff` extremes read harsh and "untuned." `lintDesign` must emit a `pure-black`
(or min-lightness) finding at **warn** severity. The design still compiles.
