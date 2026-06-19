# Design System — authoring a `design.md` (theme + layout taste)

> **What this is.** The methodology a **build agent** reads to give a generated app a *coherent,
> legible, non-generic* look — without hand-picking hex codes and without breaking shadcn or the
> installed Blocks. You read style intent (from `app.label` / `app.description` / entity names / an
> optional `design.brief`), **classify it into three dials**, pick/adapt a **preset**, and **author a
> `design.md`** (Google-Labs format) that commits to ONE accent + a coherent palette. The deterministic
> engine (`scripts/check-design.mjs` + `scripts/wire-design.mjs`) then **validates** the invariants +
> **WCAG contrast** and **compiles** the theme into the app's `globals.css` token overrides.
>
> **This is GUIDELINES, not a lookup table.** There is deliberately **no** "domain → palette" map
> (that would violate the genericity principle). You *reason* from words to dials to a palette; the
> compiler *enforces* correctness. Presets are anchors you adapt, never constraints.

> **The contract in one line.** `design.md` (intent) → `compileDesign` (role-remap + OKLCH
> dark-derivation + WCAG repair) → a single **marked override block** of shadcn token *values* in the
> app's `globals.css`. Overriding token *values* restyles the template UI **and every installed Block
> at once** (they all read `var(--…)`). Structure is off-limits.

---

## 1. When the design step runs (and when it's a no-op)

- **Default (the `design:` block is ABSENT):** **auto-propose** a full, domain-fitting theme on every
  build. This is the new baseline — a generated app should not ship the stock Constructive blue unless
  asked. Author a `design.md`, lint it, compile it.
- **Opt-out (`design: { preset: constructive }`):** **keep today's look exactly.** `wire-design` is a
  **no-op** — the boilerplate `globals.css` is left untouched. Use this when the brief explicitly wants
  the stock theme, or when a downstream consumer pins the default.
- **Compile failure / impossible contrast:** **no-op + loud warning**, never a half-written theme. The
  stock look survives; you fix the `design.md` and re-run.

The step is wired into the build at **S6.5** (after the Blocks `@import` at S5, before the domain CRUD
body at S7) — see [speedrun.md](./speedrun.md). It is idempotent and `--dry-run`-able.

---

## 2. The three dials (reused from the taste-skill)

Every look reduces to three integer dials, **1–10**. They are the bridge from words to tokens + layout.

| Dial | 1 ………………… 10 | Drives |
|---|---|---|
| **VARIANCE** | flat / monochrome → bold / high-contrast / saturated | palette chroma + accent strength, surface↔foreground ΔL, border visibility |
| **MOTION** | none / instant → lively / springy | transition durations, hover/enter animation (always `prefers-reduced-motion`-gated) |
| **DENSITY** | airy / generous whitespace → compact / data-dense | padding, gap, row height, font-size step on entity pages |

> **Bias for apps.** This builder makes **applications** (dashboards, CRUD tools, internal SaaS), not
> Awwwards landing pages. Bias every classification toward the **trust-first / minimalist** rows below.
> Theatrics (high VARIANCE + high MOTION) must be *earned* by the brief, not the default.

### words → dials → preset

Classify the natural-language style words into a row. The preset is the **anchor** you then adapt.

| If the words say… | dials (VARIANCE / MOTION / DENSITY) | preset anchor |
|---|---|---|
| calm, trustworthy, neutral, "just works", admin, finance, healthcare, enterprise | **3–4 / 2–3 / 4–5** | `trust-first` |
| clean, simple, focused, minimal, content-first, quiet | **5–6 / 3–4 / 2–3** | `minimalist` |
| refined, high-end, editorial, premium, elegant, "print feel", luxe | **7–8 / 5–7 / 3–4** | `premium` (→ `editorial` / `soft`) |
| fun, friendly, energetic, playful, consumer, vibrant, bold | **9–10 / 8–10 / 3–4** | `playful` |
| raw, stark, utilitarian, brutalist, monospace, "no chrome" | **6–7 / 1–2 / 5–6** | `brutalist` |

> **Unsure?** Default to **`trust-first`** (3–4 / 2–3 / 4–5) — the safe, legible app baseline. A boring
> app that works beats a beautiful one that fails contrast.

Each dial maps to one of the named presets in §4. The dials are also threaded into the layout pass
(DENSITY → spacing literals baked into the generated entity pages at emit time) — see §8.

