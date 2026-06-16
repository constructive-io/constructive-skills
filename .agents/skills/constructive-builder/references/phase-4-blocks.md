# Phase 4: UI / Blocks

**Goal:** Build the application's UI. This mainline phase has two parts:

- **Branch A — Blocks on-ramp (conditional):** if the brief needs auth/account/org/membership UI, install
  and wire **Constructive Blocks** instead of hand-building those flows. Run **branch A first**, then the
  CRUD body. **If the brief needs none of those flows, skip branch A** and go straight to the CRUD body
  ("Build Your App UI" below).
- **CRUD body (always):** build full list/create/edit/delete UI for every business entity from your
  blueprint, using the template's components and the generated SDK.

> **Mainline numbering note:** this is mainline **Phase 4 (UI / Blocks)**. Its automated gate is
> `./scripts/verify-phase.sh 3` (the externally-visible number `verify-phase.sh` aliases internally — do
> not change it). When blocks are installed, the additive block-coverage gate also runs under
> `./scripts/verify-phase.sh 2.6` (it self-disables when no `.constructive/blocks/*.requires.json` exists).

> **Speedrun shortcut:** [speedrun.md](./speedrun.md) S5–S7 collapse this into the blocks on-ramp +
> `node scripts/scaffold-frontend.mjs build/app-brief.yaml <app>` for the CRUD body. This file is the
> detailed reference / hand-edit fallback.

---

## Phase 4 — Branch A: Blocks Frontend On-Ramp (conditional)

**Goal:** Enable the app to install and run **Constructive Blocks** — copy-in React blocks (sign-in card,
account, membership/invite flows) distributed via a shadcn registry (`@constructive/<block>`) that bind to
the host's per-application generated `auth` + `admin` SDK.

**Run branch A only if** the app brief asks for auth/account/org/membership UI you would otherwise
hand-build. Blocks replace hand-authored auth and account flows; your business-entity CRUD is still the
Phase 4 CRUD body below. **If the brief needs none of these flows, skip branch A** and go straight to
"Build Your App UI".

> **📖 Required reading:** **[blocks-onramp.md](./blocks-onramp.md)** — the full six-step bridge (binding,
> host deps, env, install, provider wiring, preflight) adapted to this template. Also read the
> **`constructive-blocks`** skill for the authoritative blocks playbook. Pick flows from
> [flow-catalog.md](./flow-catalog.md) / [flows.json](./flows.json).

| Step  | Skill | Repo |
| ----- | ----- | ---- |
| 2.7.1 | `constructive-blocks` skill | public |
| 2.7.2 | `constructive-frontend` skill | public |
| 2.7.3 | `constructive-codegen` skill | public |

**The six steps (full detail in [blocks-onramp.md](./blocks-onramp.md)):**

1. **Bind `@/generated/{auth,admin}`** — alias them onto the existing `src/graphql/sdk/{auth,admin}` in
   `tsconfig.json`. **No second codegen** — the template's SDK already exports the ORM layer
   (`configure`/`OrmClientConfig`/`GraphQLAdapter`/`QueryResult`/`GraphQLError`).
2. **Host deps + config** — `@constructive-io/ui` + `@simplewebauthn/browser` are **already installed**
   (wire-app.mjs declared them in `<app>/package.json` and the ONE Phase-3 `pnpm install` materialized
   them — do **not** `pnpm add` them again; a separate add re-resolves the heavy tree). Only the config
   edits remain: add `transpilePackages: ['@constructive-io/ui']` to `next.config.ts`; `@import
   '@constructive-io/ui/globals.css'` and a **verified** `@source` scanning the installed UI component
   source in `globals.css`.
