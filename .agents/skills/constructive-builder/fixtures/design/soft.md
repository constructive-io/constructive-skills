---
version: 1
name: soft
description: High-end SaaS skin — a gentle muted-lavender on soft cool neutrals, rounded corners, low-elevation cards, calm premium motion.
atmosphere: "a polished product marketing-site turned app; calm, rounded, a little aspirational"
dials:
  variance: 7
  motion: 6
  density: 4
art_direction:
  shell: top-nav
  composition: gallery
  density: comfortable
  notes: "consumer-premium feel; generous rounding, soft low cards, a horizontal nav and roomy content; gentle elevation earns attention"
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
  sans: Plus Jakarta Sans
  mono: Geist Mono
type:
  sans: Plus Jakarta Sans
  mono: Geist Mono
  scale:
    base: "1rem"
    ratio: "1.25"
  leading:
    body: "1.6"
    heading: "1.2"
  weights:
    body: 400
    medium: 500
    heading: 600
    display: 700
  tracking:
    display: "-0.02em"
  pairing: "Plus Jakarta Sans throughout — a humanist geometric sans with soft, friendly curves that match the rounded surfaces. Display weight (700) for hero numbers/titles; mono only for IDs/code."
rounded:
  md: "0.75rem"
radius: "0.75rem"
spacing:
  base: "1.05rem"
  rhythm: ["0.375rem", "0.625rem", "1rem", "1.5rem", "2rem", "3rem"]
  card_padding: "1.5rem"
  section_gap: "3rem"
components:
  button: "Pill-ish (0.75rem) solid primary with a soft 1px-spread shadow on hover; secondary is a tinted-lavender soft button, never a hard outline."
  input: "Rounded field with a faint inner surface tint + a soft focus ring (primary at low alpha); generous 0.75rem padding."
  card: "The signature element — soft rounded card, faint border, a gentle low shadow (md elevation) that lifts slightly on hover. Cards group everything."
  table: "Wrapped in a soft card; rounded header row, comfortable row height, hover-tint rows."
  badge: "Fully rounded soft pill, tinted background + matching deeper text; no border."
motion:
  duration: "220ms"
  easing: "cubic-bezier(0.22, 1, 0.36, 1)"
  hover: "a 1–2px lift + soft shadow bloom; tint deepen on soft buttons"
  enter: "scale-from-0.98 + fade for cards/sheets; staggered list reveal"
  reduced: true
ornament:
  borders: "faint, low-contrast (surfaces separated more by shadow than line)"
  dividers: "soft, used sparingly inside cards"
  shadows: "the primary depth device — soft, diffuse, low-opacity; never harsh"
  texture: "barely-tinted off-white surfaces, faint cool lavender cast"
  accents: "the muted lavender for primary + focus; tinted-lavender soft buttons for secondary actions"
banned:
  - "harsh / high-contrast drop shadows"
  - "hard 1px outline buttons (use soft tinted buttons)"
  - "square corners"
  - "over-saturating the lavender into 'AI purple' (keep chroma <=~0.10)"
  - "more than one chromatic accent"
  - "clinical pure-white flat surfaces with no elevation"
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

> **Art direction.** A high-end, gentle SaaS skin — the rounded, calm, slightly premium feel of a
> modern product's marketing site brought into the app. Surfaces are soft cards lifted by diffuse
> shadow; the one accent is a sophisticated desaturated lavender; motion is present but tasteful. The
> craft is in **softness done with restraint** — rounded but not bubbly, elevated but never harsh.

## Atmosphere

Polished and a little aspirational. The product should feel like it cost money and respects your time:
nothing jagged, nothing loud, everything settling gently into place.

## Palette — with intent

- **Primary `oklch(0.55 0.095 285)`** — a muted lavender-indigo. It lives in the cool blue-purple
  region but its chroma is deliberately held LOW (0.095) so it reads as *sophisticated desaturated
  lavender*, not the over-saturated "AI purple" the anti-slop bans flag. Keep chroma ≤ ~0.10; if you
  push it more saturated, set `allow_brand_hue: true` so it's an intentional brand choice.
- **Neutral** shares that faint cool hue so surfaces feel tinted-soft rather than clinical — one calm
  cool family.
- **Surface** a barely-tinted off-white in light, a soft cool charcoal in dark, with a lifted lavender
  accent and off-white ink after inversion.
- **Status hues kept soft** so success/warning pills feel part of the same refined system.

## Type

**Plus Jakarta Sans** throughout — a humanist geometric sans whose soft, friendly curves match the
rounded surfaces (mono is Geist Mono, reserved for IDs/code). Base `1rem` on a `1.25` scale; body
leading `1.6`, headings `1.2`; the `700` display weight is for hero numbers and titles, `600` for
section headings, `500` for emphasis. Tracking tightens slightly on display.

## Spacing & rhythm

Comfortable (DENSITY 4). A roomy rhythm to `3rem` between sections, `1.5rem` card padding, `3rem`
section gaps. Generous rounding (`0.75rem`) on every surface — the rounding is a through-line, not an
accent.

## Components

- **Cards** are the signature: soft rounded, faint border, a gentle low shadow that lifts a touch on
  hover. They group everything.
- **Buttons** — pill-ish solid primary with a soft shadow bloom on hover; secondary is a *tinted
  lavender soft button*, never a hard outline.
- **Inputs** — rounded, faint inner tint, soft low-alpha focus ring, generous padding.
- **Tables** — wrapped in a soft card, rounded header, hover-tinted rows.
- **Badges** — fully rounded soft pills, tinted bg + deeper text, no border.

## Motion

Present and premium (MOTION 6): `220ms` on a springy `cubic-bezier(0.22,1,0.36,1)`; hover gives a 1–2px
lift + soft shadow bloom; cards/sheets scale from `0.98` + fade; lists reveal with a slight stagger.
Always `prefers-reduced-motion`-gated — soft, never showy.

## Ornament

Shadow over line: surfaces separate by **soft diffuse low-opacity shadow**, not borders. Faint
lavender-cast off-white surfaces. Dividers only inside cards, sparingly. The lavender accent carries
primary + focus; tinted-lavender soft buttons carry secondary actions.

## Banned patterns

Harsh high-contrast shadows · hard 1px outline buttons · square corners · over-saturating the lavender
into "AI purple" · more than one chromatic accent · clinical flat pure-white surfaces with no
elevation.

## Reach for it when

Consumer-facing or premium-tier SaaS where the product should feel polished, approachable, and a little
aspirational — onboarding, billing, account, anything customer-facing.
