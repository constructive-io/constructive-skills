# Design System — authoring a rich `design.md` (the FULL design spec)

> **What this is.** The methodology a **build agent** reads to give a generated app a *distinctive,
> coherent, intentional* look. Under the pivot, the **`design.md` is the FULL design spec** and the agent
> **AUTHORS the whole frontend faithfully from it** — customizing real shadcn components, choosing
> distinctive type, composing intentional layout/spacing/ornament/custom CSS — with **Blocks as
> ingredients**. The deterministic compiler (`scripts/wire-design.mjs` / `compile.mjs`) is a **faithful,
> advisory HELPER**: it maps the `design.md` palette into the app's `globals.css` token block so Blocks
> render, synthesizes anything you leave unspecified, and *warns* (never clamps) on taste/contrast. It is
> NOT the source of the look — **you are**, via authoring.
>
> **The taste comes from AUTHORING, not from token-swapping.** taste-skill's first rule — *never ship
> shadcn in its default state* — applies to apps too. A coherent palette alone is the floor, not the
> ceiling. The `design.md` carries the **whole art direction** (atmosphere, palette-with-intent, a real
> type system, spacing rhythm, component treatments, motion, ornament, banned patterns, and a prose
> Overview) so the authored frontend is opinionated and consistent. The **authoring playbook** — how to
> exercise that on the React shell + pages — lives in **[art-direction.md](./art-direction.md)**.

> **This is GUIDELINES, not a lookup table.** There is deliberately **no** "domain → palette" map (that
> would violate the genericity principle). You *reason* from words → atmosphere/dials → a palette + type +
> rhythm, and **author**; the compiler *helps* (synthesize + warn), it does not decide the look. Presets
> (§4) are rich anchors you adapt, never constraints.

---

## 0. The two hard rails (everything else is the design.md's call)

Only **two** things are enforced. Inside them, **style, type, layout, composition, ornament, and custom
CSS are entirely the `design.md`'s call, authored by the agent** — there is **no style enforcement**.

| Rail | What it guarantees | Where it's defined |
|---|---|---|
| **RAIL 1 — FUNCTIONAL CONTRACT** | the app *works* + composes with Blocks via testid-only QA: the `<entity>-*` testids, selector conventions, row-scoping, SDK hooks/selection/refetch/Stack-pushes, RLS scoping consts, flow surfaces, provider order/auth bridge, the static gates | **[art-direction.md §2](./art-direction.md)** (enumerated + verified) — **UNCHANGED** |
| **RAIL 2 — SHADCN-TOKEN CONTRACT** | Blocks *render*: the shadcn token NAMES stay DEFINED in `:root` + `.dark`, and the Tailwind-v4 wiring (`@import 'tailwindcss'`, `@theme inline`, `@source`, `@custom-variant dark`) stays intact | **§6** below + `check-design.mjs --globals` |

> **No clamps.** Contrast and the anti-slop rules (AI-purple, ≤1 accent, pure-black, chroma cap) are now
> **ADVISORY warnings** — the linter surfaces them, the compiler emits the authored value verbatim, and
> nothing fails or gets silently "repaired." You author *within* good taste because it's good taste, not
> because a gate forces you. (`--strict` re-escalates them to errors for anyone who wants the old behavior;
> the default is advisory.)

---

## 1. When the design step runs (and when it's a no-op)

- **Default (the `design:` block is ABSENT):** **auto-propose a RICH `design.md`** on every build — the
  quality of the `design.md` is the quality ceiling of the app, so the default is opinionated, not a thin
  token set. Read the intent (`app.label` / `app.description` / entity names / an optional `design.brief`),
  classify it into **atmosphere + dials**, pick/adapt a **preset** (§4), and author a full `design.md`
  (§5): palette-with-intent, a **type system** (pairing + scale + weights), **spacing rhythm**, **component
  treatments**, **motion**, **ornament**, **banned patterns**, an **`art_direction`** structural block, and
  a **prose Overview** that states the look in words. Then lint it (advisory) + compile it (faithful). A
  generated app should never ship the stock blue unless asked — and never ship a token-swapped generic
  template either. **AUTHOR from the design.md.**
- **Opt-out (`design: { preset: constructive }`):** **keep today's look exactly.** `wire-design` is a
  **no-op** — the boilerplate `globals.css` is left untouched and **no authoring happens**. Use this when
  the brief explicitly wants the stock theme, or a downstream consumer pins the default.
- **Compile failure (a genuine parse/structural problem):** **no-op + loud warning**, never a half-written
  theme. The stock look survives; fix the `design.md` and re-run. (Under the relax this is rare — the
  clamps that used to throw are gone; the compiler emits what you wrote.)

The step is wired into the build at **S6.5** (after the Blocks `@import` at S5, before the domain CRUD
body at S7) — see [speedrun.md](./speedrun.md). It is idempotent and `--dry-run`-able.

---

## 2. Atmosphere + the three dials

