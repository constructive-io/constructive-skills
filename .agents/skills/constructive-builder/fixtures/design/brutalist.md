---
version: 1
name: brutalist
description: Raw high-contrast utility UI — near-black ink accent, square corners, dense and structural.
dials:
  variance: 4
  motion: 2
  density: 2
colors:
  primary: "oklch(0.42 0.02 250)"
  primary-foreground: "oklch(0.99 0 0)"
  neutral: "oklch(0.45 0.006 250)"
  surface: "oklch(0.98 0 0)"
  on-surface: "oklch(0.20 0.004 250)"
  error: "oklch(0.52 0.20 27)"
  success: "oklch(0.55 0.13 150)"
  warning: "oklch(0.72 0.14 78)"
  info: "oklch(0.42 0.02 250)"
typography:
  sans: Geist
  mono: Geist Mono
rounded:
  md: "0rem"
spacing:
  base: "0.9rem"
radius: "0rem"
default_mode: light
allow_brand_hue: false
dark:
  primary: "oklch(0.92 0.01 250)"
  primary-foreground: "oklch(0.16 0.005 250)"
  neutral: "oklch(0.68 0.006 250)"
  surface: "oklch(0.19 0.003 250)"
  on-surface: "oklch(0.98 0 0)"
  error: "oklch(0.55 0.20 27)"
  success: "oklch(0.60 0.13 150)"
  warning: "oklch(0.78 0.14 80)"
  info: "oklch(0.92 0.01 250)"
---

# Brutalist

## Overview

A **raw, high-contrast utility** look — structural and unapologetic, all edges and ink.
The accent is a **near-black, almost-achromatic ink** (`oklch(0.42 0.02 250)`, chroma
0.02): the "brand color" is essentially deep gray, so emphasis comes from **stark
contrast, hairline borders, and square corners**, not hue. Corners are fully square
(`0rem`), density is tight (dial 2) for an information-dense grid feel, and motion is
near-zero (dial 2) — the UI does not animate, it just *is*.

Light mode is bright off-white with a heavy near-black ink and ink-black primary fills;
dark mode flips to a true near-black surface with a near-white primary, so a button reads
as a hard light slab on dark — the inverse of the light slab on white. Crucially, the
status hues stay **chromatic** (a vivid red error, a clear green success, an amber
warning): in an otherwise monochrome system the only color is *meaning*, which makes state
unmistakable. That single restraint keeps brutalist legible instead of merely austere.

Use it for developer tools, dense back-office grids, or any product that wants to look
engineered and exacting rather than friendly.