> **Single source of truth for the dials:** `brief.design.dials` (specifically `dials.density`).
> `scaffold-frontend` reads density from `brief.design.dials.density`; if it is absent there it
> falls back to the emitted `design.md` frontmatter's `dials.density` (§8). The `design.md` itself
> carries the *palette / type / radius* tokens; `dials` carries the *layout* dials. Record the dials
> in the brief by preference — the design.md fallback exists so an auto-propose agent that recorded
> them in the emitted design.md still threads density correctly.

---

## 3. Color invariants (enforced by `invariants.mjs` / `check-design.mjs`)

These are the taste guardrails as code. The agent should *author within* them; the linter *fails the
build* if violated. Author the palette to satisfy them up front — don't make the linter do the work.

| Rule | Severity | Why |
|---|---|---|
| **`primary` required** | **error** | a theme with no primary has nothing to remap |
| **≤ 1 accent** | warn | a second accent reads as noise; one accent + neutrals is the disciplined look |
| **saturation / chroma < ~80%** (OKLCH `c` capped) | warn | screaming-saturated tokens fatigue and clash with shadcn neutrals |
| **no pure black** (min lightness `L ≥ ~0.18`) | warn | pure `#000` text/surfaces look harsh; near-black reads as intentional |
| **ban the "AI purple/blue" band** for `primary`/`accent` | warn | hue ≈ **255–310** with `c > ~0.12` is the generic-AI tell; pick a hue with intent. Override with `allow_brand_hue: true` only when that hue is a *deliberate brand color* |
| **one gray temperature** | (authoring) | derive neutrals from ONE hue so grays don't fight (warm vs cool) |
| **dimension units px / em / rem only** | warn | unitless or exotic units don't compile cleanly |
| **contrast pairs** (fg/bg, primary/primary-fg, muted-fg/bg, destructive, status tints) | **error < 3:1**, warn < 4.5 | legibility floor; the compiler also auto-repairs (§6) |
| **success/warning `*-foreground` tint contract** | warn | text-on-tint must flip per mode (§6 gotcha) |

> **No green-washing.** Contrast is computed (WCAG relative luminance over the OKLCH→sRGB conversion),
> not asserted. A theme that can't pass at 4.5:1 after foreground-nudging **hard-fails** with a clear
> message — fix the palette, don't lower the bar.

---

## 4. The preset catalog (anchors — names + when to use)

Each preset is a complete, lint-passing `design.md` in `fixtures/design/<name>.md`. They double as the
deterministic compiler fixtures. **Pick the closest, then adapt** the colors/dials to the brief — never
treat a preset as a fixed skin.

| Preset | Dials (V/M/D) | The look | Reach for it when |
|---|---|---|---|
| **`constructive`** | (= stock) | the current Constructive blue, light-first | **the opt-out** — `design: { preset: constructive }` keeps today's look (no-op) |
| **`minimalist`** | 5–6 / 3–4 / 2–3 | restrained palette, generous type, few borders | content-first apps, "clean & simple", default when in doubt-but-not-trust |
| **`trust-first`** | 3–4 / 2–3 / 4–5 | calm neutrals, low chroma, dense + legible | admin / finance / healthcare / enterprise; **the safe default** |
| **`editorial`** | 7–8 / 5–7 / 3–4 | high-end print feel, serif headings, warm neutrals | publishing, blogs, "editorial / high-end print" |
| **`soft`** | 7–8 / 5–7 / 3–4 | premium, soft surfaces + elevation, gentle radii | polished consumer SaaS, "premium / elegant / soft" |
| **`brutalist`** | 6–7 / 1–2 / 5–6 | stark, monospace, hard borders, near-zero radius | utilitarian / developer tools / "raw / no chrome" |
| **`playful`** | 9–10 / 8–10 / 3–4 | vivid accent, rounder radii, livelier motion | consumer / friendly / "fun & energetic" (use the chroma cap!) |

> Presets are **starting points**. A "calm fintech with a deep-green brand" = `trust-first` anchor +
> `colors.primary` set to that green. You are not limited to the seven palettes.

---

## 5. The `design.md` format (the intermediate representation)

A `design.md` is **Markdown with a YAML frontmatter** (Google Labs `design.md` open standard; we conform
to the format, we do **not** depend on its CLI). The frontmatter is parsed by the skill's existing
zero-dep YAML reader — **no new dependency**. It is emitted into the app (e.g. `packages/app/design.md`)
as the durable design record + day-2 input.

### 5.1 Frontmatter schema

