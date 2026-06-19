---
version: 1
name: lint-ai-purple-allowed-fixture
description: Same saturated blue-purple primary but allow_brand_hue:true — warning suppressed.
colors:
  primary: "oklch(0.55 0.20 285)"
  primary-foreground: "oklch(0.99 0 0)"
  neutral: "oklch(0.52 0.012 285)"
  surface: "oklch(0.995 0.002 285)"
  on-surface: "oklch(0.28 0.012 285)"
  error: "oklch(0.55 0.17 25)"
typography:
  sans: Geist
  mono: Geist Mono
radius: "0.75rem"
default_mode: light
allow_brand_hue: true
---

# lint-ai-purple-allowed fixture

Identical to `lint-ai-purple` except `allow_brand_hue: true`. The blue-purple band is now
an **intentional brand choice**, so `lintDesign` must NOT emit an `ai-purple-band` finding
for the primary. This proves the escape hatch works and the rule is opt-out-able.