Start from **atmosphere** — a one-line mood the look should evoke ("a well-set magazine page that happens
to be an app"; "engineered and exacting, not friendly"). Record it as `atmosphere:` in the frontmatter and
expand it in the prose Overview. Then reduce it to three integer **dials**, **1–10**, the bridge from words
to a concrete spec.

| Dial | 1 ………………… 10 | Drives |
|---|---|---|
| **VARIANCE** | flat / monochrome / predictable → bold / high-contrast / unconventional | palette chroma + accent strength, surface↔foreground ΔL, border visibility, **type contrast** (weight/size/face) — **AND structural boldness** (the shell + page composition the agent hand-authors; see [art-direction.md](./art-direction.md)) |
| **MOTION** | none / instant → lively / springy | transition durations, hover/enter animation (always `prefers-reduced-motion`-gated) |
| **DENSITY** | airy / generous whitespace → compact / data-dense | padding, gap, row height, the spacing rhythm + font-size step on entity pages |

> **Bias for apps.** This builder makes **applications** (dashboards, CRUD tools, internal SaaS), not
> Awwwards landing pages. Bias every classification toward the **trust-first / minimalist** rows below.
> Theatrics (high VARIANCE + high MOTION) must be *earned* by the brief, not the default.

### words → atmosphere → dials → preset

Classify the natural-language style words into a row. The preset is a **rich anchor** you then adapt.

| If the words say… | dials (VARIANCE / MOTION / DENSITY) | preset anchor |
|---|---|---|
| calm, trustworthy, neutral, "just works", admin, finance, healthcare, enterprise | **3–4 / 2–3 / 4–5** | `trust-first` (→ adapt `minimalist`) |
| clean, simple, focused, minimal, content-first, quiet | **5–6 / 3–4 / 2–3** | `minimalist` |
| refined, high-end, editorial, premium, elegant, "print feel", luxe | **7–8 / 5–7 / 3–4** | `premium` (→ `editorial` / `soft`) |
| fun, friendly, energetic, playful, consumer, vibrant, bold | **9–10 / 8–10 / 3–4** | `playful` |
| raw, stark, utilitarian, brutalist, monospace, "no chrome" | **4–6 / 1–2 / 2–6** | `brutalist` |

> **Unsure?** Default to **trust-first** (adapt `minimalist`: 3–4 / 2–3 / 4–5) — the safe, legible app
> baseline. A boring app that works beats a beautiful one that fails; but "boring that works" still means
> *authored* (customized components, real hierarchy), not stock shadcn.

Each dial threads into the layout pass (DENSITY → spacing literals baked into the generated entity pages at
emit time; VARIANCE → the structural archetype) — see §8 + [art-direction.md](./art-direction.md).

> **Single source of truth for the dials:** `brief.design.dials` (specifically `dials.density`).
> `scaffold-frontend` reads density from `brief.design.dials.density`; if absent there it falls back to the
> emitted `design.md` frontmatter's `dials.density` (§8). The `design.md` carries the *palette / type /
> rhythm / ornament* spec; `dials` carries the *layout* dials. Record the dials in the brief by preference —
> the design.md fallback exists so an auto-propose agent that recorded them in the emitted design.md still
> threads density correctly.

---

## 3. Color taste — now ADVISORY (warnings, not clamps)

These are the taste guardrails. Under the pivot the linter (`invariants.mjs` / `check-design.mjs`) reports
them as **warnings/info** and the compiler emits the authored value **verbatim** — **nothing fails or gets
clamped**. Author within them because they make for legible, non-generic UI; treat a warning as a prompt to
double-check intent, not a build break. (The **one** structural error that remains is `missing-primary` — a
theme with no primary has nothing to map.)

| Rule | Severity (default) | Why |
|---|---|---|
| **`primary` required** | **error** (structural) | a theme with no primary has nothing to map/synthesize |
| **≤ 1 accent** | warn | a second accent reads as noise; one accent + neutrals is the disciplined look |
| **saturation / chroma < ~80%** (OKLCH `c` capped) | warn | screaming-saturated tokens fatigue and clash with shadcn neutrals |
| **no pure black** (min lightness `L ≥ ~0.18`) | warn | pure `#000` text/surfaces look harsh; near-black reads as intentional |
| **ban the "AI purple/blue" band** for `primary`/`accent` | warn | hue ≈ **255–310** with `c > ~0.12` is the generic-AI tell; pick a hue with intent. Silence intentionally with `allow_brand_hue: true` |
| **one gray temperature** | (authoring) | derive neutrals from ONE hue so grays don't fight (warm vs cool) |
| **dimension units px / em / rem only** | warn | unitless or exotic units don't compile cleanly into spacing/radius |
| **contrast pairs** (fg/bg, primary/primary-fg, muted-fg/bg, destructive, status tints) | **warn / info** (advisory) | legibility floor; the compiler **synthesizes** sensible foregrounds for tokens you omit, but an **authored** low-contrast pair now emits verbatim with a warning — your call |
| **success/warning `*-foreground` tint contract** | warn / info | text-on-tint must flip per mode (§6 gotcha) — when you author a tint without a foreground the compiler derives a contrast-correct one |

> **Contrast is measured, not assumed — but no longer enforced.** WCAG ratios are computed (relative
> luminance over OKLCH→sRGB). A low-contrast **authored** pair is surfaced as a warning and emitted as
> written (faithful). For tokens you leave **unspecified**, the compiler synthesizes a contrast-aware value
> (so Rail 2 names exist and read well by default). If you want the old hard-fail behavior, run
> `check-design.mjs --strict`. Default = advisory.

---

## 4. The preset catalog (RICH anchors — names + when to use)

Each preset is a complete, **rich** `design.md` in `fixtures/design/<name>.md`: a full art direction
(atmosphere, palette-with-intent, a real type system, spacing rhythm, component treatments, motion,
ornament, banned patterns, a prose Overview), not a thin token set. They double as worked examples of the
§5 format. **Pick the closest, then adapt** — never treat a preset as a fixed skin.

| Preset | Dials (V/M/D) | The art direction (one line) | Reach for it when |
|---|---|---|---|
| **`constructive`** | (= stock) | the current Constructive blue, light-first — **authors nothing** | **the opt-out** — `design: { preset: constructive }` keeps today's look (no-op) |
| **`minimalist`** | 5 / 3 / 3 | near-monochrome; one restrained slate-blue; hierarchy from weight + space, not color; hairlines over boxes | content-first apps, internal tools, "clean & simple", the trust-first default-when-in-doubt |
| **`editorial`** | 7 / 4 / 4 | warm print feel; a **serif masthead over a sans body**; terracotta ink accent; `68ch` measure; rules + whitespace | publishing, knowledge bases, long-form, "editorial / high-end print" |
| **`soft`** | 7 / 6 / 4 | premium SaaS; muted-lavender accent; **soft rounded cards lifted by diffuse shadow**; gentle springy motion | polished consumer SaaS, onboarding/billing/account, "premium / elegant / soft" |
| **`brutalist`** | 4 / 2 / 2 | raw utility; near-black ink; **square corners + hard gridlines + monospace structure**; chroma reserved for status only | developer tools, dense back-office grids, monitoring, "raw / no chrome" |
| **`playful`** | 9 / 8 / 4 | energetic; **vivid cyan-teal with dark-ink labels**; large friendly radii; bouncy (gated) motion | consumer / community / education, "fun & energetic", onboarding-heavy |

> **`trust-first` and `minimalist`.** The "safe app baseline" is an **adaptation of `minimalist`** (lower
> VARIANCE/MOTION, slightly higher DENSITY) — there is no separate `trust-first.md` file on disk; treat it
> as `minimalist` dialed calmer. (Preset *names* accepted by the brief validator still include `trust-first`
> for forward-compat; it resolves to the `minimalist` anchor adapted.)

> Presets are **starting points**. A "calm fintech with a deep-green brand" = `minimalist`/trust-first
> anchor + `colors.primary` set to that green + the green threaded through the prose + a slightly denser
> rhythm. You are not limited to the six art directions.

---

## 5. The rich `design.md` format

A `design.md` is **Markdown with a YAML frontmatter** (Google Labs `design.md` open standard; we conform to
the format, we do **not** depend on its CLI). The frontmatter is parsed by the skill's existing zero-dep
YAML reader — **no new dependency** — and it now carries the **whole art direction**, not just colors. It is
emitted into the app (e.g. `packages/app/design.md`) as the durable design record + day-2 input + the
authoring brief the agent works from.

> **What the compiler reads vs. what the agent reads.** The compiler (`compile.mjs`) consumes only
> `colors`, `radius`/`rounded`, `typography.{sans,mono}` (font family resolution), and `dark` (it maps
> these into the `globals.css` token block + font-loader swap). **Every other key is authoring guidance the
> AGENT reads** to author the frontend (`type` scale/weights/pairing, `spacing` rhythm, `components`,
> `motion`, `ornament`, `banned`, `atmosphere`, `art_direction`). These extra keys **pass through the parser
> untouched and are inert to the compiler** (they do not affect the emitted tokens) — they exist to make the
> authored UI opinionated and consistent. Custom tokens you *do* want emitted go in a `tokens:`/`extra:` map
> (§5.4), which the faithful compiler passes through into the override block.

### 5.1 Frontmatter schema

| Key | Required | Shape | Consumed by | Notes |
|---|---|---|---|---|
| `version` | optional | int | — | document version (e.g. `1`) |
| `name` | **required** | string | both | a short theme name (e.g. `"calm-fintech"`) |
| `description` | optional | string | — | one-line intent |
| `atmosphere` | optional | string | agent | the one-line mood the look evokes (expanded in the prose Overview) |
| `dials` | optional | map | scaffold | `{ variance, motion, density }` (each 1–10). **Canonical home is `brief.design.dials`**; this is the fallback `scaffold-frontend` reads for DENSITY (§8) |
| `colors` | **required** | map | **compiler** | the palette **roles** (§5.2). `primary` required |
| `typography` | optional | map | **compiler** | `{ sans, mono, serif? }` font *family names* (sans/mono resolved against the allowlist §7; serif is authoring guidance) |
| `type` | optional | map | agent | the **type system** the agent authors to: `{ sans, serif?, mono, scale, weights, leading, tracking, pairing }` (§5.3a) |
| `rounded` | optional | map or scalar | **compiler** | `{ sm, md, lg }` or a single radius; `md` (or the scalar) seeds `--radius` |
| `radius` | optional | string | **compiler** | seeds `--radius` directly (px/em/rem); wins over `rounded.md` |
| `spacing` | optional | map | agent (+ lint) | base scale + **rhythm** the agent authors to (§5.3b). px/em/rem values only (the dimension-unit lint reads these) |
| `components` | optional | map | agent | per-component **treatment** notes (button/input/card/table/badge/…) — the authored component direction (§5.3c) |
| `motion` | optional | map | agent | `{ duration, easing, hover, enter, reduced }` — the motion direction (§5.3d). Always reduced-motion-gated |
| `ornament` | optional | map | agent | `{ borders, dividers, shadows, texture, accents }` — the ornament budget (§5.3e) |
| `banned` | optional | list | agent | the **banned patterns** for this look — the anti-slop list, expressed positively-as-prohibitions (§5.3f) |
| `art_direction` | optional | map | agent | `{ shell, composition, density, notes }` — the recorded **structural** direction. Auto-proposed; the durable record a re-run reads. Shape in §5.5; rules in [art-direction.md](./art-direction.md) |
| `tokens` / `extra` | optional | map | **compiler** | custom CSS custom-properties (and font vars) to **pass through verbatim** into the emitted override block (§5.4) — the faithful compiler emits these alongside the synthesized shadcn names |
| `dark` | optional | map | **compiler** | explicit dark-mode overrides — **escape hatch** when OKLCH auto-derivation (§6) isn't pretty enough |
| `default_mode` | optional | `light` \| `dark` | **compiler** | which theme loads first (→ `layout.tsx` `ThemeProvider defaultTheme`) |
| `allow_brand_hue` | optional | bool | lint | silence the AI-purple-band warning for a *deliberate* brand hue |

**`colors` roles** (semantic, NOT shadcn var names — the compiler maps roles → vars in §6):

| Role | Meaning | Required |
|---|---|---|
| `primary` | the one brand/action color | **yes** |
| `accent` | at most ONE secondary highlight | no (≤1) |
| `neutral` | the gray family (ONE temperature) — drives secondary/muted/border | recommended |
| `surface` | page/card background base | recommended |
| `on-surface` | default text/foreground over surface | recommended |
| `error` | destructive / danger | no (falls back to a sane red) |
| `success` / `warning` / `info` (+ `*-foreground`) | status tints | no (synthesized + flip per mode, §6) |

Colors may be `oklch(L C H)`, `#rrggbb`, or `rgb(…)` — the engine parses all three and normalizes to OKLCH.

### 5.2 A short (thin) example — the floor

```markdown
---
version: 1
name: calm-fintech
description: trustworthy, low-chroma, dense and legible — a finance admin
atmosphere: "calm and exact; the data is the ornament"
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

A trust-first admin theme. One green action color, a single cool gray ramp, generous-but-dense spacing.
```

This compiles + renders — but it's the **floor**, not the ceiling. The compiler synthesizes the missing
tokens; it does **not** make the frontend opinionated. To hit the ceiling, author the **rich** form (§5.3)
so the agent has a type system, rhythm, component treatments, motion, ornament, and banned patterns to
author *to*. **Every shipped preset in `fixtures/design/*.md` is a worked rich example — read one.**

### 5.3 The rich blocks (what makes the design.md the FULL spec)

These optional blocks are **authoring guidance** (inert to the compiler) that turn a token set into a full
art direction. Auto-propose fills them in by default.

#### 5.3a `type` — the type system

```yaml
type:
  sans: "IBM Plex Sans"
  serif: "a transitional serif for the masthead (agent adds a 2nd next/font loader → --font-display)"
  mono: "IBM Plex Mono"
  scale:   { base: "1.0625rem", ratio: "1.333" }   # px/em/rem base + a modular ratio (ratio is unitless — keep it OUT of `spacing`)
  leading: { body: "1.65", heading: "1.15" }
  weights: { body: 400, medium: 500, heading: 600, display: 700 }
  tracking:{ display: "-0.02em", label: "0.04em" }
  measure: "68ch"   # the body line-length clamp; a CH unit lives under `type` (NOT `spacing`) so the px/em/rem dimension-unit lint doesn't flag it
  pairing: "Serif display over sans body — the serif/sans contrast IS the signal; don't flatten to one face."
```

The compiler resolves only `typography.sans` / `typography.mono` (the font-loader swap, §7); a `serif`
heading face is an **authoring move** (the agent adds a second `next/font` loader). The `scale` / `weights`
/ `leading` / `tracking` / `pairing` are how the agent sets **real hierarchy via weight + size + face**
(taste-skill) instead of stock shadcn defaults.

#### 5.3b `spacing` — the rhythm

```yaml
spacing:
  base: "1.05rem"
  rhythm: ["0.375rem", "0.625rem", "1rem", "1.5rem", "2.25rem", "3.5rem"]   # the spacing scale the agent composes to
  section_gap: "3.5rem"
```

Values under `spacing` are **px/em/rem** (the `dimension-units` lint reads `spacing.*`, `rounded.*`,
`radius` and warns on anything else). Put a `ch`-unit body **measure** under `type` (§5.3a), not here. The
**emit-time** DENSITY tier (§8) is still resolved from `dials.density`; `spacing.rhythm` is the *authored*
rhythm the agent applies when composing pages (it does not replace the density tier — it informs it).

#### 5.3c `components` — per-component treatments

```yaml
components:
  button: "Solid primary for THE action only; everything else ghost/text; 1px focus ring, no shadow."
  input:  "Hairline border, no inner shadow; uppercase tracked label."
  card:   "Prefer border-t to a boxed card; reserve a real card for one distinct unit."
  table:  "Hairline row dividers, small-caps muted header; no zebra striping."
  badge:  "Flat tinted pill, no border; status color carries meaning."
```

The authored direction for the stock shadcn components the agent **customizes** (never ships default). These
are prose hints, not a compile surface.

#### 5.3d `motion`

```yaml
motion: { duration: "200ms", easing: "cubic-bezier(0.2,0,0,1)", hover: "underline/rule reveal", enter: "8px rise + fade", reduced: true }
```

Subtle + **always `prefers-reduced-motion`-gated** (`reduced: true` is a reminder, not a toggle). High
MOTION is earned by the brief.

#### 5.3e `ornament`

```yaml
ornament: { borders: "hairline at --border", dividers: "preferred over boxes", shadows: "none in light", texture: "faint paper tint", accents: "the one accent + focus ring" }
```

The ornament budget — borders/dividers/shadows/texture and where the single accent is spent.

#### 5.3f `banned` — the anti-slop list for this look

```yaml
banned:
  - "color used for hierarchy where weight/size would do"
  - "more than one accent hue"
  - "drop shadows / gradients / glassmorphism"
  - "three equal-weight cards in a row"
  - "zebra-striped tables"
```

The per-look anti-slop prohibitions (a superset of the global anti-slop bans in
[art-direction.md](./art-direction.md)). They keep the authored frontend from drifting back to generic.

### 5.4 `tokens` / `extra` — custom properties that PASS THROUGH

The faithful compiler lets the design.md declare **custom CSS custom-properties** that are emitted
**verbatim** into the override block alongside the synthesized shadcn names (the old allowlist-as-a-cap is
gone):

```yaml
tokens:
  --elevation-1: "0 1px 2px oklch(0 0 0 / 0.06)"   # bare --key, quoted value
  --brand-gradient: "linear-gradient(90deg, var(--primary), var(--accent))"
  --ring-offset: "2px"
```

> The `--var` **key is bare** (unquoted) and the **value is a quoted string** — the zero-dep YAML reader
> keeps quotes on a quoted key, so quoting the key would mis-parse it. Bare key + quoted value is the form
> that round-trips cleanly.

Use this for app-specific tokens your authored CSS references. They flow through into `:root`/`.dark`
verbatim; they do **not** override the shadcn names (those are still synthesized/derived so Rail 2 holds).
A `dark.tokens:` / `dark.extra:` map applies in dark mode only.

> **Structural-wiring names are refused (the one pass-through limit).** The compiler **drops** (with a
> warning) any custom token whose name matches `--color-*` / `--font-*` / `--z-layer*` / `--tw-*` —
> emitting one inside the override block would corrupt the Tailwind/overlay wiring (§6.3). So do **not**
> put a `--font-display` (or any `--font-*`) in `tokens:` — a **font/serif face is swapped via the
> `layout.tsx` loader**, not via a token (gotcha #1); your authored heading CSS references the
> `--font-display` variable the loader binds, which the token block never needs to carry. Everything else
> (elevation, gradients, custom ornament props, offsets) passes through.

### 5.5 The `art_direction` block (the recorded STRUCTURAL direction)

Optional, GUIDANCE-level, additive. While `colors`/`type`/`dials` carry the *theme + type*, `art_direction`
records the *structure* the agent restructured the app to — so a re-run / day-2 turn reproduces the same
shell + composition instead of silently reverting to the stock list-on-sidebar. **No compile step consumes
it**; it is the durable record the rules in [art-direction.md](./art-direction.md) read.

```markdown
art_direction:
  shell: editorial-wide    # sidebar | top-nav | minimal | editorial-wide | dense-dashboard
  composition: editorial   # list | data-table | gallery | split-pane | editorial | board (default per entity)
  density: comfortable     # comfortable | cozy | compact — mirrors the DENSITY dial / spacing tier
  notes: "content-forward; centered measure, prominent masthead"   # single-line; why this shell/composition
```

Every key optional. **Default = auto-propose** the shell/composition/density from the dials + the prose
Overview and write them here; a brief can pin them via `design.art_direction`
([brief-grammar.md](./brief-grammar.md)). The `density` here mirrors the DENSITY dial — the single source of
truth for the emit-time spacing tier is still `brief.design.dials.density`, then the `design.md` (§2 + §8);
`art_direction.density` is the human-readable echo. See [art-direction.md](./art-direction.md) for the
shell/composition archetypes, the edit seams, and the preserve-contract checklist.

---

## 6. The compile / override contract (what `compileDesign` emits — faithfully)

`compileDesign(design, { defaultMode })` returns `{ light, dark, radius, fonts, warnings }`;
`renderOverrideBlock({light,dark})` emits a **single marked block** appended to the app's `globals.css`. It
is a **faithful helper**: a design.md value emits **verbatim**; anything you omit is **synthesized** so the
Rail-2 names exist; custom `tokens`/`extra` **pass through**; nothing is clamped.

### 6.1 Role → shadcn var map (light; dark is derived). An authored value WINS over the synthesis.

| shadcn var | derived from (when you omit it) — an authored value emits verbatim |
|---|---|
| `background` | `surface` |
| `foreground` | `on-surface` |
| `card` / `popover` (+ `-foreground`) | `surface` (+ a small ΔL elevation) / `on-surface` |
| `primary` | `colors.primary`; `primary-foreground` synthesized contrast-aware (or your authored value verbatim) |
| `secondary` (+ `-foreground`) | a neutral-muted surface / `on-surface` |
| `muted` / `muted-foreground` | neutral subtle / toward `on-surface` |
| `accent` (+ `-foreground`) | `colors.accent` ‖ a quiet neutral tint / contrast |
| `destructive` (+ `-foreground`) | `colors.error` / contrast |
| `border` / `input` | `surface` shifted ΔL toward `on-surface` (input slightly stronger) |
| `ring` | `primary` |
| `chart-1..5` | `primary` hue rotations `[0, +40, -40, +90, -90]` |
| `sidebar*` | derived from `surface` / `neutral` + `primary` |
| `info`/`success`/`warning` (+ `-foreground`) | synthesized tints that **flip** per mode (§6.5) — or your authored values verbatim |
| `radius` | `design.radius` ‖ `rounded.md` ‖ `0.5rem` |

> **Synthesis is a HELPER you can override.** For any var above, an explicit `design.md` value (a `colors`
> role, an authored `*-foreground`, a `tokens` entry) is emitted as written. Synthesis only fills the gaps —
> its job is to keep **Rail 2** satisfied (every shadcn name defined) and read sensibly by default, not to
> overrule you.

### 6.2 The Rail-2 names that MUST stay defined (so Blocks render)

The override block emits the shadcn token NAMES in both `:root` and `.dark`. These NAMES are **Rail 2** — they
must be present (values are yours):

```
background, foreground, card, card-foreground, popover, popover-foreground,
primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground,
accent, accent-foreground, destructive, destructive-foreground, border, input, ring,
chart-1 … chart-5,
sidebar, sidebar-foreground, sidebar-primary, sidebar-primary-foreground,
sidebar-accent, sidebar-accent-foreground, sidebar-border, sidebar-ring,
info, info-foreground, success, success-foreground, warning, warning-foreground, radius
```

Plus any **custom** `tokens`/`extra` you declared (§5.4), emitted verbatim. The block is delimited by
**exact sentinels** (byte-identical across the engine + the codemod — never change these strings):

```css
/* >>> constructive-builder design overrides (generated) */
:root { /* …shadcn names + your custom tokens… */ }
.dark { /* …same… */ }
/* <<< constructive-builder design overrides */
```

It is placed **after** the `.dark` block and **before** `@theme inline {` so it wins by source order (and
over the Blocks `@import` above it). Re-running locates the sentinels and **replaces in place**
(idempotent); `--dry-run` reports the diff without writing.

> **Validate Rail 2 on the app's css** with `node scripts/check-design.mjs --globals <app/globals.css>`: it
> HARD-asserts the shadcn names survive in `:root` + `.dark` and the Tailwind-v4 wiring (`@import
> 'tailwindcss'`, a non-empty `@theme inline`, `@custom-variant dark`, ≥1 `@source`) is intact. This is the
> only style-side hard gate — it catches an authored globals.css that dropped a name or broke the wiring,
> without constraining anything else you authored. (The on-ramp's `@source .../@constructive-io/ui/dist` +
> the UI `@import` are advisory-when-absent, since they're added at S5.)

### 6.3 STRUCTURAL — the compiler never emits these (and you shouldn't put them in `tokens`)

`@theme inline`, `@source`, `@custom-variant dark`, `@plugin`, the **second** z-layer `:root` block
(`--z-layer-*`), `@layer base`, `@layer utilities`, the `[data-slot=…]` skeleton/portal rules, `--shadow-*`,
and the `--radius-*` derivations inside `@theme inline`. These are Tailwind/overlay **wiring** (Rail 2),
authored once in the boilerplate — the token compiler leaves them alone, and a `tokens:` map should not
redeclare them. (This is a constraint on the **CSS token compiler**, NOT on the agent's hand-authored React
**shell + page composition + custom `@layer` component CSS you add by hand** — that latitude is governed by
[art-direction.md](./art-direction.md). Re-arranging the shell or adding a hand-written component `@layer` in
the app is fully allowed; making the *token compiler* emit `@theme inline` is not.)

### 6.4 Dark-mode derivation

When `design.dark` is **absent**, `.dark` is derived from light by **OKLCH lightness inversion** (keep hue +
chroma, clamp into range) with foregrounds **synthesized** for contrast. When `design.dark` is present, it
**wins** (the escape hatch). `default_mode` sets which loads first via `layout.tsx`'s `ThemeProvider
defaultTheme` (boilerplate default is `dark`). An authored dark value emits verbatim (no clamp); a derived
dark foreground is synthesized sensibly (advisory if it can't reach AA).

### 6.5 The three gotchas (each one is a real footgun)

1. **Fonts change ONLY via the `layout.tsx` loader swap — never via a `:root --font-*` value.** The
   boilerplate's `:root { --font-sans: … }` is **dead** (shadowed by `@theme inline --font-sans:
   var(--font-geist-sans)`). To change the typeface, the font codemod swaps the `next/font/google` loader
   import in `layout.tsx` **while keeping the variable NAMES** `--font-geist-sans` / `--font-geist-mono` (and
   the `<body>` className tokens). A **serif** (e.g. editorial's masthead) is an *additional* loader the
   agent adds, bound to a new `--font-display` var (declare it in `tokens:` if your CSS references it). See §7.
2. **`success`/`warning`/`info` `*-foreground` are text-on-tint — they FLIP per mode.** dark-on-light tint in
   **light**, light-on-dark tint in **dark**. A naive `white` foreground fails on a light-mode amber/emerald
   tint. The compiler's synthesis honors the flip; if you author a tint foreground, keep the flip yourself.
3. **Contrast is synthesized for omissions, faithful for authored values.** For a token you omit, the
   compiler picks a contrast-aware foreground. For a token you **author**, it emits your value verbatim +
   warns (advisory) if it's low — it never green-washes or clamps your choice.

---

## 7. Fonts (the `next/font/google` allowlist)

Typeface choice for the **compiled** `typography.sans` / `typography.mono` is constrained to a curated
allowlist of `next/font/google` families so the build never breaks on a missing/typo'd font. Current
allowlist — **sans:** Geist, Outfit, Sora, Manrope, Inter, Plus Jakarta Sans, IBM Plex Sans, DM Sans, Space
Grotesk, Figtree; **mono:** Geist Mono, JetBrains Mono, IBM Plex Mono, Space Mono, Fira Code, Roboto Mono.
`resolveFont(name)` returns `{ loaderName, importLine, variable }` or **falls back to Geist + a warning** for
anything off-list. (Different presets deliberately pick different allowlisted faces — that compiled-face
difference is a real part of each art direction.)

- Set the compiled typeface in `design.md` `typography.{ sans, mono }`.
- The codemod swaps **only** the loader import + the `const X = Loader({ variable: '--font-geist-sans' })`
  call in `layout.tsx`, **keeping** the variable strings `--font-geist-sans`/`--font-geist-mono` and the
  `<body>` className — so `@theme inline` keeps resolving. Never edit a `:root --font-*` value (gotcha #1).
- A **serif** (or any 3rd face) is an **authoring** add: a second `next/font` loader bound to a new
  `--font-display` (or similar) variable you reference in your authored heading styles + declare in `tokens:`.
- Off-allowlist or omitted → Geist (the boilerplate default) + a benign warning.

---

## 8. Layout & component taste (dial-driven, app-appropriate, AUTHORED)

The theme colors the app; the **dials + the rich blocks** shape how the agent **authors** its layout +
components. These are generic patterns — **no entity/app literals** ever (the page/state code is derived
from the brief's tables). The full authoring playbook (customize/replace stock shadcn, the seams, the
self-verify) is in **[art-direction.md](./art-direction.md)**; the high-value app rules:

- **Mandatory states on every generated entity/CRUD page** (Rail-1-adjacent, highest value): a **loading**
  skeleton that *matches the real layout* (not a spinner), an **empty** state (clear "nothing yet" + the
  primary create action), and an **error** state (legible message + retry). Restyle them per the design.md;
  never delete them. The boilerplate ships skeleton/`[data-slot]` primitives — reuse them.
- **DENSITY → Tailwind spacing literals baked in at emit time.** `scaffold-frontend` resolves the DENSITY
  dial to one of three tiers (`comfortable` / `cozy` / `compact`; `cozy` == the historical literals) and
  substitutes whole Tailwind class strings (padding / gap / row-height / page rhythm) into the generated
  pages. It is **emit-time** substitution (not a runtime attribute, not a `globals.css` rule), so a generated
  entity page is **emit-once / idempotent** — changing density after the first scaffold needs a re-emit. The
  DENSITY dial resolves from `brief.design.dials.density`, then the emitted `design.md`'s `dials.density`,
  then `cozy`. The authored `spacing.rhythm` (§5.3b) informs how you compose *within* the tier.
- **Hierarchy via weight + color + face, not just size.** Lead with `font-medium`/`foreground` vs
  `muted-foreground`; use the `type.weights` + `type.scale` from the design.md; reserve large sizes for true
  page titles. **This is the single biggest "not-stock-shadcn" lever.**
- **One accent.** Use the accent for the single primary action per view; everything else is neutral/border.
- **Cards only where elevation earns it.** Per the design.md `components.card` + `ornament` direction —
  some looks prefer dividers/`border-t` (minimalist, editorial), some lean on soft cards (soft, playful),
  some box with hard rules (brutalist). Author to the spec, don't default.
- **MOTION is subtle and gated.** Keep transitions per `motion.duration`/`easing`; **always** honor
  `prefers-reduced-motion` (the boilerplate's skeleton rules already do — match that discipline).
- **Honor the `banned` list.** It's the per-look anti-slop guard; re-read it before calling a page done.

---

## 9. The keep-default escape hatch (and other off-ramps)

- **Keep today's look:** `design: { preset: constructive }` → `wire-design` is a **no-op** and **no
  authoring happens**. The single most important off-ramp: a build that wants the stock theme gets it,
  untouched.
- **Dark not pretty?** Add an explicit `dark:` map to the frontmatter (§6.4) — it wins verbatim.
- **A deliberate purple/blue brand hue?** `allow_brand_hue: true` silences the AI-purple-band warning (§3) —
  use it only when that hue is genuinely the brand.
- **A custom token your CSS needs?** Declare it in `tokens:`/`extra:` (§5.4) — it passes through verbatim.
- **Off-allowlist font?** Accept the Geist fallback, pick an allowlisted family (§7), or add a serif/extra
  face as an authoring loader + a `--font-display` token.
- **Want the old hard-fail gates?** `check-design.mjs --strict` re-escalates the advisory taste findings to
  errors. The default is advisory.

---

## 10. The agent's loop (putting it together)

1. **Read the intent.** `app.label` + `app.description` + entity names + any `design.brief` words.
2. **Name the atmosphere → classify into dials** (§2). Bias to trust-first/minimalist for apps.
3. **Pick + adapt a rich preset** (§4). Set `colors.primary` (and at most one `accent`) with intent — avoid
   the AI-purple band unless it's the real brand.
4. **Author the RICH `design.md`** (§5): palette-with-intent, a type system (`type` pairing/scale/weights),
   spacing rhythm, component treatments, motion, ornament, banned patterns, `art_direction`, and a prose
   Overview. Record the dials. This is the quality ceiling — make it opinionated.
5. **Lint (advisory):** `node scripts/check-design.mjs --design <design.md>`. Weigh the warnings (they don't
   fail); fix only a genuine `missing-primary` structural error.
6. **Compile + wire (faithful):** `node scripts/wire-design.mjs --app <app>` (or `--dry-run` first) writes
   the override block + the font/`defaultTheme` swap, emitting your values verbatim + synthesizing the rest.
   `preset: constructive` ⇒ no-op.
7. **AUTHOR the frontend from the design.md** — the main event. Customize/replace stock shadcn components;
   apply the type system, rhythm, component treatments, ornament, motion; restructure the shell + page
   composition per `art_direction`. Blocks are **ingredients**. Full playbook + the preserve-contract
   checklist → [art-direction.md](./art-direction.md). **Preserve Rail 1 + Rail 2.**
8. **Thread the dials into the layout** (§8) when scaffolding the CRUD body (DENSITY → emit-time tier,
   mandatory states, MOTION gated).
9. **Verify across the stack, light AND dark** — the standing Chrome-QA rule. Validate Rail 2
   (`check-design.mjs --globals`), re-run `check-flow-surfaces` + `check-frontend-scaffold` + live-QA after a
   structural change, and eyeball the authored UI in both modes. "Green" means **verified across the stack**.

> **The genericity contract holds end to end.** Nothing here hard-codes a domain → palette → layout. The
> agent *reasons* (words → atmosphere → dials → adapted preset → a rich `design.md`) and *authors*; the
> compiler *helps* (faithful emit + synthesis + advisory warnings) and *guards* exactly two rails (the
> functional contract + the shadcn-token contract). Presets are rich anchors; taste comes from authoring.
