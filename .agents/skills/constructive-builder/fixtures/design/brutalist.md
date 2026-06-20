---
version: 1
name: brutalist
description: Raw high-contrast utility UI — near-black ink accent, square corners, hard hairline borders, monospace structure, dense and exacting.
atmosphere: "engineered and exacting, not friendly; all edges, ink, and grid — the machine showing its work"
dials:
  variance: 4
  motion: 2
  density: 2
art_direction:
  shell: dense-dashboard
  composition: data-table
  density: compact
  notes: "utilitarian back-office grid; hard borders, square corners, monospace labels + data, persistent chrome, near-zero motion"
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
  sans: Space Grotesk
  mono: JetBrains Mono
type:
  sans: Space Grotesk
  mono: JetBrains Mono
  scale:
    base: "0.875rem"
    ratio: "1.2"
  leading:
    body: "1.45"
    heading: "1.1"
  weights:
    body: 400
    medium: 500
    heading: 700
  tracking:
    label: "0.04em"
    heading: "-0.01em"
  pairing: "Space Grotesk display for headings (its mechanical, slightly-condensed letterforms read 'engineered'); JetBrains Mono for ALL labels, table data, ids, metadata — mono is a structural device here, not just for code."
rounded:
  md: "0rem"
radius: "0rem"
spacing:
  base: "0.9rem"
  rhythm: ["0.25rem", "0.5rem", "0.75rem", "1rem", "1.5rem", "2rem"]
  cell_padding: "0.5rem 0.75rem"
  section_gap: "2rem"
components:
  button: "Square, hard 1px (or 2px) border, no radius, no shadow; primary is an ink-black fill with white label; hover INVERTS fg/bg rather than tinting."
  input: "Square field, hard 1px border, mono value text, a visible 2px focus border (no soft ring)."
  card: "A bordered box with a hard 1px rule and a tiny mono header label; no shadow, no rounding — a frame, not a float."
  table: "The primary surface. Full hard gridlines (every cell ruled), mono data, small-caps mono header, tight 0.5rem cells; right-align numerics."
  badge: "Square mono tag with a hard border; status color is the only chroma."
motion:
  duration: "0ms"
  easing: "linear"
  hover: "instant state change (fg/bg invert, border thicken) — no transition"
  enter: "none — content is present, it does not animate in"
  reduced: true
ornament:
  borders: "hard 1px (sometimes 2px) full borders + complete table gridlines — the defining device"
  dividers: "hard rules everywhere; boxes are welcome (the opposite of minimalist)"
  shadows: "none, ever"
  texture: "flat near-white / true near-black; no gradients"
  accents: "ink. Chroma is reserved for STATUS only (error/success/warning) so color always means something"
banned:
  - "rounded corners of any radius"
  - "drop shadows / gradients / glassmorphism"
  - "soft focus rings (use a hard 2px border)"
  - "transition animations on hover/enter"
  - "decorative color — chroma is reserved for meaning (status) only"
  - "a proportional font for table data or labels (use mono)"
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

> **Art direction.** A raw, high-contrast utility look — structural and unapologetic, all edges and
> ink. The "brand color" is essentially deep gray; emphasis comes from **stark contrast, hard hairline
> borders, square corners, and monospace structure**, not hue. The craft is in the **rigor of the
> grid** — every rule deliberate, every cell aligned.

## Atmosphere

Engineered and exacting, not friendly. The UI should look like it was built to be *correct* — a
machine showing its work. Boxes, rules, and mono are features, not failures; the discipline is what
makes it read as intentional rather than merely austere.

## Palette — with intent

- **Primary `oklch(0.42 0.02 250)`** — a near-black, almost-achromatic ink (chroma 0.02). The brand
  color is deep gray; emphasis is contrast and edges, not color.
- **Surface** bright off-white with a heavy near-black ink in light; dark mode flips to true near-black
  with a near-white primary, so a button reads as a hard *light slab on dark* — the inverse of the
  light slab on white.
- **Status hues stay CHROMATIC** (vivid red error, clear green success, amber warning): in an
  otherwise monochrome system the only color is *meaning*, which makes state unmistakable. That single
  restraint is what keeps brutalist legible.

## Type

**Space Grotesk** display for headings — its mechanical, slightly-condensed letterforms read
"engineered." **JetBrains Mono for everything structural**: all labels, table data, ids, metadata,
timestamps. Mono is a *structural device* here, not a code affordance. Base `0.875rem` on a tight
`1.2` scale, leading `1.45` body / `1.1` heading; headings are heavy `700`; labels are `0.04em`-tracked
mono small-caps.

## Spacing & rhythm

Tight (DENSITY 2) for an information-dense grid feel. Small rhythm to `2rem`; cells are a tight
`0.5rem 0.75rem`. Corners are **fully square** (`0rem`) — the radius budget is zero. Density is a
feature: pack the grid, keep it ruled and aligned.

## Components

- **Tables** are the primary surface: full hard gridlines (every cell ruled), mono data, a small-caps
  mono header, tight cells, right-aligned numerics.
- **Buttons** — square, hard 1–2px border, no radius/shadow; primary is an ink fill; **hover inverts
  fg/bg** rather than tinting.
- **Inputs** — square, hard border, mono value, a visible 2px focus border (no soft ring).
- **Cards** — a bordered box with a hard rule and a tiny mono header label; a frame, not a float.
- **Badges** — square mono tags with a hard border; status is the only chroma.

## Motion

Near-zero (MOTION 2): `0ms` — state changes are **instant** (fg/bg invert, border thicken), no hover
or entrance transitions. (Still declare `prefers-reduced-motion` for anything you do add.) The UI does
not animate; it just *is*.

## Ornament

Hard 1px (sometimes 2px) full borders + complete table gridlines are the defining device — and unlike
minimalist, **boxes are welcome**. No shadows ever, no gradients, flat near-white / near-black.
Chroma is reserved for status only.

## Banned patterns

Rounded corners of any radius · drop shadows / gradients / glassmorphism · soft focus rings · hover or
enter transitions · decorative color (chroma is reserved for status) · a proportional font for table
data or labels.

## Reach for it when

Developer tools, dense back-office grids, infra/monitoring consoles, or any product that wants to look
engineered and exacting rather than friendly.
