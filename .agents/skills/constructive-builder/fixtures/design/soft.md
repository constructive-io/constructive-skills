---
version: 1
name: soft
description: High-end SaaS skin — a gentle muted-lavender accent on soft cool neutrals, rounded and calm.
dials:
  variance: 7
  motion: 6
  density: 4
colors:
  primary: "oklch(0.55 0.095 285)"
  primary-foreground: "oklch(0.99 0 0)"
  neutral: "oklch(0.52 0.012 285)"
  surface: "oklch(0.995 0.002 285)"
  on-surface: "oklch(0.28 0.012 285)"
  error: "oklch(0.55 0.17 25)"
  success: "oklch(0.62 0.11 158)"
  warning: "oklch(0.76 0.12 82)"
  info: "oklch(0.55 0.095 285)"
typography:
  sans: Geist
  mono: Geist Mono
rounded:
  md: "0.75rem"
spacing:
  base: "1.05rem"
radius: "0.75rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.74 0.095 285)"
  primary-foreground: "oklch(0.20 0.02 285)"
  neutral: "oklch(0.72 0.012 285)"
  surface: "oklch(0.23 0.012 285)"
  on-surface: "oklch(0.96 0.004 285)"
  error: "oklch(0.55 0.17 25)"
  success: "oklch(0.66 0.11 158)"
  warning: "oklch(0.80 0.12 85)"
  info: "oklch(0.74 0.095 285)"
---

# Soft

## Overview

A **high-end, gentle SaaS** skin — the rounded, calm, slightly premium feel of a modern
product marketing-site-turned-app. The accent is a **muted lavender-indigo**
(`oklch(0.55 0.095 285)`): it lives in the cool blue-purple region but its chroma is
deliberately held low (0.095) so it reads as a *sophisticated, desaturated lavender*, not
the over-saturated "AI purple" the invariants ban. The neutral ramp shares that faint cool
hue, so surfaces feel tinted-soft rather than clinical, and the whole palette is one calm
cool family.

Corners are generously rounded (`0.75rem`), density is comfortable (dial 4), and motion is
a touch more present (dial 6) for soft, premium transitions — still tasteful, never showy.
Light mode is a barely-tinted off-white; dark mode is a soft cool charcoal with a lifted
lavender accent and off-white ink, keeping the gentle character after inversion. Status
hues are kept soft so success/warning pills feel like part of the same refined system.

Use it for consumer-facing or premium-tier SaaS where the product should feel polished,
approachable, and a little aspirational.

> Hue note: the lavender sits inside the blue-purple band the invariants guard, but its
> chroma (0.095) is below the 0.12 "AI-purple" threshold, so it passes cleanly with
> `allow_brand_hue: false`. If you push this accent more saturated, set
> `allow_brand_hue: true` to make that an intentional brand choice rather than an accident.
