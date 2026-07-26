---
name: Folio
description: An editorial print archetype — warm paper, serif display over humanist sans, long-form and calm.
dials: { variance: 6, motion: 3, density: 4 }
font: { sans: "Source Sans 3", mono: "IBM Plex Mono", serif: "Lora" }
radius: "0.5rem"
colors:
  background: "oklch(0.985 0.006 85)"
  foreground: "oklch(0.25 0.012 80)"
  primary: "oklch(0.42 0.07 155)"
  primary-foreground: "oklch(0.98 0.008 85)"
  muted: "oklch(0.95 0.008 85)"
  muted-foreground: "oklch(0.50 0.013 80)"
  accent: "oklch(0.74 0.09 85)"
  border: "oklch(0.88 0.010 82)"
  ring: "oklch(0.42 0.07 155)"
  destructive: "oklch(0.52 0.18 27)"
  success: "oklch(0.55 0.10 150)"
  warning: "oklch(0.74 0.11 75)"
  info: "oklch(0.50 0.07 215)"
dark:
  background: "oklch(0.20 0.012 80)"
  foreground: "oklch(0.94 0.008 85)"
  primary: "oklch(0.62 0.08 155)"
  border: "oklch(0.34 0.012 80)"
---

# Folio

> Art direction: a typeset page, not a screen — ink-green on warm paper, where the serifs and the measure do the work that chrome usually does.

## Atmosphere
A long-form reading surface that happens to hold an app: an archivist's desk, a printed annual, a well-bound journal. It feels unhurried, literate, and confident — air around every block, weight in every title, nothing shouting for attention.

## Palette — with intent
The primary is a sober **ink-green** (hue ~155, chroma kept modest): the color of a good fountain-pen ink or a ledger rule — intentional and bookish, never an alert. It carries links and the single page action. The whole neutral ramp is pulled *warm* (hue ~80) so borders and muted text read as printed gray, not screen gray. The lone accent is a quiet **brass/ochre** reserved for a kicker or a hairline flourish — present, never a second voice. Status hues stay earthy so they harmonize with the paper instead of puncturing it.

## Type
The soul of the look is the **serif/sans contrast**. Set the masthead and display headings in a warm humanist old-style serif (prefer a Lora / Source Serif / Spectral family) and the body + UI in a readable humanist sans (Source Sans 3, IBM Plex Sans); data and codes in a mono. A roomy base on a *large* scale ratio (~1.414, an augmented fourth) gives a book-like jump from body to display; body leading runs generous (~1.7), headings tight. Clamp body copy to a comfortable measure so lines never run too long. Never flatten the two faces into one — that contrast is the whole signal. Avoid Inter / Roboto / Open Sans / Lato / system-ui as the headline face.

## Layout & density
Editorial-wide: a centered column with a prominent masthead, not a navigation rail fighting the content. Compose entities as article-like rows or a single readable list, generous (DENSITY ~4) with a wide rhythm. Depth strategy is **borders-only** — warm hairline rules between sections are the primary grouping device; no boxed cards, no drop shadows. Medium radius (`0.5rem`) softens controls just enough to feel humane without going round.

## Motion
Restrained (MOTION ~3): short fades and a gentle underline/rule reveal on hover; sections settle in on first paint. Always honor `prefers-reduced-motion`.

## Banned
- Clinical pure-white or pure-black slabs — use the warm paper and warm ink tones.
- A single flat sans for everything (the serif display is the point).
- Boxed heavy cards, drop shadows, or decorative gradients.
- A second chromatic accent competing with the ink-green.
- Cramped body line-height or center-aligned long paragraphs.

## Reach for it when
Content-forward, document-heavy, or premium products — reading apps, knowledge bases, long-form admin, editorial tooling.
