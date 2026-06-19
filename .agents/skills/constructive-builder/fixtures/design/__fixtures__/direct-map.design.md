---
version: 1
name: direct-map-fixture
description: Minimal happy-path design — pins the deterministic role→var direct copies.
colors:
  primary: "oklch(0.55 0.16 250)"
  primary-foreground: "oklch(0.99 0 0)"
  neutral: "oklch(0.50 0.01 250)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.30 0.005 250)"
  error: "oklch(0.55 0.18 27)"
typography:
  sans: Geist
  mono: Geist Mono
radius: "0.5rem"
default_mode: light
allow_brand_hue: false
---

# direct-map fixture

A minimal, invariant-clean design used to assert the **deterministic** parts of
`compileDesign`: the direct role→var copies (`--background` = surface,
`--foreground` = on-surface, `--primary` = colors.primary, `--ring` = primary),
the radius, the override-surface allowlist, structural-safety, and the marked-region
sentinels. Derived vars (border, muted-foreground, charts, the whole `.dark` set) are
left to Agent A's math and are NOT pinned here.
