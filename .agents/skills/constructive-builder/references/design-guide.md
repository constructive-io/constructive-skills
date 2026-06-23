# Design Guide — AUTHOR the frontend from the design.md

You are the designer. The `design.md` is the **full design spec**; you **hand-author the entire
frontend from it** — the shell, every page's composition, the type, the spacing, the surfaces, the
ornament, the copy, and the `globals.css`. **There is no compiler.** Nothing styles the app for you:
you write the CSS yourself and the tokens you put there are the tokens the app ships. Blocks (the
auth / account / org ingredients) compose *into* that frontend — treat them as ingredients you
restyle through the token names, not as finished UI.

This guide is the single source for *how* to author with craft. It is **guidelines, not templates** —
roles and archetypes only, never app/entity literals. Two hard rails (below) are the entire envelope;
inside them, every visual choice is yours.

---

## 1. Intent first — and a named signature

Before you author a surface, you must be able to say, in the design.md's own words:

- **Who** the user is, **what** they must accomplish (the verb), and **how it should feel** — a
  *specific* quality ("calm like a reading room", "dense like a control desk"), never "clean and
  modern".
- The **one signature element** this product is remembered by — a thing that could only exist for
  *this* app (a distinctive row, a particular masthead, a domain-shaped empty state). Spend your
  boldness here; keep everything around it quiet.

If the design.md pins these, follow them exactly. If it leaves an axis free, spend that freedom on a
choice that fits *this* product's world. **If you can't name who / what / feel / signature, ask —
do not default.** A default unasked is the moment the app goes generic.

---

## 2. The two hard rails (everything else is your call)

Only two things are enforced. Inside them, style / type / layout / composition / ornament / custom
CSS are entirely yours.

### RAIL 1 — the FUNCTIONAL contract (the app must still work + pass testid-only QA)

QA drives the app by **testid and role only** — never by text, CSS, class, or DOM shape — so any
restyle or restructure you do is *invisible* to it, **as long as every contract element below stays
present and interactable**. You may **move** any of these; you may not remove, rename, or hide one.

- Every **`<entity>-*` testid** (derived kebab-singular from the route entity): the `authed-shell`
  sentinel; `*-title-input`, `*-create-submit`, `*-details`, `*-row` (the row container holds the
  row's **title text**), `*-edit`, `*-delete`, `*-loading`, `*-error` (`role="alert"`, suffix is
  **not** `-empty`), `*-retry`; and `<entities>-empty` (the kebab **plural** + `-empty`).
- The **selector conventions**: empty via `[data-testid$="-empty"]`, FK picker via
  `select[data-testid$="-select"]`, social buttons via `[data-testid^="social-btn-"]`. The
  `DynamicFormCard` fixed testids (`record-create` / `record-delete` / `record-delete-confirm`).
- **Row-scoping + interactability**: each row's edit/delete live *inside* that row; every driven
  control is genuinely visible + sized when mounted (no `display:none` / `opacity:0` / 0×0, no hiding
  behind an un-opened tab or drawer).
- The **SDK wiring**: the typed list + create **hooks**, a non-empty **`selection.fields`**, the
  create's `onSuccess` → **`refetch`**, the `data.__entities__.nodes` accessor, and the three
  **`useCardStack` pushes** (edit / detailed-create / delete).
- The **RLS scoping const(s)** the policy requires — the const + its import + the spread key in BOTH
  the quick-add `mutate` AND the detailed-create defaults (one per policy tier; drop it and the create
  200s with 0 rows or NOT-NULL-rejects).
- The **flows**: each flow's route **path** + mounted **block** + the `flow-surfaces.json` manifest +
  the **shell sentinels** persist (account is one aggregated page; org admin under `/org/[orgId]/…`;
  auth pages render outside the shell).
- The **provider order** + the **two-store auth bridge** in the layout (do not re-order the
  providers, even while you re-order the visual shell).
- The **static gates** stay green.

Selectors being testid/role-only is *why* your restyle/restructure is safe. Author the presentation;
never touch a testid, a scoping const, a hook/selection/refetch/push, or the provider order as part
of a *visual* change — if a change seems to need that, you've crossed into Rail 1; re-compose around
it instead.