| Key | Required | Shape | Notes |
|---|---|---|---|
| `version` | optional | int | document version (e.g. `1`) |
| `name` | **required** | string | a short theme name (e.g. `"calm-fintech"`) |
| `description` | optional | string | one-line intent |
| `colors` | **required** | map | the palette **roles** (see below). `primary` is required |
| `typography` | optional | map | `{ sans, mono, serif? }` — font *family names* (resolved against the allowlist, §7) |
| `rounded` | optional | map or scalar | `{ sm, md, lg }` or a single radius; `md` (or the scalar) seeds `--radius` |
| `spacing` | optional | map | base spacing scale (informational; density rides the dials, §8) |
| `dials` | optional | map | `{ variance, motion, density }` — recorded so the layout pass + day-2 reads them. **Canonical home is `brief.design.dials`**; this frontmatter `dials` is the *fallback* `scaffold-frontend` reads for DENSITY when the brief omits it (§8) |
| `components` | optional | map | per-component hints (advisory; the compile contract is token-level) |
| `dark` | optional | map | explicit dark-mode overrides — **escape hatch** when OKLCH auto-derivation (§6) isn't pretty enough |
| `default_mode` | optional | `light` \| `dark` | which theme loads first (→ `layout.tsx` `ThemeProvider defaultTheme`) |
| `allow_brand_hue` | optional | bool | opt out of the AI-purple-band warning for a *deliberate* brand hue |

**`colors` roles** (semantic, NOT shadcn var names — the compiler maps roles → vars in §6):

| Role | Meaning | Required |
|---|---|---|
| `primary` | the one brand/action color | **yes** |
| `accent` | at most ONE secondary highlight | no (≤1) |
| `neutral` | the gray family (ONE temperature) — drives secondary/muted/border | recommended |
| `surface` | page/card background base | recommended |
| `on-surface` | default text/foreground over surface | recommended |
| `error` | destructive / danger | no (falls back to a sane red) |

Colors may be `oklch(L C H)`, `#rrggbb`, or `rgb(…)` — the engine parses all three and normalizes to
OKLCH internally.

### 5.2 A short example

```markdown
---
version: 1
name: calm-fintech
description: trustworthy, low-chroma, dense and legible — a finance admin
dials: { variance: 4, motion: 2, density: 5 }
colors:
  primary: "oklch(0.55 0.11 162)"     # a deep, calm green (NOT the AI-purple band)
  neutral: "oklch(0.55 0.01 250)"     # one cool gray temperature
  surface: "oklch(0.99 0.004 250)"    # near-white, faint cool tint
  on-surface: "oklch(0.27 0.01 250)"  # near-black, never #000
  error: "oklch(0.55 0.2 25)"
typography: { sans: "Geist", mono: "Geist Mono" }
rounded: { md: "0.375rem" }
default_mode: light
---

# Calm Fintech

A trust-first admin theme. One green action color, a single cool gray ramp, generous-but-dense
spacing. Dark mode derives automatically by lightness inversion.
```

Everything is optional except `name` + `colors.primary`. The compiler synthesizes the missing tokens
(border, input, ring, muted-foreground, card/popover elevation, sidebar, chart ramp) from
primary/surface/neutral via OKLCH math.

---

## 6. The compile / override contract (what `compileDesign` may touch)

`compileDesign(design, { defaultMode })` returns `{ light, dark, radius, fonts, warnings }`;
`renderOverrideBlock({light,dark})` emits a **single marked block** appended to the app's `globals.css`.

### 6.1 Role → shadcn var map (light; dark is derived)

| shadcn var | derived from |
|---|---|
| `background` | `surface` |
| `foreground` | `on-surface` |
| `card` / `popover` (+ their `-foreground`) | `surface` (+ a small ΔL elevation) / `on-surface` |
| `primary` | `colors.primary`; **`primary-foreground` = `ensureContrast(auto light/dark, primary)`** |
| `secondary` (+ `-foreground`) | a neutral-muted surface / `on-surface` |
| `muted` / `muted-foreground` | neutral subtle / toward `on-surface` (kept ≥ 4.5:1 on background) |
| `accent` (+ `-foreground`) | `colors.accent` ‖ tertiary ‖ desaturated `primary` / contrast |
| `destructive` (+ `-foreground`) | `colors.error` / contrast |
| `border` | `surface` shifted ~10% ΔL toward `on-surface` |
| `input` | `border`, slightly stronger |
| `ring` | `primary` |
| `chart-1..5` | `primary` hue rotations `[0, +40, -40, +90, -90]` at fixed chroma/L |
| `sidebar*` | derived from `surface` / `neutral` + `primary` |
| `radius` | `design.radius` ‖ `rounded.md` ‖ `0.5rem` |

