---
version: 1
name: editorial
description: Warm print-inspired UI — terracotta ink accent on warm paper, calm and trustworthy.
dials:
  variance: 7
  motion: 4
  density: 4
colors:
  primary: "oklch(0.50 0.10 28)"
  primary-foreground: "oklch(0.98 0.01 60)"
  neutral: "oklch(0.50 0.012 55)"
  surface: "oklch(0.99 0.004 70)"
  on-surface: "oklch(0.26 0.012 50)"
  error: "oklch(0.52 0.19 27)"
  success: "oklch(0.55 0.11 150)"
  warning: "oklch(0.72 0.12 75)"
  info: "oklch(0.50 0.10 28)"
typography:
  sans: Geist
  mono: Geist Mono
rounded:
  md: "0.25rem"
spacing:
  base: "1.05rem"
radius: "0.25rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.70 0.11 35)"
  primary-foreground: "oklch(0.20 0.02 35)"
  neutral: "oklch(0.70 0.012 60)"
  surface: "oklch(0.22 0.010 50)"
  on-surface: "oklch(0.95 0.006 70)"
  error: "oklch(0.55 0.19 27)"
  success: "oklch(0.60 0.11 150)"
  warning: "oklch(0.76 0.12 78)"
  info: "oklch(0.70 0.11 35)"
---

# Editorial

## Overview

A **warm, print-inspired** look — calm, high-end, and trustworthy, the way a
well-set magazine page feels. The accent is a **terracotta ink-red**
(`oklch(0.50 0.10 28)`, hue ~28): saturated enough to feel intentional and editorial,
muted enough never to read as an alert. The neutral ramp is given a **warm temperature**
(low chroma toward hue ~55), and the surface is a faint **warm paper white** rather than
clinical pure white, with a soft warm-black ink on top. The whole palette shares one warm
family, which is what gives it the "printed, considered" calm.

Corners are nearly square (`0.25rem`) for a crisp typographic edge, density is generous
(dial 4) to let text breathe, and motion is gentle (dial 4). Dark mode becomes a warm
near-black "evening reading" surface with a lifted clay accent and warm off-white ink, so
the print feeling survives the inversion. Status hues are kept earthy so they harmonize
with the warm body rather than puncturing it.

Use it for content-forward, document-heavy, or premium B2B products where the experience
should feel authored and unhurried.
