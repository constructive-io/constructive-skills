---
version: 1
name: editorial
description: Warm print-inspired UI — terracotta ink on warm paper, a serif masthead over a clean sans body, calm and authored.
atmosphere: "a well-set magazine page that happens to be an app; considered, unhurried, warm"
dials:
  variance: 7
  motion: 4
  density: 4
art_direction:
  shell: editorial-wide
  composition: editorial
  density: comfortable
  notes: "content-forward publishing feel; centered measure, a prominent masthead, serif display over sans body, generous leading"
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
  sans: IBM Plex Sans
  mono: IBM Plex Mono
type:
  sans: IBM Plex Sans
  serif: "a transitional/old-style serif for the masthead + display headings (the agent adds a second next/font loader, e.g. a Plex Serif / Source Serif family, bound to a --font-display variable)"
  mono: IBM Plex Mono
  scale:
    base: "1.0625rem"
    ratio: "1.333"
  leading:
    body: "1.65"
    heading: "1.15"
  weights:
    body: 400
    medium: 500
    heading: 600
    display: 700
  tracking:
    display: "-0.02em"
    body: "0"
  measure: "68ch"
  pairing: "Serif display over sans body — the masthead + page titles in a warm transitional serif, body + UI in IBM Plex Sans. This serif/sans contrast IS the editorial signal; don't flatten it to one face."
tokens:
  --rule-hairline: "1px solid oklch(0.85 0.01 60)"
  --measure: "68ch"
rounded:
  md: "0.25rem"
radius: "0.25rem"
spacing:
  base: "1.05rem"
  rhythm: ["0.375rem", "0.625rem", "1rem", "1.5rem", "2.25rem", "3.5rem"]
  section_gap: "3.5rem"
components:
  button: "Primary is a calm clay fill with a near-square edge; secondary is a thin underlined text link (a print 'see more' affordance)."
  input: "Single bottom rule rather than a full box where it fits — a form that feels typeset; full borders only for grouped fieldsets."
  card: "Borderless 'article' blocks separated by generous whitespace + a hairline rule; avoid heavy boxes — let the measure and rhythm group content."
  table: "Light rules under the header and between sections only; right-align numerics; let columns breathe."
  badge: "A small caps kicker in clay or muted-foreground, letter-spaced — reads like a magazine label, not a UI chip."
motion:
  duration: "200ms"
  easing: "cubic-bezier(0.2, 0, 0, 1)"
  hover: "gentle color/underline reveal; a slight 1px rule grow"
  enter: "a soft 8px rise + fade on first paint of a section"
  reduced: true
ornament:
  borders: "hairline rules, warm-toned (border derived from the warm neutral)"
  dividers: "thin horizontal rules between articles/sections — the primary grouping device"
  shadows: "none; depth comes from whitespace + rules, not elevation"
  texture: "a faint warm-paper surface tint instead of clinical white"
  accents: "the clay primary used for links + the one page action; a small-caps kicker for section labels"
banned:
  - "clinical pure-white surfaces (use the warm paper tint)"
  - "a single flat sans for everything (the serif display is the point)"
  - "boxy heavy cards / drop shadows"
  - "cramped line-height on body copy (keep ~1.65)"
  - "more than one chromatic accent"
  - "center-aligned long body paragraphs"
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

> **Art direction.** A warm, print-inspired look — the way a well-set magazine page feels: a serif
> masthead, a clean sans body, generous leading, and a single ink-clay accent doing the work of a
> headline color. The craft is in the **typesetting** — the measure, the rhythm, the serif/sans
> contrast — not in chrome.

## Atmosphere

Considered and unhurried. The reader should feel they're looking at something *authored*, not
generated — every section has air around it, every title carries weight. Trust comes from restraint
and good type, not from blue and rounded corners.

## Palette — with intent

- **Primary `oklch(0.50 0.10 28)`** — a terracotta ink-red (hue ~28): saturated enough to feel
  intentional and editorial, muted enough never to read as an alert. It carries links + the one page
  action.
- **Neutral (warm, hue ~55)** — the whole gray ramp is given a *warm* temperature so borders and
  muted text feel like printed gray, not screen gray.
- **Surface a warm paper white** (not clinical `#fff`) with a soft warm-black ink on top. Dark mode
  becomes a warm near-black "evening reading" surface with a lifted clay accent — the print feeling
  survives the inversion.
- **Status hues kept earthy** so they harmonize with the warm body rather than puncturing it.

## Type

The soul of this preset. **Serif display over sans body**: the masthead and page titles in a warm
transitional serif (the agent adds a second `next/font` loader bound to a `--font-display` variable —
the compiler swaps the body sans only), with body + UI set in **IBM Plex Sans** and code in **IBM
Plex Mono**. Base `1.0625rem` on a wide `1.333` scale; body leading a roomy `1.65`, headings tight at
`1.15` with `-0.02em` tracking. Body content is clamped to a **`68ch` measure** so lines never run too
long to read. Section labels are small-caps, letter-spaced kickers. Do not flatten the serif/sans
contrast to one face — that contrast *is* the editorial voice.

## Spacing & rhythm

Generous (DENSITY 4). A wide rhythm topping out at `3.5rem` between sections. Corners are nearly square
(`0.25rem`) for a crisp typographic edge. Depth is whitespace + rules, never boxes.

## Components

- **Buttons** — a calm clay fill (near-square) for the primary; secondary is a thin underlined text
  link, the print "see more."
- **Inputs** — a single bottom rule where it fits, a typeset form; full borders only for grouped
  fieldsets.
- **Cards** — borderless "article" blocks separated by whitespace + a hairline rule; no heavy boxes.
- **Tables** — light rules under the header and between sections only; right-aligned numerics; columns
  breathe.
- **Badges** — a letter-spaced small-caps kicker, not a UI chip.

## Motion

Gentle (MOTION 4): `200ms` on a soft `cubic-bezier(0.2,0,0,1)`; hover reveals an underline or grows a
1px rule; sections rise 8px + fade on first paint. Always `prefers-reduced-motion`-gated — tasteful,
never showy.

## Ornament

Warm-toned hairline rules are the primary grouping device (between articles, under headers). A faint
warm-paper surface tint replaces clinical white. No shadows — depth is whitespace and rules. The clay
accent + small-caps kickers are the only flourishes.

## Banned patterns

Clinical pure-white surfaces · a single flat sans for everything · boxy heavy cards / drop shadows ·
cramped body line-height · more than one chromatic accent · center-aligned long paragraphs.

## Reach for it when

Content-forward, document-heavy, or premium B2B products where the experience should feel authored and
unhurried — publishing, knowledge bases, long-form dashboards, editorial CMS tooling.
