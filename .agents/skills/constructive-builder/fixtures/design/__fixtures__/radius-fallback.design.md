---
version: 1
name: radius-fallback-fixture
description: No top-level radius — must fall back to rounded.md; default_mode dark.
colors:
  primary: "oklch(0.62 0.16 200)"
  primary-foreground: "oklch(0.20 0.03 230)"
  neutral: "oklch(0.52 0.014 220)"
  surface: "oklch(0.995 0.003 200)"
  on-surface: "oklch(0.27 0.012 230)"
  error: "oklch(0.55 0.19 25)"
typography:
  sans: Geist
  mono: Geist Mono
rounded:
  md: "0.875rem"
default_mode: dark
allow_brand_hue: false
---

# radius-fallback fixture

No top-level `radius:` key. `compileDesign` must resolve `radius` from `rounded.md`
(`0.875rem`) per the fallback chain `design.radius || rounded.md || '0.5rem'`. Also pins
`--ring` = primary and exercises `default_mode: dark` (which set the override block leads
with for the app's first paint via layout.tsx defaultTheme — the token sets themselves
are emitted for both modes regardless).