### 6.2 Override surface — the ONLY vars the compiler may emit

```
background, foreground, card, card-foreground, popover, popover-foreground,
primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground,
accent, accent-foreground, destructive, destructive-foreground, border, input, ring,
chart-1 … chart-5,
sidebar, sidebar-foreground, sidebar-primary, sidebar-primary-foreground,
sidebar-accent, sidebar-accent-foreground, sidebar-border, sidebar-ring,
info, info-foreground, success, success-foreground, warning, warning-foreground, radius
```

The block is delimited by **exact sentinels** (byte-identical across the engine + the codemod):

```css
/* >>> constructive-builder design overrides (generated) */
:root { /* …override-surface vars… */ }
.dark { /* …override-surface vars… */ }
/* <<< constructive-builder design overrides */
```

It is placed **after** the `.dark` block and **before** `@theme inline {` so it wins by source order —
and naturally wins over the Blocks `@import` (which sits above it). Re-running locates the sentinels and
**replaces in place** (idempotent); `--dry-run` reports the diff without writing.

### 6.3 STRUCTURAL — never emit or alter

`@theme inline`, `@source`, `@custom-variant dark`, `@plugin`, the **second** z-layer `:root` block
(`--z-layer-*`), `@layer base`, `@layer utilities`, the `[data-slot=…]` skeleton/portal rules,
`--shadow-*`, `--font-serif`, and the `--radius-*` derivations inside `@theme inline`. Touching any of
these breaks Tailwind wiring, overlay stacking, or skeleton animation.

### 6.4 Dark-mode derivation

