---
version: 1
name: lint-missing-primary-fixture
description: No primary color — lintDesign must return ok:false with a missing-primary error.
colors:
  neutral: "oklch(0.50 0.01 250)"
  surface: "oklch(1 0 0)"
  on-surface: "oklch(0.22 0.005 250)"
  error: "oklch(0.55 0.18 27)"
typography:
  sans: Geist
  mono: Geist Mono
radius: "0.5rem"
default_mode: light
---

# lint-missing-primary fixture (INTENTIONALLY INVALID)

`colors.primary` is absent. `invariants.lintDesign` must report `ok:false` with a
`missing-primary` finding at **error** severity. This is the one hard-fail invariant —
a design without a primary cannot be compiled.