### RAIL 2 — the TOKEN contract (the built globals.css must let Blocks render)

Blocks resolve shadcn utilities (`bg-primary`, `text-muted-foreground`, `border-border`, …) through
your `globals.css`. So the file you author **must** define the shadcn token NAMES in **both `:root`
and `.dark`**, with the Tailwind-v4 wiring intact. Their *values* are entirely your call.

The names that must be defined:

```
background foreground · card card-foreground · popover popover-foreground ·
primary primary-foreground · secondary secondary-foreground · muted muted-foreground ·
accent accent-foreground · destructive destructive-foreground · border input ring ·
chart-1 chart-2 chart-3 chart-4 chart-5 ·
sidebar sidebar-foreground sidebar-primary sidebar-primary-foreground
sidebar-accent sidebar-accent-foreground sidebar-border sidebar-ring ·
info info-foreground · success success-foreground · warning warning-foreground · radius
```

The wiring that must stay intact: `@import 'tailwindcss';` · a **non-empty** `@theme inline` mapping
`--color-*: var(--*)` (this is what makes `bg-primary` resolve to `var(--primary)`) ·
`@custom-variant dark;` · **at least one `@source`**.

This is the **only** machine check that survives, run as:

```
node scripts/check-design.mjs --app <app>
```

It hard-fails on a dropped/renamed name or broken wiring, and nothing else. Everything beyond these
names + wiring is free — add your own custom properties, fonts, and hand-written `@layer` component
CSS around the required block.

---

## 3. Craft foundations

These are mid-altitude principles — the difference between a real product and a template. Apply them
as judgment.

- **Subtle layering + surface elevation.** Surfaces stack in *whisper-quiet* lightness steps (a few %
  each); you feel the hierarchy, you don't see it. The sidebar shares the canvas hue (don't fragment
  into "sidebar world" + "content world"); inputs read slightly **inset**. **Pick ONE depth
  strategy** — borders-only / subtle shadow / layered shadow / surface-tint — and commit; mixing
  reads as noise.
- **Border progression.** Borders are **low-opacity** — findable, not loud. If a border is the first
  thing your eye lands on, it's too strong.
- **Color lives somewhere.** Draw the palette from the **product's world**, not a stock ramp. Gray
  builds the structure; **one accent**, used with intent, carries meaning (action / status /
  emphasis). Keep that accent one hue across surfaces — shift *lightness*, not *hue*. No pure
  black / pure white slabs.
- **Typography is the design, not a container for it.** Build distinct levels readable at a glance via
  **size + weight + tracking together**, not size alone — four text roles (primary / secondary /
  tertiary / muted), and use all four. **Ban the generic sans as the headline face**: never reach for
  Inter, Roboto, Open Sans, Lato, or system-ui as your display type. Pick **one distinctive face
  decisively** and commit. Bring a **mono** face for the data / numeric / technical layer.
- **States are part of the design.** Every entity surface ships a **loading** skeleton that *matches
  the real layout* (not a spinner), an **empty** state (a clear invitation + the primary create
  action), and an **error** state (what went wrong + how to fix, in the interface's voice — never
  vague, never apologetic). Plus real **hover / focus / disabled** treatments. Restyle these; never
  delete them.
- **Radius is a scale, and a signal.** Sharp corners read technical; round read friendly. Choose one
  scale and use it consistently.
- **Dark mode leans on borders.** In dark, depth comes from borders + small lightness steps more than
  shadow. Verify the look in **both** modes — they are not the same design twice.

---

## 4. The dials (light hints)

Three optional 1–10 hints bias the work. Keep them light — a feel, not a system.

| Dial | 1 → 10 | Biases |
|---|---|---|
| **variance** | flat / predictable → bold / unconventional | accent strength, type contrast, **structural boldness** |
| **motion** | none / instant → lively | transition length + hover/enter (always reduced-motion-gated; keep subtle for apps) |
| **density** | airy → compact | padding / gap / row-height — and it **seeds the scaffold skeleton's spacing tier** |

