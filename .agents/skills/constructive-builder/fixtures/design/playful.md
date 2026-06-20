---
version: 1
name: playful
description: Energetic friendly app — a vivid cyan-teal accent with dark-ink labels, large friendly radii, bouncy gated motion, warm consumer feel.
atmosphere: "welcoming and alive; a good consumer product that feels approachable without becoming a toy"
dials:
  variance: 9
  motion: 8
  density: 4
art_direction:
  shell: top-nav
  composition: gallery
  density: comfortable
  notes: "consumer/community energy; large rounded cards, a bright single accent, lively but gated motion, friendly geometric sans"
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
  sans: Figtree
  mono: Space Mono
type:
  sans: Figtree
  mono: Space Mono
  scale:
    base: "1rem"
    ratio: "1.28"
  leading:
    body: "1.55"
    heading: "1.15"
  weights:
    body: 400
    medium: 500
    heading: 700
    display: 800
  tracking:
    display: "-0.02em"
  pairing: "Figtree — a rounded, optimistic geometric sans — for everything, with a heavy 800 display for big friendly titles/numbers. Space Mono adds a quirky accent for counts/codes. Lead with size + bold weight for energy."
rounded:
  md: "0.875rem"
radius: "0.875rem"
spacing:
  base: "1rem"
  rhythm: ["0.375rem", "0.625rem", "1rem", "1.5rem", "2rem", "3rem"]
  card_padding: "1.5rem"
  section_gap: "3rem"
components:
  button: "Big rounded (0.875rem) vivid pill with DARK-ink label; a clear press/scale on tap and a cheerful hover lift; secondary is a soft cyan-tinted button."
  input: "Rounded friendly field, a thick 2px focus ring in the cyan accent, comfortable padding."
  card: "Large rounded card with a confident border or soft tint; a playful hover lift + slight scale; great for gallery/feed layouts."
  table: "Softened — rounded container, generous rows, hover-tint; reach for cards/gallery before a dense grid in this voice."
  badge: "Bright fully-rounded pill, saturated tint + dark text; can carry a small emoji/icon when it earns it."
motion:
  duration: "260ms"
  easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  hover: "a lift + slight scale (1.02); buttons depress on active"
  enter: "springy scale-from-0.95 + fade; bouncy staggered list/gallery reveal"
  reduced: true
ornament:
  borders: "confident (1–2px), sometimes in a tinted accent; rounded everywhere"
  dividers: "rare — prefer spacing + cards to rules"
  shadows: "soft colored-tint shadows allowed to add bounce (kept light)"
  texture: "barely-cyan-tinted white; optional friendly accent shapes/blobs as sparing background ornament"
  accents: "the vivid cyan for the primary action + focus; saturated status hues to match the upbeat tone"
banned:
  - "muddy white text on the bright cyan (use the dark-ink label)"
  - "more than one chromatic BRAND accent (status hues are separate)"
  - "the banned blue-purple 'AI' band for the brand hue"
  - "tiny cramped type — energy needs size + weight"
  - "dense gridlined tables as the default surface (prefer cards/gallery)"
  - "ungated motion (always honor prefers-reduced-motion)"
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

> **Art direction.** An energetic, friendly app skin — lively but still legible, the way a good
> consumer product feels approachable without becoming a toy. A single vivid cyan-teal accent, large
> friendly radii, a rounded optimistic sans, and bouncy (but gated) motion. The craft is in **energy
> with discipline** — bright and bouncy, never garish, never illegible.

## Atmosphere

Welcoming and alive. The interface should feel like it's happy you showed up: rounded, bright, a little
springy. But energy is *earned* by restraint elsewhere — one brand accent, real contrast, generous
size — so it reads as delightful, not chaotic.

## Palette — with intent

- **Primary `oklch(0.60 0.15 200)`** — a vivid cyan-teal: bright and cheerful, sitting safely OUTSIDE
  the banned blue-purple band. Because cyan is a high-luminance hue, its labels use **dark ink, not
  white** (`primary-foreground` is a deep teal-black) — a bright pill with dark text reads better,
  looks more playful, and clears WCAG AA comfortably. White-on-cyan would be muddy and is banned.
- **Neutral** a cool ramp so the cyan stays the one chromatic brand color.
- **Surface** a barely-cyan-tinted white in light; a cool teal-charcoal with a brightened cyan accent
  (again dark-ink labels) in dark, so the cheer survives the inversion.
- **Status hues kept bright and saturated** to match the upbeat tone — they're a *separate* budget from
  the single brand accent.

## Type

**Figtree** — a rounded, optimistic geometric sans — for everything, with a heavy `800` display for
big friendly titles and numbers; **Space Mono** adds a quirky accent for counts/codes. Base `1rem` on a
`1.28` scale, leading `1.55` body / `1.15` heading. Lead with **size + bold weight** for energy — this
is the one preset where large display type is encouraged.

## Spacing & rhythm

Comfortable (DENSITY 4) so the energy never crowds the content — generous rhythm to `3rem`, `1.5rem`
card padding. Large friendly corners (`0.875rem`) everywhere; rounding is a personality trait here, not
a subtle softening.

## Components

- **Buttons** — big rounded vivid pills with **dark-ink labels**, a clear press/scale on tap and a
  cheerful hover lift; secondary is a soft cyan-tinted button.
- **Cards** — large rounded, confident border or soft tint, a playful hover lift + slight scale; ideal
  for gallery/feed layouts.
- **Inputs** — rounded, a thick 2px cyan focus ring, comfortable padding.
- **Tables** — softened: rounded container, generous rows, hover-tint. Reach for cards/gallery before a
  dense grid in this voice.
- **Badges** — bright fully-rounded pills, saturated tint + dark text; an emoji/icon when it earns it.

## Motion

The most present of any preset (MOTION 8): `260ms` on a bouncy `cubic-bezier(0.34,1.56,0.64,1)`; hover
lifts + scales `1.02`, buttons depress on active, cards/gallery reveal with springy
scale-from-`0.95` + fade and a staggered cascade. **Always `prefers-reduced-motion`-gated** — delight,
never a nuisance.

## Ornament

Confident rounded borders (sometimes tinted), spacing + cards over rules, soft *colored-tint* shadows
to add bounce (kept light), and optional friendly accent shapes/blobs as sparing background ornament.
The vivid cyan carries the primary action + focus.

## Banned patterns

Muddy white text on the bright cyan · more than one chromatic *brand* accent (status hues are separate)
· the banned blue-purple "AI" band for the brand hue · tiny cramped type · dense gridlined tables as the
default surface · ungated motion.

## Reach for it when

Consumer apps, community products, education, or anything onboarding-heavy where the interface should
feel welcoming and alive.
