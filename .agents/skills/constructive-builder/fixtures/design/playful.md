---
version: 1
name: playful
description: Energetic friendly app — a vivid cyan-teal accent with dark-ink labels, rounded and lively.
dials:
  variance: 9
  motion: 8
  density: 4
colors:
  primary: "oklch(0.60 0.15 200)"
  primary-foreground: "oklch(0.20 0.03 230)"
  neutral: "oklch(0.52 0.014 220)"
  surface: "oklch(0.995 0.003 200)"
  on-surface: "oklch(0.27 0.012 230)"
  error: "oklch(0.55 0.19 25)"
  success: "oklch(0.60 0.13 158)"
  warning: "oklch(0.76 0.14 80)"
  info: "oklch(0.60 0.15 200)"
typography:
  sans: Geist
  mono: Geist Mono
rounded:
  md: "0.875rem"
spacing:
  base: "1rem"
radius: "0.875rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.74 0.135 200)"
  primary-foreground: "oklch(0.18 0.02 200)"
  neutral: "oklch(0.72 0.014 210)"
  surface: "oklch(0.22 0.012 230)"
  on-surface: "oklch(0.97 0.004 200)"
  error: "oklch(0.55 0.19 25)"
  success: "oklch(0.66 0.13 158)"
  warning: "oklch(0.80 0.14 85)"
  info: "oklch(0.74 0.135 200)"
---

# Playful

## Overview

An **energetic, friendly** app skin — lively but still legible, the way a good consumer
product feels approachable without becoming a toy. The accent is a **vivid cyan-teal**
(`oklch(0.60 0.15 200)`): bright and cheerful, sitting safely outside the banned
blue-purple band. Because cyan is a high-luminance hue, its labels use **dark ink rather
than white** (`primary-foreground` is a deep teal-black) — a bright pill button with dark
text both reads better *and* looks more playful than muddy white-on-cyan, and it clears
WCAG AA comfortably.

Corners are large and friendly (`0.875rem`), motion is the most present of any preset
(dial 8) for bouncy, delightful transitions — still gated behind `prefers-reduced-motion`
— and density stays comfortable (dial 4) so the energy never crowds the content. Light
mode is a barely-cyan-tinted white; dark mode is a cool teal-charcoal with a brightened
cyan accent (again dark-ink labels) so the cheer survives the inversion. Status hues are
kept bright and saturated to match the upbeat tone.

Use it for consumer apps, community products, education, or anything onboarding-heavy
where the interface should feel welcoming and alive.

> A single accent still holds: the cyan primary is the only chromatic brand color;
> everything else is the cool-neutral ramp plus the meaning-only status hues.
