---
version: 1
name: tint-foreground-fixture
description: Pins the success/warning tint-foreground contract across light and dark.
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
radius: "0.5rem"
default_mode: light
allow_brand_hue: false
---

# tint-foreground fixture

`--success-foreground` / `--warning-foreground` are **text-on-tint**, not generic
foregrounds. The contract (globals.css C4): in **light** mode they must be *dark on
light* (a deep success/warning hue), and in **dark** mode *light on dark* (a pale
success/warning hue) — never naive white in both. This fixture asserts the foreground
label reads against the status hue with adequate contrast in BOTH modes, which only holds
if the compiler flips them per mode.