Words → dials, briefly: *calm, trustworthy, admin* → 3–4 / 2–3 / 4–5 · *clean, focused, minimal* →
5–6 / 3–4 / 2–3 · *refined, editorial, premium* → 7–8 / 5–7 / 3–4 · *fun, energetic, consumer* →
9–10 / 8–10 / 3–4 · *raw, utilitarian* → 4–6 / 1–2 / 2–6. These are **applications**, so bias toward
the calm rows; theatrics are *earned* by the brief. Record `density` in the design.md so the scaffold
picks the matching spacing tier.

---

## 5. Structure — restructure, don't just recolor

You may rearrange the **shell** and the page **composition**, not merely tint a fixed layout —
rearranging is safe precisely because QA is testid/role-only (Rail 1). Same sidebar + same three-equal
cards + same metric boxes on every build reads as machine-made instantly; vary it.

A compact archetype palette to author *toward* (adapt, don't skin):

- **Shells:** `sidebar` (rail + top bar — the multi-route default) · `top-nav` (horizontal, wide
  canvas) · `minimal` (no chrome, single surface) · `editorial-wide` (centered measure, prominent
  masthead) · `dense-dashboard` (persistent tight chrome).
- **Compositions** (the per-entity `return(...)`): `list` (divided rows) · `data-table` (columnar,
  dense) · `gallery` (card grid) · `split-pane` (master/detail) · `editorial` (single wide column) ·
  `board` (status columns).

Whatever composition you pick, the contract is identical: the **`<entity>-row`** is whatever element
*repeats per record* (a list item, a table row, a card, a board card), it carries the row's **title
text**, and its **edit/delete** affordances live **inside** it.

The **edit seams** that carry all of this: the **app-shell frame** (the one place the nav + top bar +
main are arranged — restyle or drop the rail; a `hideSidebar` off-ramp exists; mirror any restructure
in the loading skeleton), each entity page's **`return(...)` block** (the presentation seam — author
it wholesale to your composition; *move, don't remove* the contract elements), and the page **max-w
clamp** (widen for dashboards/tables, keep centered for editorial — a pure class change).

**Record the chosen direction** (shell / composition / density / why) in the design.md, so re-runs and
day-2 turns reproduce it instead of reverting to the default.

---

## 6. Self-check before you show it

Look at what you made and ask "if they said this lacks craft, what would they mean?" — then fix that
first. Four quick tests:

- **Swap test** — if you swapped your typeface / layout / palette for the most common defaults, would
  the app feel meaningfully different? Where swapping wouldn't matter, you defaulted — author there.
- **Squint test** — blur your eyes (in **both** light and dark): is the hierarchy still readable, with
  nothing harsh jumping out? Craft whispers.
- **Signature test** — can you point to the **one** signature element in actual components, not "the
  overall feel"?
- **Token test** — read your token values: do they sound like *this* product's world, or like any
  project (a named, world-derived value vs a generic `--gray-700`)?

Then run `node scripts/check-design.mjs --app <app>` (Rail 2) and re-run the structural gates + live
QA (Rail 1). "Green" means **verified across the stack**, light and dark — not a passing build alone.

---

## 7. Examples (start here, then adapt)

`references/examples/` holds worked exemplars — each a complete, opinionated design.md in a named
aesthetic category, so you can see the foundations above made concrete:

- **Graphite** — precision; restrained, engineered, exacting.
- **Prism** — colorful but **structured**; energy held in a disciplined system.
- **Eclipse** — a dark-first product surface.
- **Folio** — editorial; a print-feel reading layout.
- **Solaris** — warm and soft; gentle, premium.
- **Concrete** — brutalist; raw, square, monospace structure.
- **constructive.md** — the **opt-out baseline** (today's stock look).

How to use them:

- **Absent design block** ⇒ **auto-propose a rich one** — read the intent, name the atmosphere + the
  dials + a signature, and author a full design.md. The quality of the design.md is the quality
  ceiling of the app; never ship a thin token set or stock shadcn.
- **`design: { preset: <alias> }`** ⇒ start from that exemplar and **adapt** it to this product —
  never ship it as a fixed skin.
- **`design: { preset: constructive }`** ⇒ keep today's look (the opt-out).

---

**One last nudge:** don't let these examples (or your last build) become a *new* default. Vary the
shell, the type, and the palette across builds — the genericity tell is sameness, and the cure is a
choice made on purpose every time.
