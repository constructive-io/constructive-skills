---
version: 1
name: explicit-dark-fixture
description: Carries an explicit dark block — compiler must honor it, not re-derive.
colors:
  primary: "oklch(0.50 0.10 28)"
  primary-foreground: "oklch(0.98 0.01 60)"
  neutral: "oklch(0.50 0.012 55)"
  surface: "oklch(0.99 0.004 70)"
  on-surface: "oklch(0.26 0.012 50)"
  error: "oklch(0.52 0.19 27)"
typography:
  sans: Geist
  mono: Geist Mono
radius: "0.25rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.70 0.11 35)"
  primary-foreground: "oklch(0.20 0.02 35)"
  neutral: "oklch(0.70 0.012 60)"
  surface: "oklch(0.22 0.010 50)"
  on-surface: "oklch(0.95 0.006 70)"
  error: "oklch(0.62 0.19 27)"
---

# explicit-dark fixture

When a `design.md` carries an explicit `dark:` block, `compileDesign` must use those
values for the `.dark` token set (and the dark direct-copies must equal them) rather
than deriving dark by OKLCH lightness inversion. This fixture pins the dark surface,
foreground, and primary to the authored dark values.
