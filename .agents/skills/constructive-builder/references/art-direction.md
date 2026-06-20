# Art Direction — AUTHOR the frontend from the design.md (the authoring playbook)

> **What this is.** The methodology a **build agent** reads to take a generated app from a
> *working skeleton* to a **finished, distinctive frontend** — authored faithfully from the app's
> [design.md](./design-system.md). The scaffolder ([scaffold-frontend.mjs](../scripts/scaffold-frontend.mjs))
> emits the **functional skeleton**: the data wiring, the testids, the four states, row-scoping, the
> RLS scoping, and the Blocks mounts — correct and working, so the app FUNCTIONS and composes with
> Blocks. **It is NOT the finished UI.** The default look (neutral shadcn surfaces) is a *replaceable
> starting point*. This doc is how you **author the presentation** on top of it.
>
> **The model:** the `design.md` is the FULL design spec; you AUTHOR the whole frontend from it.
> [design-system.md](./design-system.md) governs the *theme* (the compiled token values); **this** doc
> governs the *authoring* — the hand-written React + JSX + CSS that turns the skeleton into a product
> with a point of view. **Taste comes from AUTHORING** (customizing real components, type, spacing,
> layout, ornament), not from swapping tokens under a generic template.
>
> **There are exactly TWO hard rails — everything else is the design.md's call:**
> 1. **RAIL 1 — the FUNCTIONAL contract** ([§2](#2-rail-1--the-functional-contract-preserve--exactly)):
>    testids, selectors, row-scoping, the hooks/selection/refetch/Stack-pushes, the RLS scoping consts,
>    flow surfaces, provider order/auth bridge, the static gates. Keeps the app WORKING + composable.
> 2. **RAIL 2 — the SHADCN-TOKEN contract** ([§3](#3-rail-2--the-shadcn-token-contract-so-blocks-render)):
>    the shadcn token NAMES stay defined and the Tailwind-v4 wiring stays intact, so Blocks RENDER.
>
> Style, type, layout, composition, ornament, custom CSS — all yours, AUTHORED from the design.md.
> **This is GUIDELINES, not templates** — no app/entity literals, patterns only. **Default =
> auto-propose** a `design.md` (theme + structure) on every build and AUTHOR from it; the chosen
> direction is **recorded** in the app's `design.md` so re-runs and day-2 turns stay consistent
> ([§7](#7-record-the-direction-in-designmd)). A brief can constrain or pin it.

---

## 1. The two-layer model

Every generated surface is two layers stacked. One is **authored**; one is **load-bearing**.

| Layer | What it is | Latitude |
|---|---|---|
| **PRESENTATION** | the shell frame, the page **composition**, the type, the spacing rhythm, the surfaces/depth, the ornament, the motion, the copy | **AUTHORED** from the `design.md` — this whole doc is about doing it with taste |
| **FUNCTIONAL CONTRACT (Rail 1)** | the testids, selector conventions, row-scoping, the data hooks + selection + refetch + Stack-pushes, the RLS scoping consts, the route/block/flow surfaces, the provider order + auth bridge, the static gates | **PRESERVE** — authoring must keep every item in §2 satisfiable, or live-QA / a gate goes red |
| **TOKEN CONTRACT (Rail 2)** | the shadcn token *names* + the Tailwind-v4 wiring | **PRESERVE the names + wiring** ([§3](#3-rail-2--the-shadcn-token-contract-so-blocks-render)); restyle their *values* freely |

Think of it as: **you may restyle, recompose, retype, and re-ornament any element; you may not remove,
rename, or hide a contract element, nor break the wiring that makes the app function or Blocks render.**

---

## 2. RAIL 1 — the FUNCTIONAL CONTRACT (preserve — EXACTLY)

This is the safety net. Before you ship an authored frontend, walk this checklist and confirm each item
is still satisfiable. (Every clause is verified against the real generator/driver/gates — it is accurate.)

1. **Entity testids** (the entity-derived prefix = the **kebab singular** of the route entity, via the
   shared `scripts/lib/inflect.mjs` — identical on both the page emitter and the QA driver by construction):
   - `authed-shell` (the protected-shell sentinel — on every CRUD/stub page root);
   - `<entity>-title-input` · `<entity>-create-submit` · `<entity>-details`;
   - `<entity>-row` — and the row container must **contain the row's title text**;
   - `<entity>-edit` · `<entity>-delete`;
   - `<entity>-loading`;
   - `<entity>-error` — `role="alert"`, and its testid **must NOT end in `-empty`** (the empty-state detector
     reserves that suffix);
   - `<entity>-retry`;
   - `<entities>-empty` — the **kebab PLURAL** of the entity + `-empty`.
2. **Selector conventions** (load-bearing — the driver greps these shapes, never text/CSS/class/DOM):
   - empty-state detected via `[data-testid$="-empty"]`;
   - FK picker found via `select[data-testid$="-select"]`;
   - social buttons via `[data-testid^="social-btn-"]`.
3. **Row-scoping.** The edit/delete affordances for a row must live **inside** the `<entity>-row` container
   (or share an ancestor that scopes to **exactly one** affordance of each per row). The driver finds a row,
   then finds its edit/delete *within that row* — a global "Edit" button outside any row breaks scoping.
4. **Interactability.** Any control the QA drives must be genuinely **visible + sized** when its surface is
   mounted — no `display:none` / `visibility:hidden` / `opacity:0` / 0×0. Collapsing a contract control
   behind an accordion / un-opened tab / off-screen drawer **fails loudly**. (Restyle freely; don't hide.)
5. **DynamicFormCard (FIXED testids — do not re-derive per entity):** `record-create` · `record-delete` ·
   `record-delete-confirm`. The footer button and the field inputs must share an ancestor subtree, and the
   **first editable text input** is treated as the title field. This card is the reused edit/detailed-create/
   delete surface — don't fork it per page.
6. **Data / SDK wiring** (the entity page's machinery — keep it intact when you re-compose the JSX):
   - the typed hooks `use__Entities__Query` + `use__Create_Entity__Mutation` from `@sdk/app`;
   - `selection.fields` is **MANDATORY** (codegen `HookStrictSelect` — an empty selection fails to type);
   - the create's `onSuccess` calls `refetch`;
   - rows are read via the `data.__entities__.nodes` accessor;
   - the **three `useCardStack` pushes** — `openEdit` / `openDetailedCreate` / `openDelete`, each pushing
     `DynamicFormCard` with the right `tableName` / `recordId` / `onSuccess`;
   - the `LIST_WHERE` soft-delete filter (when the table has `features: [soft-delete]`).
   - **Required-FK child page** (enforced by `check-frontend-scaffold`): all THREE of — the camelCase FK key
     spread into the create `mutate`, the **parent list-hook import**, and the `<entity>-<parent>-select`
     picker testid.
7. **RLS scoping per POLICY intent** (from `scripts/lib/scaffold-frontend/scoping.mjs` — the create must
   send the scope its policy requires, or it 200s with 0 rows / NOT-NULL-rejects). Preserve the **const + its
   import + the spread key** in BOTH the quick-add `mutate` AND the detailed-create `defaultValues`, plus the
   submit guards:
   - **owner** → `ownerId` (the admin-token `userId` via `TokenManager`);
   - **org-membership** → `entityId: activeOrgId` (`useActiveOrg()`) **+ the `|| !activeOrgId` submit guard**;
   - **member-owner** → BOTH (`ownerId` + `activeOrgId`, both guards);
   - **temporal** (`restrict: [temporal]`) → `validFrom: new Date().toISOString()`.
   Dropping any of these → a rejected create. (These consts are generator-emitted; if you re-compose the
   return block, you move them — you don't delete them.)
8. **Flows: route PATHS + mounted BLOCKS + the `build/<app>/flow-surfaces.json` manifest + the shell
   sentinels must persist** (enforced by `check-flow-surfaces`'s 4 assertions: no orphan manifest path;
   mounted ⇒ manifested; driver routeFor keys ⊆ manifest; org URL shape; driver mount-sentinel ⊆ the
   manifested surface). Specifics that the gate pins:
   - `/account` is **ONE aggregated page** — `data-testid="account-page"` wraps the sections;
   - org admin routes are `/org/[orgId]/<sub>` (shell `data-testid="org-<sub>-page"`); `/org` and `/org/new`
     are the only non-bracket siblings; the `organization` flow surface is **`/org/new`** (the `OrgCreateCard`),
     **NOT** settings;
   - auth pages (`/sign-in`, `/sign-up`) render **OUTSIDE** the shell (guest-only).
   You may restyle these pages and their wrappers — keep the **path + block + sentinel**.
9. **Providers + ORDER** (`app/layout.tsx`): `AppProvider` → `BlocksProviders` (BlocksRuntime
   `namespaces=['auth','admin']`) → `StepUpProvider` (only when a `use-step-up` flow is present) →
   `{children}`. For org apps, `OrgProvider` + `OrgSwitcher` nest **INSIDE** `RouteGuard` wrapping
   `AuthenticatedShell`. Keep `RouteGuard`, the **two-store auth bridge** (`TokenManager.setToken('admin', …)`
   + `useAuthActions().setAuthenticated` → `router.push(AUTHED_REDIRECT)`), and the `@/generated/{auth,admin}`
   tsconfig aliases. Re-order the *visual* shell as you like; do **not** re-order the providers.
10. **Static gates that must stay green** (authoring must not red any of these): `check-frontend-scaffold`
    (the required-FK emission), `check-flow-surfaces` (the 4 mounter↔driver assertions), `check-scaffold`
    (the backend blueprint), `check-sdk` (import-presence), `assertNoUnsubstituted` (no leftover `__TOKEN__`),
    plus the **50 design unit tests** and the **design rot-canary**.

---

## 3. RAIL 2 — the SHADCN-TOKEN CONTRACT (so Blocks render)

Blocks (the auth/account/org ingredients) are styled with shadcn token *utilities* — `bg-primary`,
`text-muted-foreground`, `border-border`, `bg-card`, and so on. They resolve those utilities through the
app's `globals.css`. **So you may restyle anything, add any tokens/fonts/`@layer` CSS, and re-theme the
components freely — but the shadcn token NAMES must stay DEFINED and the Tailwind-v4 wiring must stay
intact, or installed Blocks render unstyled/broken.**

- **Keep these token NAMES defined in BOTH `:root` and `.dark`** (their *values* are the design.md's call):
  `--background --foreground · --card --card-foreground · --popover --popover-foreground ·
  --primary --primary-foreground · --secondary --secondary-foreground · --muted --muted-foreground ·
  --accent --accent-foreground · --destructive --destructive-foreground · --border --input --ring ·
  --radius · --chart-1..5 · --sidebar (+ its 7 sub-tokens) · --info/-foreground --success/-foreground
  --warning/-foreground` (the status-tint group the boilerplate maps in `@theme inline`).
- **Keep the Tailwind-v4 wiring:** `@import 'tailwindcss'`; the `@theme inline { --color-*: var(--*) }`
  block (the map that makes `bg-primary` resolve to `var(--primary)`); `@custom-variant dark`; and at least
  one `@source`. After the Blocks on-ramp (S5), also keep `@source ".../@constructive-io/ui/dist"` and
  `@import '@constructive-io/ui/globals.css'` (the block utilities + brand base).
- The theme is compiled into a **single marked override block** in `globals.css` by `wire-design.mjs`
  (S6.5) from the app's `design.md`. That is your token sink: declare custom tokens/fonts/extra props in
  the `design.md` and they flow through. You may also hand-add `@layer` component CSS around it.

The compiler is **faithful + advisory** ([design-system.md](./design-system.md)): it emits what the
`design.md` says (no clamps), synthesizes any shadcn name you leave unspecified (so this rail holds), and
**warns** (never fails) on low contrast / >1 accent / AI-purple. Treat those warnings as a craft nudge —
**you** own whether to act. Verify Rail 2 with `node scripts/check-design.mjs --globals <app>/…/globals.css`
(it HARD-fails only on a dropped name / broken wiring; the taste findings are advisory).

---

## 4. THE AUTHORING PLAYBOOK — taste-skill applied to apps

The skeleton gives you a *working* app. Your job now is to make it a *designed* app — one that could not be
mistaken for a stock dashboard. These are the taste-skill principles (`/interface-design`, `/frontend-design`)
applied to a Constructive CRUD app, **as JUDGMENT, not as clamps**. Nothing here is enforced; everything here
is what separates a real product from a template.

> **The core stance:** *there are no structural decisions — everything is design.* Typography, navigation,
> surfaces, spacing, the empty state — the parts that feel like "infrastructure that just needs to work" are
> exactly where defaults win. The moment you stop asking *"why this?"* is the moment the app goes generic.

### 4.1 Start from intent (derived from the design.md)

The `design.md` is your brief. Before authoring a surface, you should be able to say, in the design.md's own
terms: **who** the user is, **what** they must accomplish (the verb), and **how it should feel** (a specific
quality — "calm like a reading app", "dense like a trading floor" — never "clean and modern"). If the
design.md pins these, follow them exactly; if it leaves an axis free, spend that freedom on a choice that fits
*this* product's world, not on a default. Every authored choice should trace back to the design.md.

### 4.2 Never ship stock shadcn — customize the ingredients

Taste-skill's first rule: **a component in its default state is not a design.** The skeleton uses stock
`Button` / `Input` / `Card` as placeholders. Author them: tune the control tokens (control background/border/
focus), the radius scale (sharp = technical, round = friendly — pick one and commit), the surface elevation,
and the density. Blocks are the same — **ingredients**, not the final look: restyle them via Rail-2 tokens so
the auth/account/org surfaces read as one product with the domain UI, not a bolt-on widget kit.

### 4.3 Distinctive type — from the design.md

Typography *is* the design, not a container for it. Use the `design.md`'s fonts, scale, and weights — pair a
display face used with restraint against a readable body face (and a utility/mono face for data when the app
shows numbers). Build distinct levels distinguishable at a glance via **size + weight + tracking together**,
not size alone. If you're reaching for the default sans at the default weights everywhere, you haven't typeset
the app. (Swap the `next/font` loader + `defaultTheme` per the design.md — that wiring is `wire-design.mjs`'s,
S6.5; the *usage* — which weight leads a heading, how labels read — is yours.)

### 4.4 Intentional layout, hierarchy, spacing, ornament

- **Layout / composition.** The skeleton ships a card + a divided list as a neutral default. Author the
  composition the design.md implies — a dense data-table, a card gallery, a master/detail split, an editorial
  single column, a status board. The archetype palette in [§6](#6-the-archetype-palette-one-way-to-author-the-layout)
  is a menu of starting points; adapt, don't skin. **No interface should look the same** — same sidebar width +
  same 3-equal-card grid + same metric boxes every time reads as AI-generated instantly.
- **Hierarchy.** Real hierarchy is **weight + color + space**, not just size. Build four text levels (primary
  / secondary / tertiary / muted) and use all four; if you're using two, the hierarchy is too flat.
- **Spacing rhythm.** Pick a base unit and stick to multiples (the DENSITY dial seeds a tier — see §5). A
  consistent rhythm is the clearest sign of a system; random values are the clearest sign of none. Keep padding
  symmetrical unless content demands otherwise.
- **Surfaces / depth — subtle layering is the backbone of craft.** Surfaces stack in whisper-quiet lightness
  steps (a few % each); you feel the hierarchy, you don't see it. **Pick ONE depth strategy** (borders-only /
  subtle shadows / layered shadows / surface-tint) and commit — don't mix. Sidebars share the canvas background
  with a subtle border (don't fragment into "sidebar world" + "content world"); inputs read slightly inset.
- **Ornament encodes meaning, never decorates.** Numbered markers (01/02/03), eyebrows, dividers, rules,
  badges — use them only when the content *is* a sequence / *has* that structure. If the ornament could be
  removed with no loss of meaning, remove it.

### 4.5 Motion — subtle, and reduced-motion-honored

App motion is fast micro-interactions with smooth deceleration easing; larger transitions slightly longer.
Avoid spring/bounce in a professional app. An orchestrated moment beats scattered effects — and *less is more*:
extra animation is a top tell of AI-generated UI. **Always honor `prefers-reduced-motion`** (the boilerplate
stills `data-slot="skeleton"` / `content-fade-in` pulses under it — keep that contract when you restyle, and
gate any motion you add behind the same media query).

### 4.6 Anti-slop bans (JUDGMENT, not clamps)

The compiler will *warn*, never block. **You** hold the line:

- **No AI-purple-by-default.** A violet/indigo primary applied regardless of subject is the #1 tell. Earn your
  hue from the product's world (`allow_brand_hue` silences the warning when violet is genuinely the brand).
- **≤ 1 accent (by judgment).** Gray builds structure; one accent, used with intention, communicates
  (status / action / emphasis). Multiple accents dilute focus. Keep the same hue across surfaces — shift
  *lightness*, not *hue*, between them.
- **No pure black / pure white slabs.** Pure `#000`/`#fff` surfaces read cheap; use the design.md's near-tones.
  No pure-white cards on a colored background.
- **Real hierarchy, not size-only.** (See §4.4.)
- **No generic 3-equal-card row, no metric-box-with-icon-left grid** as a reflex — compose for the actual
  content. Avoid harsh borders (if a border is the first thing you see, it's too strong), dramatic surface
  jumps, decorative gradients, and dramatic drop shadows.
- **Avoid the three AI-default looks** (cream + serif + terracotta; near-black + one acid accent;
  broadsheet hairline-rules) *unless the design.md asks for one* — then follow it exactly.

### 4.7 Copy is design material

The four states and every label are copy you author. Write from the user's side of the screen: name things by
what people control, not by how the system is built. Active voice, sentence case, no filler; a control says
exactly what it does ("Save changes", not "Submit"), and the verb stays consistent through the flow. Treat the
**empty state as an invitation to act** and the **error state as direction** ("what went wrong + how to fix",
in the interface's voice — errors don't apologize and are never vague). Copy never sells cosmetics —
function + opinionation + stack-fit only.

### 4.8 Spend boldness in one place — the signature

Name the **one** element this app is remembered by — a signature that could only exist for *this* product
(a distinctive list row, a particular masthead, a domain-specific empty state). Let it be the memorable thing;
keep everything around it quiet and disciplined. Then, Chanel's rule: before you ship, *remove one accessory* —
cut the decoration that doesn't serve the design.

---

## 5. Dials → density + structure

The same three dials that drive the theme ([design-system.md §2](./design-system.md)) also bias **density**
and **structure**. Bias to **apps** (dashboards, CRUD tools, internal SaaS), not Awwwards landing pages —
theatrics must be earned by the brief.

| Dial | Low (1–3) | Mid (5–6) | High (8–10) |
|---|---|---|---|
| **VARIANCE** (structural boldness) | predictable: a sidebar + a grid/list, conventional placement | some asymmetry / an editorial bent / a split pane | bold / unconventional shell, strong asymmetry — *earn it* |
| **DENSITY** (information density) | airy: editorial single-column, cards/dividers, generous rhythm | the cozy default | compact: data-table, persistent chrome, tight spacing |
| **MOTION** (transition intensity) | none/instant | subtle | lively — **keep subtle for apps; always honor `prefers-reduced-motion`** |

DENSITY *also* drives the emit-time spacing tier (`comfortable` / `cozy` / `compact`) the generator bakes into
the skeleton — see [design-system.md §8](./design-system.md). It is a *starting* rhythm; author the rest of the
spacing scale around it. VARIANCE picks the **archetype** in §6.

---

## 6. The archetype palette (one way to author the layout)

A menu of SHELL × COMPOSITION starting points to author the layout the dials + the `design.md` prose imply.
These are **anchors, not skins** — adapt them (§4.4: no interface should look the same). NO code; "when it
fits" + "which files to touch" only. (The shell files named here live in the **scaffolded app**, not in this
skill — see [§8](#8-the-edit-seams).)

### Shells

| Shell | When it fits | Touch |
|---|---|---|
| **sidebar** (icon/labeled rail + top bar) | the default for multi-route apps; navigation breadth matters | `app-shell.tsx` (keep the arrangement, restyle the rail), `icon-sidebar.tsx`, `sidebar-config.ts` |
| **top-nav** (horizontal nav, no rail) | few routes; a wide content canvas; a marketing-adjacent feel | `app-shell.tsx` (drop the rail — see the `hideSidebar` seam in §8), `top-bar.tsx`, `authenticated-shell.tsx` |
| **minimal** (no chrome, content only) | single-surface tools, focus apps, "no chrome" briefs (brutalist) | `app-shell.tsx` via the existing **`hideSidebar`** prop — the built-in off-ramp |
| **editorial-wide** (centered column, prominent masthead) | content-first / publishing apps; low VARIANCE + low DENSITY | `app-shell.tsx` + the page **width clamp** (§8); a lighter `top-bar.tsx` |
| **dense-dashboard** (persistent chrome, tight rail, compact bar) | data-heavy / monitoring / admin; high DENSITY | `app-shell.tsx`, `app-shell.types.ts` (`SIDEBAR_*_WIDTH`), `icon-sidebar.tsx` |

### Page compositions (the entity surface's `return(...)`)

| Composition | When it fits | Touch |
|---|---|---|
| **list** (divided rows in one bordered surface) | the default; short rows, a title + 1–2 affordances | the entity-page `return(...)` (§8) — this is the shipped shape |
| **data-table** (columnar, header row, dense) | many columns; high DENSITY; scanning/sorting matters | the entity-page `return(...)` — keep `<entity>-row` on each table row; keep edit/delete in the row |
| **gallery** (card grid) | image/preview-led entities; medium VARIANCE | the entity-page `return(...)` — each card is the `<entity>-row` (with its title text + row-scoped affordances) |
| **split-pane** (list ⟷ detail master/detail) | drill-down workflows; the detail reuses the Stack | the entity-page `return(...)` — list items stay `<entity>-row`; detail opens via the existing Stack pushes |
| **editorial** (single wide column, generous) | content-first; low DENSITY; an editorial `design.md` | the entity-page `return(...)` + the width clamp (§8) |
| **board** (Kanban columns) | status/stage-driven entities; medium-high VARIANCE | the entity-page `return(...)` — each card is the `<entity>-row`; the create + Stack pushes are unchanged |

> Whichever composition you author, the contract is identical: the `<entity>-row` is whatever element
> *repeats per record* (a `<li>`, a table `<tr>`, a card, a board card), it carries the row's **title text**,
> and its **edit/delete** affordances are **inside** it ([§2.1](#2-rail-1--the-functional-contract-preserve--exactly), §2.3).

---

## 7. Record the direction in design.md

Authoring must **express the agreed `design.md`** — the prose Overview, the dials, and the tokens — and the
*structural* choice must be **recorded** so re-runs and day-2 turns reproduce it (a re-emit must not silently
revert to the stock list-on-sidebar). Record it in an explicit **`art_direction`** block in the app's
`design.md` frontmatter (see [design-system.md](./design-system.md) for the block's shape):

- `shell:` one of the §6 shells (`sidebar` | `top-nav` | `minimal` | `editorial-wide` | `dense-dashboard`)
- `composition:` one of the §6 compositions (`list` | `data-table` | `gallery` | `split-pane` | `editorial` |
  `board`) — the **default per-entity** composition
- `density:` (mirrors the DENSITY dial → spacing tier; the same single-source-of-truth resolution as the
  theme — `brief.design.dials.density` first, then the `design.md`)
- `notes:` free-text describing the intent + the signature (so a later turn understands *why* this direction)

A brief can pin these via the optional `design.art_direction` block ([brief-grammar.md](./brief-grammar.md));
absent that, **auto-propose** them from the dials + prose and write them into the emitted `design.md`. The
emitted pages are **emit-once / idempotent** ([§8](#8-the-edit-seams)), so the recorded direction is the
durable record a re-run reads — keep page edits and the `art_direction` block in sync.

---

## 8. The edit seams

Four seams carry the authoring. Edit each *within* the contract.

> **Two ways to author** (the pages are **emit-once / idempotent** — the emitter `skip()`s an existing page):
> either **edit the template before emit** (`scripts/templates/frontend/entity-page.tsx`, which restyles
> *every* CRUD page the run emits — author it once, generically), **OR** edit the **emitted**
> `src/app/<entity>/page.tsx` afterward (to author one surface). The shell/layout/nav/branding files below are
> emitted **once** by the template repo, so you edit them in the **scaffolded app**.

| Seam | Where | How to keep the contract |
|---|---|---|
| **Shell frame + `hideSidebar`** | `src/components/app-shell/app-shell.tsx` — the ONE place `TopBar` + `IconSidebar` + `main` are arranged. Supporting: `icon-sidebar.tsx`, `top-bar.tsx`, `app-shell.types.ts` (`SIDEBAR_*_WIDTH`), `authenticated-shell.tsx` (builds `topBarConfig`), `layout.tsx` (provider nesting + fonts + `defaultTheme`), `lib/navigation/sidebar-config.ts` (nav DATA), `config/branding.ts` (name/tagline/logo) | Re-arrange / drop the rail / go minimal freely. A built-in **`hideSidebar`** prop is the minimal off-ramp. **Keep the provider order + the auth bridge** (§2.9). If you restructure the shell, **mirror it in `shell-skeleton.tsx`** so the loading skeleton matches. The `authed-shell` sentinel stays. |
| **Entity page `return(...)`** — the **PRESENTATION SEAM** | the single `return(...)` JSX block in `scripts/templates/frontend/entity-page.tsx` (and the emitted pages), marked `PRESENTATION SEAM — AUTHOR THE UI FROM HERE`. The shipped shape (card + divided list) is a neutral default — **author it wholesale** to your composition (§6) | **Move, don't remove.** Keep all §2.1 testids, the row's title text + row-scoped edit/delete (§2.3), the four states (loading/empty/error/data — re-authored, not deleted), the data hooks + `selection.fields` + `refetch` + the three Stack pushes + the scoping const(s) (§2.6, §2.7). The seam comment enumerates exactly what is Rail-1 vs free. |
| **Width clamp** | the `mx-auto max-w-2xl __D_PAGE__` class on the page root (entity + stub pages) | The width/rhythm knob: widen for full-width/dashboard/data-table, keep centered for editorial. Purely a class change — touches no testid or wiring. |
| **Sidebar nav + branding** | `lib/navigation/sidebar-config.ts` (nav items), `config/branding.ts` (name / tagline / logo) | Nav is **DATA** — re-order / re-group / re-icon freely; the routes themselves come from the brief. Branding is free text/marks. Neither carries a contract testid. |

> **Stub pages + flow wrappers** are likewise yours to author around their mounted blocks: `emitStubPage` (the
> `dashboard`/`detail`/`custom` stub, also marked `PRESENTATION SEAM — AUTHOR THE UI FROM HERE`), and the
> flow-page wrappers `flows/account-page.tsx` (`account-page` sentinel), `flows/org-page.tsx`
> (`org-<sub>-page` sentinel), `auth-page.tsx` (guest-only, outside the shell). Each carries an "AUTHOR THE
> PRESENTATION" note. Author them; keep their **path + block + sentinel** (§2.8), and treat the blocks as
> ingredients you restyle (Rail 2), not finished UI.

---

## 9. Safety rails + self-verify

**Rails (do these while authoring):**
- Author the PRESENTATION; never touch a **testid**, a **scoping const**, a **hook/selection/refetch/
  Stack-push**, or a **provider order** as part of a *visual* change. If a change seems to require removing one
  of those, you've crossed into Rail 1 — stop and re-compose around it instead.
- Never break a **shadcn token name** or the **`@theme inline` / `@source` / `@custom-variant` wiring**
  (Rail 2) — restyle values, add tokens, but keep the names + wiring so Blocks render.
- Don't introduce a `__TOKEN__`-shaped placeholder into an emitted page (`assertNoUnsubstituted` rejects any
  un-substituted `__UPPER__`/`__lower__` outside comments).
- Keep contract controls **interactable** (§2.4) — restyle, don't hide.
- Honor `prefers-reduced-motion` for any motion you add (§4.5).

**Self-verify (after authoring — before calling it done):**
1. **Re-run the structural gates:** `node scripts/check-flow-surfaces.mjs` and
   `node scripts/check-frontend-scaffold.mjs` (both also run inside `pnpm check:scaffold`). Green = the
   mounter↔driver contract + the required-FK emission survived your authoring.
2. **Verify Rail 2:** `node scripts/check-design.mjs --globals <app>/src/app/globals.css` — HARD-fails only on
   a dropped shadcn name / broken wiring (the taste findings are **advisory** — read them, decide).
3. **Re-run live-QA** (`verify-phase.sh 3` with the brief's `acceptance.required_flows`) — the real Chrome
   round-trip proves the testids are present, interactable, and wired through your authored composition.
4. **Grep your emitted pages** for the entity contract: the `<entity>-*` / `<entities>-empty` testids (derive
   `<entity>` = kebab-singular from the brief, never hard-code it) and the policy scoping const(s) (`ownerId`
   / `activeOrgId` / `validFrom`) in the create path. Each must still be present in the authored output.
5. **Taste self-check** (the taste-skill mandate — *before* you call it done, look at what you made and ask
   "if they said this lacks craft, what would they mean?", then fix that first):
   - **Swap test** — if you swapped your typeface/layout/palette for the most common defaults, would the app
     feel meaningfully different? Where swapping wouldn't matter, you defaulted — author there.
   - **Squint test** — blur your eyes (eyeball light **and** dark): hierarchy still readable, nothing harsh
     jumps out? Craft whispers.
   - **Signature test** — can you point to the **one** signature element (§4.8) in actual components, not "the
     overall feel"?
   - **Token test** — read the design.md's tokens: do they sound like *this* product's world, or like any
     project (`--gray-700` vs a named, world-derived token)?
   - **Sameness test** — would another agent, given this design.md, produce substantially the same screen? If
     yes, it's generic — author deeper.

> **The contract holds end to end.** You authored the presentation; the gates verified the functional layer
> (Rail 1) and the token contract (Rail 2) are intact; the taste self-check caught the defaults. "Green" here
> means **verified across the stack** *and* **authored with craft**, not a green build alone.

---

## 10. Where this came from

`references/benchmark-findings.md` (SG-8) flagged "no per-kind UI templates (board/calendar/gallery/detail) …
*fix later*". The pivot **is** that fix — not as a fixed set of page-kind templates (which would over-fit
specific kinds and fight the genericity principle), but as **authoring**: the scaffolder emits ONE generic,
working skeleton and the agent AUTHORS the presentation per the `design.md`, within the two rails above. Keep
it **generic** — no app/entity literals, patterns only. The taste comes from authoring, not from token-swapping
a template.
