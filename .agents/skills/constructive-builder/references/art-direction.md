# Art Direction — restructuring the SHELL + page COMPOSITION (guidance only)

> **What this is.** The methodology a **build agent** reads to give a generated app a *structurally*
> distinctive layout — a different shell frame, a different page composition, a different rhythm — instead
> of the one stock arrangement every scaffold ships. [design-system.md](./design-system.md) governs the
> *theme* (colors / type / radius compiled into `globals.css` token values); **this** doc governs the layer
> *above* the theme: the hand-authored **React shell + JSX page composition**. The two are independent — you
> can restyle the theme, restructure the layout, or both.
>
> **This is GUIDELINES, not templates.** There are **no** worked code examples here and **no** new scaffold
> templates — the toolkit emits ONE generic page/shell shape; you *restructure it by hand* per the app's
> [design.md](./design-system.md), within the contract below. The contract is the safety net: as long as
> every item in [§2](#2-the-functional-contract-preserve--exactly) stays satisfiable, restructure freely.
>
> **Default = AUTO-PROPOSE STRUCTURE.** Like the theme, structure is auto-proposed on every build (the
> archetypes in [§5](#5-the-archetype-palette-guidance) differ *structurally*, not just chromatically). The
> chosen direction is **recorded** in the app's `design.md` `art_direction` block ([§6](#6-consistency--record-the-direction-in-designmd))
> so re-runs and day-2 turns stay consistent. A brief can constrain or pin it.

---

## 1. The two-layer model

Every generated surface is two layers stacked. One is **free**; one is **load-bearing**.

| Layer | What it is | Latitude |
|---|---|---|
| **PRESENTATIONAL** | the shell frame (how TopBar / sidebar / main are arranged), the page **composition** (list vs table vs gallery vs split vs board vs editorial), the width clamp, typography, spacing, ornamentation, copy | **FREE to vary** per the `design.md` — this whole doc is about exercising it |
| **FUNCTIONAL CONTRACT** | the testids, the selector conventions, row-scoping, the data hooks + selection + refetch + Stack-pushes, the RLS scoping consts, the route/block/flow surfaces, the provider order + auth bridge, the static gates | **PRESERVE** — a restructure must keep every item in §2 satisfiable, or live-QA / a gate goes red |

Think of it as: **you may move, restyle, or re-compose any element — you may not remove, rename, or hide a
contract element, nor break the wiring that makes it function.**

---

## 2. The FUNCTIONAL CONTRACT (preserve — EXACTLY)

This is the safety net. Before you ship a restructure, walk this checklist and confirm each item is still
satisfiable. (Every clause is verified against the real generator/driver/gates — it is accurate.)

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
10. **Static gates that must stay green** (a restructure must not red any of these): `check-frontend-scaffold`
    (the required-FK emission), `check-flow-surfaces` (the 4 mounter↔driver assertions), `check-scaffold`
    (the backend blueprint), `check-sdk` (import-presence), `assertNoUnsubstituted` (no leftover `__TOKEN__`),
    plus the **50 design unit tests** and the **design rot-canary**.

---

## 3. WHY restructuring is safe

- **Every static gate and the live-QA driver select by `data-testid` / ARIA `role` ONLY — never by text,
  CSS, class, layout, or DOM shape.** `scripts/live-qa.mjs` states it explicitly: "Selectors: data-testid /
  ARIA role ONLY — never text or CSS. Block restyles must not break this gate."
- The gates check **PRESENCE** (the testid exists), **MOUNTING** (the block's JSX tag appears on its surface),
  **manifest sync** (every mounted flow has a manifest entry whose path resolves to an emitted page that
  *provides* the driver's mount sentinel), and **SDK / RLS WIRING** (the import is present, the FK key is in
  the create) — **NOT** composition. So **shell, layout, page composition, typography, spacing, and
  ornamentation are all FREE to change**, as long as §2 stays satisfiable.
- The flip side: because the checks are presence-and-wiring, the *only* ways to break them are exactly the §2
  failure modes — **renaming/removing a testid, hiding a control, dropping a scoping const, or pointing a flow
  surface at the wrong (or no) page.** Avoid those four and a restructure cannot regress.

---

## 4. Dials → STRUCTURE

The same three dials that drive the theme ([design-system.md §2](./design-system.md)) also bias **structure**.
Bias to **apps** (dashboards, CRUD tools, internal SaaS), not Awwwards landing pages — theatrics must be
earned by the brief.

| Dial | Low (1–3) | Mid (5–6) | High (8–10) |
|---|---|---|---|
| **VARIANCE** (structural boldness) | predictable: a sidebar + a grid/list, conventional placement | some asymmetry / an editorial bent / a split pane | bold / unconventional shell, strong asymmetry — *earn it* |
| **DENSITY** (information density) | airy: editorial single-column, cards/dividers, generous rhythm | the cozy default | compact: data-table, persistent chrome, tight spacing |
| **MOTION** (transition intensity) | none/instant | subtle | lively — **keep subtle for apps; always honor `prefers-reduced-motion`** |

DENSITY *also* drives the emit-time spacing tier (`comfortable` / `cozy` / `compact`) the generator bakes into
the pages — see [design-system.md §8](./design-system.md). VARIANCE is the new structural lever this doc adds:
it picks the **archetype** in §5.

---

## 5. The archetype palette (guidance)

Pick the SHELL × COMPOSITION pairing the dials + the `design.md` prose imply. These are **anchors, not
skins** — adapt. NO code; "when it fits" + "which files to touch" only. (The shell files named here live in
the **scaffolded app**, not in this skill — see §7.)

### Shells

| Shell | When it fits | Touch |
|---|---|---|
| **sidebar** (icon/labeled rail + top bar) | the default for multi-route apps; navigation breadth matters | `app-shell.tsx` (keep the arrangement, restyle the rail), `icon-sidebar.tsx`, `sidebar-config.ts` |
| **top-nav** (horizontal nav, no rail) | few routes; a wide content canvas; a marketing-adjacent feel | `app-shell.tsx` (drop the rail — see the `hideSidebar` seam in §7), `top-bar.tsx`, `authenticated-shell.tsx` |
| **minimal** (no chrome, content only) | single-surface tools, focus apps, "no chrome" briefs (brutalist) | `app-shell.tsx` via the existing **`hideSidebar`** prop — the built-in off-ramp |
| **editorial-wide** (centered column, prominent masthead) | content-first / publishing apps; low VARIANCE + low DENSITY | `app-shell.tsx` + the page **width clamp** (§7); a lighter `top-bar.tsx` |
| **dense-dashboard** (persistent chrome, tight rail, compact bar) | data-heavy / monitoring / admin; high DENSITY | `app-shell.tsx`, `app-shell.types.ts` (`SIDEBAR_*_WIDTH`), `icon-sidebar.tsx` |

### Page compositions (the entity surface's `return(...)`)

| Composition | When it fits | Touch |
|---|---|---|
| **list** (divided rows in one bordered surface) | the default; short rows, a title + 1–2 affordances | the entity-page `return(...)` (§7) — this is the shipped shape |
| **data-table** (columnar, header row, dense) | many columns; high DENSITY; scanning/sorting matters | the entity-page `return(...)` — keep `<entity>-row` on each table row; keep edit/delete in the row |
| **gallery** (card grid) | image/preview-led entities; medium VARIANCE | the entity-page `return(...)` — each card is the `<entity>-row` (with its title text + row-scoped affordances) |
| **split-pane** (list ⟷ detail master/detail) | drill-down workflows; the detail reuses the Stack | the entity-page `return(...)` — list items stay `<entity>-row`; detail opens via the existing Stack pushes |
| **editorial** (single wide column, generous) | content-first; low DENSITY; an editorial `design.md` | the entity-page `return(...)` + the width clamp (§7) |
| **board** (Kanban columns) | status/stage-driven entities; medium-high VARIANCE | the entity-page `return(...)` — each card is the `<entity>-row`; the create + Stack pushes are unchanged |

> Whichever composition you pick, the contract is identical: the `<entity>-row` is whatever element *repeats
> per record* (a `<li>`, a table `<tr>`, a card, a board card), it carries the row's **title text**, and its
> **edit/delete** affordances are **inside** it ([§2.1](#2-the-functional-contract-preserve--exactly), §2.3).

---

## 6. Consistency — record the direction in design.md

Structure must **express the agreed `design.md`** — the prose Overview, the dials, and the tokens — and the
*structural* choice must be **recorded** so re-runs and day-2 turns reproduce it (a re-emit must not silently
revert to the stock list-on-sidebar). Record it in an explicit **`art_direction`** block in the app's
`design.md` frontmatter (see [design-system.md](./design-system.md) for the block's shape):

- `shell:` one of the §5 shells (`sidebar` | `top-nav` | `minimal` | `editorial-wide` | `dense-dashboard`)
- `composition:` one of the §5 compositions (`list` | `data-table` | `gallery` | `split-pane` | `editorial` |
  `board`) — the **default per-entity** composition
- `density:` (mirrors the DENSITY dial → spacing tier; the same single-source-of-truth resolution as the
  theme — `brief.design.dials.density` first, then the `design.md`)
- `notes:` free-text describing the intent (so a later turn understands *why* this shell/composition)

A brief can pin these via the optional `design.art_direction` block ([brief-grammar.md](./brief-grammar.md));
absent that, **auto-propose** them from the dials + prose and write them into the emitted `design.md`. The
emitted pages are **emit-once / idempotent** ([§7](#7-the-edit-seams)), so the recorded direction is the
durable record a re-run reads — keep page edits and the `art_direction` block in sync.

---

## 7. The edit seams

Four seams carry almost all the structural latitude. Edit each *within* the contract.

> **Two ways to restructure** (the pages are **emit-once / idempotent** — the emitter `skip()`s an existing
> page): either **edit the template before emit** (`scripts/templates/frontend/entity-page.tsx`, which restyles
> *every* CRUD page the run emits), **OR** edit the **emitted** `src/app/<entity>/page.tsx` afterward (to
> restructure one surface). The shell/layout/nav/branding files below are emitted **once** by the template
> repo, so you edit them in the **scaffolded app**.

| Seam | Where | How to keep the contract |
|---|---|---|
| **Shell frame + `hideSidebar`** | `src/components/app-shell/app-shell.tsx` — the ONE place `TopBar` + `IconSidebar` + `main` are arranged. Supporting: `icon-sidebar.tsx`, `top-bar.tsx`, `app-shell.types.ts` (`SIDEBAR_*_WIDTH`), `authenticated-shell.tsx` (builds `topBarConfig`), `layout.tsx` (provider nesting + fonts + `defaultTheme`), `lib/navigation/sidebar-config.ts` (nav DATA), `config/branding.ts` (name/tagline/logo) | Re-arrange / drop the rail / go minimal freely. A built-in **`hideSidebar`** prop is the minimal off-ramp. **Keep the provider order + the auth bridge** (§2.9). If you restructure the shell, **mirror it in `shell-skeleton.tsx`** so the loading skeleton matches. The `authed-shell` sentinel stays. |
| **Entity page `return(...)`** | the single `return(...)` JSX block in `scripts/templates/frontend/entity-page.tsx` (and the emitted pages). The shipped shape is a card + divided list — swap it **wholesale** to data-table / gallery / split-pane / editorial / board | **Move, don't remove.** Keep all §2.1 testids, keep the row's title text + row-scoped edit/delete (§2.3), keep the four list states (loading/empty/error/data — re-styled, not deleted), keep the data hooks + `selection.fields` + `refetch` + the three Stack pushes + the scoping const(s) (§2.6, §2.7). A SEAM marker comment already flags this block. |
| **Width clamp** | the `mx-auto max-w-2xl __D_PAGE__` class on the page root (entity + stub pages) | The width/rhythm knob: widen for full-width/dashboard/data-table, keep centered for editorial. Purely a class change — touches no testid or wiring. |
| **Sidebar nav + branding** | `lib/navigation/sidebar-config.ts` (nav items), `config/branding.ts` (name / tagline / logo) | Nav is **DATA** — re-order / re-group / re-icon freely; the routes themselves come from the brief. Branding is free text/marks. Neither carries a contract testid. |

> **Stub pages + flow wrappers** are likewise restyleable around their mounted blocks: `emitStubPage` (the
> `dashboard`/`detail`/`custom` stub, also flagged with a SEAM marker), and the flow-page wrappers
> `flows/account-page.tsx` (`account-page` sentinel), `flows/org-page.tsx` (`org-<sub>-page` sentinel),
> `auth-page.tsx` (guest-only, outside the shell). Restyle them; keep their **path + block + sentinel** (§2.8).

---

## 8. Safety rails + self-verify

**Rails (do these while restructuring):**
- Restructure the PRESENTATION; never touch a **testid**, a **scoping const**, a **hook/selection/refetch/
  Stack-push**, or a **provider order** as part of a *visual* change. If a structural change seems to require
  removing one of those, you've crossed into the contract — stop and re-compose around it instead.
- Don't introduce a `__TOKEN__`-shaped placeholder into an emitted page (`assertNoUnsubstituted` rejects any
  un-substituted `__UPPER__`/`__lower__` outside comments).
- Keep contract controls **interactable** (§2.4) — restyle, don't hide.
- Honor `prefers-reduced-motion` for any motion you add (§4).

**Self-verify (after restructuring — before calling it done):**
1. Re-run the structural gates: **`node scripts/check-flow-surfaces.mjs`** and
   **`node scripts/check-frontend-scaffold.mjs`** (both also run inside `pnpm check:scaffold`). Green = the
   mounter↔driver contract + the required-FK emission survived.
2. Re-run **live-QA** (`verify-phase.sh 3` with the brief's `acceptance.required_flows`) — the real Chrome
   round-trip proves the testids are present, interactable, and wired through your new composition.
3. **Grep your emitted pages** for the entity contract: the `<entity>-*` / `<entities>-empty` testids (derive
   `<entity>` = kebab-singular from the brief, never hard-code it) and the policy scoping const(s) (`ownerId`
   / `activeOrgId` / `validFrom`) in the create path. Each must still be present in the restructured output.
4. Eyeball it light **and** dark (the standing Chrome-QA rule) — structure + contrast hold together.

> **The contract holds end to end.** You restructured the presentational layer; the gates verified the
> functional layer is intact. "Green" here means **verified across the stack**, not a green build alone.

---

## 9. Where this came from

`references/benchmark-findings.md` (SG-8) flagged "no per-kind UI templates (board/calendar/gallery/detail) …
*fix later*". These rules **are** that fix — in **guidance** form: rather than ship a fixed set of page-kind
templates (which would over-fit specific kinds and fight the genericity principle), the agent restructures the
ONE generic shape per the `design.md`, within the contract above. Keep it **generic** — no app/entity literals,
patterns only.