When `design.dark` is **absent**, `.dark` is derived from light by **OKLCH lightness inversion** (keep
hue + chroma, clamp into range) with foregrounds **re-paired** for contrast. When `design.dark` is
present, it wins (the escape hatch for when auto-derivation isn't pretty enough). `default_mode` sets
which loads first via `layout.tsx`'s `ThemeProvider defaultTheme` (boilerplate default is `dark`).

### 6.5 The three gotchas (each one is a real footgun)

1. **Fonts change ONLY via the `layout.tsx` loader swap — never via a `:root --font-*` value.** The
   boilerplate's `:root { --font-sans: Open Sans }` is **dead**: it is shadowed by `@theme inline
   --font-sans: var(--font-geist-sans)`. So `--font-sans`/`--font-serif`/`--font-mono` are **NOT** in the
   override surface. To change the typeface, the font codemod swaps the `next/font/google` loader import
   in `layout.tsx` **while keeping the variable NAMES** `--font-geist-sans` / `--font-geist-mono` (and the
   `<body>` className tokens) intact, so `@theme inline` still resolves. See §7.
2. **`success`/`warning`/`info` `*-foreground` are text-on-tint — they must FLIP per mode.** In the
   boilerplate they are dark-on-light in **light** mode (`*-700`) and light-on-dark in **dark** mode
   (`*-400`). A naive `white` foreground fails on a light-mode amber/emerald tint. The compiler honors
   this contract (and the linter warns if a tint pair is illegible). The boilerplate ships these as
   Tailwind palette refs (`var(--color-emerald-500)` …); the compiler may replace them with OKLCH tint
   values — but if it does, it MUST keep the flip.
3. **Contrast is repaired, not assumed.** `ensureContrast(fg, bg, target)` nudges the foreground's
   lightness toward a pass before emitting. If a critical pair can't reach the target, compile
   **hard-fails** with the offending pair named — it never green-washes.

---

## 7. Fonts (the `next/font/google` allowlist)

Typeface choice is constrained to a curated allowlist of `next/font/google` families so the build never
breaks on a missing/typo'd font: **Geist, Geist Mono, Outfit, Sora, Manrope, JetBrains Mono, IBM Plex
Sans, IBM Plex Mono** (and similar). `resolveFont(name)` returns `{ loaderName, importLine, variable }`
or **falls back to Geist + a warning** for anything off-list.

- Set the typeface in `design.md` `typography.{ sans, mono }`.
- The codemod swaps **only** the loader import + the `const X = Loader({ variable: '--font-geist-sans' })`
  call in `layout.tsx`, **keeping** the variable strings `--font-geist-sans`/`--font-geist-mono` and the
  `<body>` className — so `@theme inline` keeps resolving. Never edit a `:root --font-*` value (gotcha #1).
- Off-allowlist or omitted → Geist (the boilerplate default). Don't reach for an arbitrary Google font;
  pick from the list or accept the fallback.

---

## 8. Layout & component taste (dial-driven, app-appropriate)

The theme colors the app; the **dials** shape its layout. These are generic patterns — **no entity/app
literals** ever (the page/state code is derived from the brief's tables, not hard-coded).

- **Mandatory states on every generated entity/CRUD page** (the highest-value app rule): a **loading**
  skeleton that *matches the real layout* (not a spinner), an **empty** state (clear "nothing yet" +
  the primary create action), and an **error** state (legible message + retry). The boilerplate already
  ships skeleton/`[data-slot]` animation primitives — reuse them.
- **DENSITY → Tailwind spacing literals baked in at emit time.** `scaffold-frontend` resolves the
  DENSITY dial to one of three spacing tiers (`comfortable` / `cozy` / `compact`; `cozy` is the
  default == the historical literals) and substitutes whole Tailwind class strings (padding / gap /
  row-height / page rhythm) directly into the generated entity + stub pages. It is **emit-time**
  substitution, **not** a runtime `data-density` attribute and **not** a `globals.css` rule — so it
  never collides with the token override block, but it also means **a generated entity page is
  emit-once / idempotent: changing the density after the first scaffold requires a re-emit** (delete
  the page or run on a fresh app dir) for the new spacing tier to take effect. The DENSITY dial is
  resolved from `brief.design.dials.density`, falling back to the emitted `design.md`'s
  `dials.density` (resolution order, §2 + §5.1) — **the single source of truth is `brief.design.dials`**;
  the design.md fallback only exists so an auto-propose agent that recorded the dials in the design.md
  still threads density correctly.
- **Hierarchy via weight + color, not just size.** Lead with `font-medium`/`foreground` vs
  `muted-foreground`; reserve large sizes for true page titles.
- **One accent.** Use the accent for the single primary action per view; everything else is
  neutral/border. (Mirrors the ≤1-accent invariant.)
- **Cards only where elevation earns it.** Prefer dividers / `border-t` for flat lists; use a card
  (with its small ΔL elevation) only to group a genuinely distinct unit.
- **MOTION is subtle and gated.** Keep transitions short; **always** honor `prefers-reduced-motion`
  (the boilerplate's skeleton rules already do — match that discipline).

---

## 9. The keep-default escape hatch (and other off-ramps)

- **Keep today's look:** `design: { preset: constructive }` → `wire-design` is a **no-op**. The single
  most important off-ramp: a build that wants the stock theme gets it, untouched.
- **Dark not pretty?** Add an explicit `dark:` map to the `design.md` frontmatter (§6.4).
- **A deliberate purple/blue brand hue?** `allow_brand_hue: true` silences the AI-purple-band warning
  (§3) — use it only when that hue is genuinely the brand, not as a blanket mute.
- **Off-allowlist font?** Accept the Geist fallback, or pick an allowlisted family (§7).
- **A token the override surface can't express?** It is almost certainly **structural** (§6.3) — leave
  it. The override surface is the complete set of *thematic* tokens; anything outside it is wiring.

---

## 10. The agent's loop (putting it together)

1. **Read the intent.** `app.label` + `app.description` + entity names + any `design.brief` words.
2. **Classify → dials** via the words→dials table (§2). Bias to trust-first/minimalist for apps.
3. **Pick + adapt a preset** (§4). Set `colors.primary` (and at most one `accent`) with intent — avoid
   the AI-purple band unless it's the real brand.
4. **Author the `design.md`** (§5): one accent, one gray temperature, near-black not black, chroma under
   the cap. Record the dials.
5. **Lint:** `node scripts/check-design.mjs` (invariants + WCAG). Fix any **error**; weigh the warns.
6. **Compile + wire:** `node scripts/wire-design.mjs --app <app>` (or `--dry-run` first) writes the
   override block + optional font/`defaultTheme` swap. `preset: constructive` ⇒ no-op.
7. **Thread the dials into the layout** (§8) when scaffolding the CRUD body (DENSITY → `data-density`,
   mandatory states, MOTION gated).
8. **Verify in the browser, light AND dark** — the standing Chrome-QA rule. The restyle must render, and
   contrast must hold, across every flow the app was built with.

> **The genericity contract holds end to end.** Nothing here hard-codes a domain → palette. The agent
> *reasons* (words → dials → adapted preset → `design.md`); the engine *enforces* (invariants + WCAG +
> override-surface-only). Presets are anchors, the compiler is the judge.