3. **Env** — set `NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT` + `NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT` (the
   `_GRAPHQL_`-named vars blocks-runtime reads — **not** the template's `NEXT_PUBLIC_*_ENDPOINT`).
4. **Install a block — GitHub-Pages registry FIRST.** The `@constructive` registry is **live** at the
   canonical Pages URL (`https://constructive-io.github.io/dashboard/r/<name>.json`; CI deploys
   `apps/registry` to Pages on merge to dashboard `main`, PR #232). Install straight from it:
   `npx shadcn@latest add @constructive/<block>`. **Verify it first** with a curl to that URL (expect
   `200`). **Local `scripts/serve-registry.sh` :4081 is the FALLBACK only** — use it when the Pages
   registry is unreachable (offline / pre-deploy).
5. **Provider wiring** — mount `<BlocksRuntime>` (reusing the existing `QueryClientProvider`) +
   `<StepUpProvider>`, keep `AppPortalRoot`, and **resolve the collision**: remove `configureAuth`/`configureAdmin`
   from `AppProvider` (keep `configureApp`) so there is one configurer per namespace.
6. **Preflight** — run `node scripts/check-sdk.mjs --project <app>` (BUNDLED in this skill's `scripts/`);
   it must exit 0.

> **Gotchas for this phase:** read [gotchas.md](./gotchas.md) BLOCKS-001…011 (and [error-index.md](./error-index.md)) —
> env-name mismatch (001), double-`configure()` collision (002), `@simplewebauthn` not in block deps (003),
> the Tailwind `@source` trap (004), registry reachability → use the Pages registry, fall back to a local
> serve (005), `StepUpProvider` required (006), the `cn` block shadowing `@/lib/utils` (007), the `graphql`
> dual-install override (008), the `'use client'` provider wrapper for `BlocksRuntime` (009), prefixed
> registry names (010), and the non-empty/schema-bearing auth SDK check (011).

> 🚨 **Known block↔backend gaps (keep these in mind; they are real and intentional — [platform-gaps.md](./platform-gaps.md)):**
> - **`auth-api-key-create-dialog`** ships `accessLevelOptions` of `read/write/admin`, but the live
>   `createApiKey` mutation only accepts **`read_only` / `full_access`** (anything else → `INVALID_ACCESS_LEVEL`).
>   `createApiKey` also enforces `STEP_UP_REQUIRED` server-side (defense-in-depth beyond the client gate).
> - **Four flows are currently "blocked"** on upstream constructive-db enablement (the SQL exists but is
>   dormant): magic-link / OTP / MFA / passkey / SIWE preview flows need upstream enablement; create-org
>   (GAP-6), sessions (GAP-2), and M:N junction scoping (GAP-1d) are the standing org/session gaps. See
>   [flow-catalog.md](./flow-catalog.md) for which flows are GA vs preview, and [platform-gaps.md](./platform-gaps.md)
>   for the exact gap IDs.

### Phase 2.7 Checklist (Blocks On-Ramp)

- **2.7.0** Consulted [blocks-onramp.md](./blocks-onramp.md), the `constructive-blocks` skill, and [gotchas.md](./gotchas.md) (search "BLOCKS-", incl. 007–011)
- **2.7.1** `@/generated/auth` + `@/generated/admin` aliased in `tsconfig.json`; both resolve to **non-empty** dirs and the auth SDK exports `useSignInMutation` (not just `test -d` — BLOCKS-011)
- **2.7.2** `@constructive-io/ui` + `@simplewebauthn/browser` installed; `transpilePackages` includes `@constructive-io/ui`; a `graphql` pnpm override pins ONE version (BLOCKS-008)
- **2.7.3** `globals.css` imports `@constructive-io/ui/globals.css` and has a verified `@source` for the installed UI component source
- **2.7.4** `.env.local` sets the `_GRAPHQL_`-named auth + admin endpoints
- **2.7.5** Block installed by its real **prefixed** name from the Pages registry (curl-verified 200), or from the local fallback serve if Pages is unreachable (BLOCKS-005/010); manifest exists; template `cn` (`src/lib/utils.ts`) NOT overwritten (BLOCKS-007)
- **2.7.6** `<BlocksRuntime>` + `<StepUpProvider>` mounted via a `'use client'` wrapper imported by `layout.tsx` (not inline in the server layout — BLOCKS-009); `AppProvider` collision resolved (`configureApp` only)
- **2.7.7** `node scripts/check-sdk.mjs --project <app>` exits 0
- **2.7.8** App builds and a block renders styled (modals centered, backdrop present)
- **2.7.9** Run automated verification: `./scripts/verify-phase.sh 2.6` (block-coverage gate runs additively)

---

## Phase 4 — CRUD body: Build Your App UI

**Goal:** Build your business UI using the generated SDK and template components. This is the **always-run**
part of Phase 4 (after branch A, if branch A applied). Its verify gate is `./scripts/verify-phase.sh 3`.

> **Speedrun uses `scripts/scaffold-frontend.mjs` ([speedrun.md](./speedrun.md) S7) to GENERATE the CRUD
> body from `build/app-brief.yaml`** — it stamps the runtime-generic `constructive-frontend` CRUD Stack +
> `_meta` meta-forms and emits a page per `ui.routes[].kind:crud`. This section is the **method it
> automates + the hand-edit fallback**: read it to understand/extend the generated pages, and follow
> it by hand for a non-CRUD route (`kind: dashboard|detail|custom`) the generator leaves as a stub.
> **This is the DOMAIN entity UI — separate from the auth Blocks/flows (branch A).**

### Where to Build

| Location | Purpose |
|----------|---------|
| `src/app/page.tsx` | **Home page** - Replace the "Start Building" guide with your main feature |
| `src/app/<feature>/page.tsx` | **Feature pages** - Add new routes for each entity (e.g. `boards/`, `boards/[id]/`) |
| `src/app-routes.ts` | **Route config** - Register new routes here |
| `src/lib/navigation/sidebar-config.ts` | **Sidebar** - Add navigation links to your features |

### SDK Imports

```typescript
import { useBoardsQuery, useCreateBoardMutation } from '@sdk/app';    // Your tables
import { useCurrentUserQuery } from '@sdk/auth';                       // Users, auth
import { useOrganizationsQuery } from '@sdk/admin';                    // Orgs, permissions
```

### Phase 3.1: UI Components

**Goal:** Build the app-specific UI using Constructive's component library, the sandbox template structure, and the generated SDK.

| Step  | Skill | Repo |
| ----- | ----- | ---- |
| 3.1.1 | Next.js app structure — see the `constructive-io/constructive` repo | public |
| 3.1.2 | `constructive-frontend` skill (UI components) | public |
| 3.1.3 | `constructive-frontend` skill (CRUD Stack) | public |
| 3.1.4 | `constructive-frontend` skill (meta forms) | public |

> **📖 Required reading:** After reading the skill, **you must read [skill-supplements.md](./skill-supplements.md)**. It contains complete Create/Edit/List templates and SDK integration examples that can be directly copied and used.

#### Key Rules

- **Read CRUD Stack skill before building UI:** You **must** read the `constructive-frontend` (CRUD Stack) skill (Step 3.1.3) before implementing list/create/edit/delete screens. If the template provides Stack (e.g. `@/components/ui/stack`, `CardStackProvider`, `useCardStack`), use the **Stack Cards** pattern (slide-in panels, `card.push`/`card.close`, stacked confirm-delete) for create/edit/delete. Do not default to Dialog-only without reading the skill and checking the template. If the template has no Stack, use the template's Dialog/AlertDialog from `@/components/ui/*`.

```
❌ WRONG: Import or create a generic Dialog for create/edit panels without checking the template. If src/components/ui/stack (at the app root) exists, you must use Stack Cards (constructive-frontend / CRUD Stack), not Dialog.
✅ RIGHT: Before any CRUD UI code, run: ls src/components/ui/stack (from `<app>` = packages/app, where the app's src/ lives). If it exists → read constructive-frontend (CRUD Stack) and use useCardStack().push() + CardComponent. Only if Stack is missing → use template Dialog/AlertDialog from @/components/ui/*.
```

- **Complete CRUD for all app entities:** Implement full list/create/edit/delete UI for **every** core business entity defined in your app (e.g. for a CRM: Contacts, Companies, Deals, Activities). Do not deliver only one example entity and leave the rest as placeholders - the phase is complete when all entities have working CRUD screens.
- **Definition of full CRUD (non-negotiable):** For each entity, you must implement all four: **List** (read), **Create**, **Edit/Update** (e.g. modal or inline form to update existing records), and **Delete** (with a proper confirmation UI such as AlertDialog/Dialog - do not use only `confirm()`). If any entity is missing Edit or uses only `confirm()` for delete, the phase is not complete.
- **Template-first (with a blocks exemption):** For **hand-authored** CRUD, use components from `@/components/ui/*` (the template's own) and do **not** import from `@constructive-io/ui/*`. **Exception:** installed Constructive Blocks (Phase 2.7) legitimately import `@constructive-io/ui` — that is by design and is allowed. The ban applies only to UI you write by hand; never hand-roll an `@constructive-io/ui` import to build a CRUD screen, but do not "fix" a block's `@constructive-io/ui` imports either.
- **No `confirm()` or `alert()`:** For any user-facing confirmation (e.g. delete) or message, use the template's dialog components from `@/components/ui/*` (e.g. `AlertDialog` from `@/components/ui/alert-dialog`). Do **not** use browser `confirm()` or `alert()` - they break template-first and look out of place. Before implementing delete, check the template for an existing dialog/alert-dialog component and use it.

```
❌ WRONG: if (!confirm('Are you sure?')) return; await deleteItem(id);
✅ RIGHT: Use AlertDialog from @/components/ui/alert-dialog - wrap trigger (e.g. Delete button), put message in AlertDialogContent, run delete in AlertDialogAction's onClick. No browser confirm() or alert().
```

- **Mandatory before reporting Phase 3 complete:** Run a search for `confirm(` and `alert(` in the app (e.g. `grep -rE 'confirm\(|alert\(' src` from the app root). If any match is found, replace with the template's AlertDialog (or Dialog) from `@/components/ui/alert-dialog` before reporting Phase 3 complete.
- **SDK imports:** The template provides three SDKs with path aliases:
  - `@sdk/admin` - Organizations, members, permissions, invites
  - `@sdk/auth` - Users, emails, authentication
  - `@sdk/app` - Your business data (tables you created)
- **Use generated SDK:** Do not write raw GraphQL; use generated hooks from `@sdk/app`.
- **Read generated docs first:** Before implementing CRUD, read `src/graphql/sdk/app/README.md`.
- **Register routes:** Adding a new route requires updating `src/app-routes.ts`. **Use the Edit commands from [skill-supplements.md](./skill-supplements.md) "Phase 3: Add Route Template" directly, no need to Read the entire file.**
- **Sidebar:** Add navigation links in `src/lib/navigation/sidebar-config.ts`. **Also use the template to Edit directly.**
- **Route structure:** Put new feature routes directly under `src/app/` (e.g. `app/boards/`).
- **ORM/client delete:** The generated SDK's `delete` method requires an explicit `select` argument, e.g. `client.board.delete({ where: { id }, select: { id: true } }).execute()`. If `pnpm lint:types` reports "Property 'select' is missing", add `select` (see troubleshooting Phase 3). If you see configure-app-sdk `headers` type errors in Phase 3, that's a Phase 3 fix — see troubleshooting Phase 3.
- **orderBy only supports indexed fields:** The generated `XxxOrderBy` enum **only contains fields that have database indexes**. By default, only `ID_ASC`, `ID_DESC`, `PRIMARY_KEY_ASC`, `PRIMARY_KEY_DESC`, `NATURAL` exist. **Do NOT use** `POSITION_ASC`, `CREATED_AT_DESC`, or any custom field orderBy unless you created an index for that field in the provision script.

```
❌ WRONG: orderBy: ['POSITION_ASC', 'CREATED_AT_DESC']  // These don't exist without indexes!
✅ RIGHT: orderBy: ['ID_ASC']  // Always available. UUID is time-ordered, so ID_ASC ≈ created_at ASC
```

If you need `POSITION_ASC` or `CREATED_AT_DESC`, add an index in provision first:
```typescript
await publicDb.index.create({
  data: { tableId, fieldIds: [positionFieldId], name: 'lists_position_idx' },
  select: { id: true },
}).execute();
```
Then re-run `pnpm codegen` to regenerate the schema with the new orderBy values.

#### Phase 3 "don't redo" checklist (read this before coding UI)

- **Mandatory: Review provision script for relations:** Before writing any CRUD UI, open `packages/provision/src/schemas/core.ts` and find all relations. For each relation, plan the corresponding UI (e.g. `notes → folders` needs a folder Select in Create/Edit Note Card). See [skill-supplements.md](./skill-supplements.md) "Relation Field UI Template".
- **Mandatory: Check template for Stack before any CRUD UI:** Run `ls src/components/ui/stack` (from `<app>` = packages/app, where the app's src/ lives). If the directory exists, you **must** read **constructive-frontend** (CRUD Stack) and implement create/edit/delete with **Stack Cards** (`useCardStack`, `card.push`, `CardComponent`). Do **not** create or import a generic `@/components/ui/dialog` for CRUD panels when Stack exists - the template expects Stack for slide-in panels.
- **Always check template UI primitives first**: Before creating any new UI primitive (Dialog/Drawer/etc.), check `src/components/ui/` (app root) for an existing component. If `@/components/ui/stack` exists, use **Stack Cards** per `constructive-frontend` (CRUD Stack) and do **not** build a new Dialog system.
- **Generated hooks are the source of truth**: Before calling any `useXxxQuery` / `useXxxMutation`, open the generated file and follow its `@example` exactly. Do not guess parameters like `input`, `variables`, `select`, `patch`.
- **Update mutation patch name is entity-specific**: For updates, the patch argument is usually `${entity}Patch` (e.g. `contactPatch`, `companyPatch`, `dealPatch`). If you used `patch` and TS complains, stop and check the generated hook signature.
- **SDK query results are often nullable**: Fields from queries (e.g. `board.name`, `list.name`, `card.title`, `createdAt`) are often typed as `string | null | undefined`. When passing into form state or handlers, use `?? ''` (or type the handler to accept nullable) so you don't get "Type 'string | null | undefined' is not assignable to type 'string'". See troubleshooting "SDK nullable fields".
- **Avoid `null` for optional fields unless types allow it**: Prefer `undefined` when you mean "not provided". If TS rejects `null`, do not force-cast; pass `undefined` or omit the field.
- **orderBy enum values must exist in generated schema types**: **Before using any orderBy value**, check what's available: `grep "export type XxxOrderBy" src/graphql/sdk/app/orm/schema-types.ts`. Default is only `ID_ASC/ID_DESC/PRIMARY_KEY_*/NATURAL`. If you need `POSITION_ASC` or `CREATED_AT_DESC`, add an index in provision first (see Key Rules above).

#### Steps

**0. Read Generated SDK Documentation:**

- **App SDK:** `src/graphql/sdk/app/README.md` (app root; written by `pnpm codegen`)
- **SDK Import Reference:**
  - `@sdk/app` - Your business tables (boards, lists, cards, etc.)
  - `@sdk/auth` - Users, authentication (useCurrentUserQuery, useSignInMutation)
  - `@sdk/admin` - Orgs, permissions (useOrganizationsQuery, useSubmitInviteCodeMutation)

**0.5. Read CRUD UI skills + supplements (required):**

- **First, check whether the template has Stack:** Run `ls src/components/ui/stack` (from `<app>` = packages/app). If it exists, you **must** read **constructive-frontend** (CRUD Stack) and use **Stack Cards** for all create/edit/delete UI. Do not create or use a generic Dialog for CRUD panels when Stack exists.
- Read **constructive-frontend** (CRUD Stack) before implementing any create/edit/delete UI. If the template has Stack (e.g. `CardStackProvider`, `useCardStack` in `@/components/ui/stack`), implement edit/delete as Stack cards and use stacked confirm-delete as described in the skill. If the template has no Stack, use the template's Dialog/AlertDialog from `@/components/ui/*`.
- Read **constructive-frontend** (UI components) and the Next.js app structure (see the `constructive-io/constructive` repo) as needed for layout and components.
- **📖 Read [skill-supplements.md](./skill-supplements.md)** — Contains complete Create/Edit/List page templates that can be directly copied and used, just change the entity name.

**1. Build App-Specific CRUD Screens (use skill-supplements.md templates):**

Implement list, create, detail, edit, and delete flows for **all** of your app's core entities (e.g. for a CRM: Contacts, Companies, Deals, Activities - not just one). Every entity that has a table in the provision script should have a full CRUD page; do not leave any as placeholder-only. **Full CRUD** means: List + Create + **Edit/Update** (form or modal to change existing records) + **Delete** (with confirmation dialog, not only `confirm()`).

**2. Use Boilerplate Patterns:**

Reuse the template's route-shell, **Stack cards** (when the template provides Stack - see constructive-frontend / CRUD Stack), form, and loading/error patterns.

**3. Validate Required Flows:**

At minimum, verify:

- Signup/signin reaches authenticated shell
- Signup/signin establishes app-specific session (per-DB token)
- **After login, user is redirected to your main app route** (e.g. `/boards`)
- **Sidebar shows links to your app routes** so users can navigate
- App-specific routes load without errors (no "No QueryClient set")
- CRUD operations work through the UI and persist via API

**3a. Live-browser QA gate (opt-in, hard-fails when enabled).** `./scripts/verify-phase.sh 3` includes an
**opt-in** running-app acceptance gate. It is **enabled** when you set `LIVE_QA=1` **or** when
`build/app-brief.yaml` declares `acceptance.required_flows`. When enabled it launches the app and drives
**signup → login → a CRUD round-trip** headlessly (via [`agent-browser`](https://www.npmjs.com/package/agent-browser)
or Playwright), asserting network 2xx **and a persisted row** (effect still visible after reload), and
**hard-fails** the gate if the round-trip fails. It **degrades gracefully** — skips with a clear notice,
never failing — when the gate is disabled, no browser is available, or no acceptance-drive script is wired
(point at one with `LIVE_QA_DRIVER=/abs/path/driver.mjs`, the bundled `scripts/live-qa.mjs`, or an
`e2e`/`test:e2e` script in the app; set `LIVE_QA_STRICT=1` to make "enabled but nothing to run" a hard
fail). So environments without a browser are never broken. The driver iterates over **every**
`acceptance.required_flows[]` entry — Chrome-QA across ALL the flows the app was built with, not one
round-trip.

**3b. Independent evaluator (final acceptance — do NOT self-grade).** The builder must not be the judge of
its own work. After the `verify-phase.sh 3` gate is green, **spawn a fresh evaluator sub-agent** that
receives **only** `build/app-brief.yaml`'s `acceptance.required_flows` + the running app's URL — **never**
your build transcript, reasoning, diff, or `run-state.json`. It drives the real app and returns pass/fail
per flow. **📖 Read and follow [evaluator-role.md](./evaluator-role.md)** (it contains the exact spawn
prompt and the rationale for why self-evaluation rationalizes shortcuts). The phase is **done only when the
evaluator returns OVERALL: pass** and that verdict is written to `run-state.json` → `evaluator` (by the
evaluator, not the builder).

### Phase 3 Checklist

- **3.0** Consulted [troubleshooting.md](./troubleshooting.md) for Phase 3 (search for "Phase 3")
- **3.1** Imports use correct SDK: business data from `@sdk/app`, auth from `@sdk/auth`, admin from `@sdk/admin`
- **3.2** Home page (`src/app/page.tsx`) replaced with your main feature
- **3.3** CRUD flows work in browser **for every app entity** (no placeholder-only pages for core entities)
- **3.4** **For each entity:** list ✓ create ✓ **edit/update** ✓ delete ✓ (delete uses confirmation UI e.g. Dialog/Stack confirm, not only `confirm()`)
- **3.4b** **Before marking Phase 3 complete:** No use of `confirm()` or `alert()` in app UI. Search the app (e.g. `grep -rE 'confirm\(|alert\(' src` from the app root) and replace any match with template `AlertDialog` from `@/components/ui/alert-dialog`.
- **3.4c** **Relation field UI check:** For each relation in the provision script, verify that Create/Edit Card has a corresponding Select dropdown, and List page displays related entity information. Refer to [skill-supplements.md](./skill-supplements.md) "Relation Field UI Template".
- **3.5** UI components render correctly (no console errors)
- **3.6** New routes registered in `src/app-routes.ts` for all entity pages
- **3.7** Sidebar includes navigation links to new app routes
- **3.8** Run automated verification: `./scripts/verify-phase.sh 3`
- **3.9** Live-browser QA gate satisfied (step 3a): with `LIVE_QA=1` or `acceptance.required_flows` set, the signup → login → CRUD round-trip passed across ALL required flows; or it skipped cleanly (no browser / not enabled) — never a silent pass-over of a real failure
- **3.10** **Independent evaluator** ran (step 3b / [evaluator-role.md](./evaluator-role.md)): a fresh sub-agent given only the acceptance flows + running app returned **OVERALL: pass**, written to `run-state.json` → `evaluator`. The builder did not self-grade.

> **After the gate + evaluator pass (Rule 7):** set `ui.crud_flows_ok` + `ui.forms_ok` +
> `ui.routes_verified` true in the run-state (the evaluator fills `evaluator.*`), then `git commit`
> (tag `green-phase-4`). This is the final build checkpoint.
