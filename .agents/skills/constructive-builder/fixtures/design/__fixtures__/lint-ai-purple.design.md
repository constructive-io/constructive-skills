---
version: 1
name: lint-ai-purple-fixture
description: Saturated blue-purple primary, no allow_brand_hue — must warn ai-purple-band.
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
allow_brand_hue: false
---

# lint-ai-purple fixture (INTENTIONALLY FLAGGED)

The primary `oklch(0.55 0.20 285)` sits squarely in the banned blue-purple band
(hue 285, within 255–310) with chroma 0.20 (well above the ~0.12 "AI-purple" threshold)
and `allow_brand_hue` is false. `lintDesign` must report an `ai-purple-band` finding at
**warn** severity for the primary. See `lint-ai-purple-allowed` for the same color with
`allow_brand_hue: true`, which must SUPPRESS the warning (intentional brand choice).
