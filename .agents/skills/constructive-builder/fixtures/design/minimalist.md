---
version: 1
name: minimalist
description: Quiet near-monochrome workspace — one restrained slate-blue on clean neutrals, hierarchy from weight and space, not color.
atmosphere: "calm, exact, almost-monochrome; the data is the only ornament"
dials:
  variance: 5
  motion: 3
  density: 3
art_direction:
  shell: sidebar
  composition: list
  density: cozy
  notes: "quiet utility workspace; one restrained accent, hierarchy carried by type weight + whitespace, near-zero chrome"
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
type:
  sans: Geist
  mono: Geist Mono
  scale:
    base: "0.9375rem"
    ratio: "1.2"
  weights:
    body: 400
    medium: 500
    heading: 600
  tracking:
    heading: "-0.01em"
    label: "0.02em"
  pairing: "One family (Geist) the whole way down. Differentiate by WEIGHT and SIZE, never by switching typeface — a second face would be decoration this look refuses."
rounded:
  md: "0.375rem"
radius: "0.375rem"
spacing:
  base: "1rem"
  rhythm: ["0.25rem", "0.5rem", "0.75rem", "1rem", "1.5rem", "2.5rem"]
  section_gap: "2.5rem"
components:
  button: "Solid primary only for THE action; everything else is ghost/text. No gradient, no shadow — a 1px ring on focus."
  input: "Hairline border (--border), no inner shadow; label is uppercase 0.02em tracked muted-foreground."
  card: "Used sparingly. Prefer a top border (border-t) over a boxed card; reserve a real card for one genuinely distinct unit."
  table: "Rows divided by a single hairline; header is muted-foreground small-caps; zebra striping is banned."
  badge: "Flat tinted pill, no border; status color carries the meaning, weight stays normal."
motion:
  duration: "120ms"
  easing: "ease-out"
  hover: "opacity/!color only — no transforms"
  enter: "none (content appears; it does not perform)"
  reduced: true
ornament:
  borders: "hairline (1px) at --border; never doubled"
  dividers: "preferred over boxes for grouping"
  shadows: "none in light; at most a faint 1px-spread elevation in dark"
  accents: "the single slate-blue, reserved for the primary action + focus ring"
banned:
  - "color used for hierarchy where weight/size would do"
  - "more than one accent hue"
  - "drop shadows / gradients / glassmorphism"
  - "three equal-weight cards in a row"
  - "zebra-striped tables"
  - "decorative icons that do not encode state"
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

> **Art direction.** A quiet, near-monochrome workspace. Everything is built from one neutral
> gray ramp; the only chromatic note is a deeply restrained slate-blue, and even that is held back
> until an action needs it. This is a look of **omission** — the craft is in what is NOT drawn.

## Atmosphere

Calm and exact. The interface should feel like a well-set spreadsheet that happens to be beautiful:
no chrome competing with the content, no color competing with the type. If a screenshot of an empty
state looks boring, you got it right — the energy belongs to the data, not the frame.

## Palette — with intent

- **Primary `oklch(0.45 0.04 250)`** — a slate-blue with chroma so low (0.04) it reads as "dark
  gray with a hint of blue." Deliberate: hierarchy here comes from **weight and spacing, not color**,
  so the accent stays almost achromatic and only appears on the single primary action + focus rings.
- **Neutral `oklch(…008 250)`** — one cool gray temperature for *every* gray (borders, muted text,
  secondary surfaces). They must never fight warm-vs-cool.
- **Surface** pure white in light, a deep cool charcoal in dark; **on-surface** a near-black cool ink
  (never `#000` — that reads harsh). Dark mode lifts the accent to `0.72` L so the one action still
  reads against charcoal.
- **Status hues** present but muted, so a green "saved" pill or a red "failed" row informs without
  shouting.

## Type

One family, **Geist** sans and mono, the whole way down — the differentiation is **weight + size**,
never a second typeface (a serif here would be decoration this look refuses). Base `0.9375rem` on a
tight `1.2` modular scale; body `400`, emphasis `500`, headings `600` with `-0.01em` tracking; labels
are small, `0.02em`-tracked, muted-foreground. Lead with `font-medium` + full-contrast `foreground`
for the thing that matters and `muted-foreground` for everything supporting — that contrast *is* the
hierarchy.

## Spacing & rhythm

Comfortable-tight (DENSITY 3). A small rhythm — `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2.5rem` — with `2.5rem`
between major sections so the page breathes between dense blocks. Generous *vertical* rhythm, tight
*horizontal* padding: rows are scannable, sections are calm. Corners are tight (`0.375rem`) — present
enough to soften an edge, never round enough to read as friendly.

## Components

- **Buttons** — solid primary for THE action only; everything else ghost/text. No gradient, no shadow;
  a single focus ring.
- **Inputs** — hairline border, no inner shadow, uppercase tracked label.
- **Cards** — used sparingly; prefer a `border-t` to a boxed card. Reserve a real card for one
  genuinely distinct unit, never for a uniform list.
- **Tables** — hairline row dividers, a small-caps muted header; **no zebra striping**.
- **Badges** — flat tinted pills; the status color is the only signal.

## Motion

Minimal (MOTION 3): `120ms ease-out`, hover changes color/opacity only — **no transforms**, no
entrance animation. Always `prefers-reduced-motion`-gated. The UI updates; it does not perform.

## Ornament

Hairline 1px borders at `--border`, never doubled. Dividers over boxes. No shadows in light; at most a
faint elevation in dark. The one slate-blue accent is the entire ornament budget.

## Banned patterns

Color standing in for hierarchy that weight/size could carry · more than one accent hue · drop
shadows / gradients / glassmorphism · three equal cards in a row · zebra tables · decorative icons that
encode no state.

## Reach for it when

The data is the point — admin panels, internal tools, reporting, settings-heavy SaaS — and any
decoration would be noise.
