---
version: 1
name: minimalist
description: Quiet, near-monochrome dashboard — one restrained slate-blue accent on clean neutrals.
dials:
  variance: 5
  motion: 3
  density: 3
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
rounded:
  md: "0.375rem"
spacing:
  base: "1rem"
radius: "0.375rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.72 0.05 250)"
  primary-foreground: "oklch(0.18 0.01 250)"
  neutral: "oklch(0.70 0.008 250)"
  surface: "oklch(0.20 0.004 250)"
  on-surface: "oklch(0.97 0 0)"
  error: "oklch(0.55 0.18 27)"
  success: "oklch(0.62 0.12 155)"
  warning: "oklch(0.78 0.13 80)"
  info: "oklch(0.72 0.05 250)"
---

# Minimalist

## Overview

A **quiet, near-monochrome** dashboard skin. The whole interface is built from one
neutral gray ramp; the single accent is a **deeply restrained slate-blue**
(`oklch(0.45 0.04 250)`) with chroma so low (0.04) it reads almost as "dark gray with a
hint of blue." That is deliberate: hierarchy here comes from **weight and spacing, not
color**. The accent is reserved for the one primary action and focus rings — everything
else is type on neutral.

Corners are tight (`0.375rem`), density is comfortable-tight (dial 3), and motion is
minimal (dial 3) — transitions exist but never perform. Light mode is pure white with a
near-black cool ink; dark mode is a deep cool charcoal with a near-white ink and a
slightly lifted accent so the one action still reads. Status hues (error/success/warning)
are present but muted so a green "saved" pill or a red "failed" row never shouts.

Reach for this when the data is the point — admin panels, internal tools, reporting —
and any decoration would be noise.
