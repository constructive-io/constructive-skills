# Benchmark findings — the Cleome maximal-app benchmark (2026-06-15)

> **What this is.** The result ledger for the **Cleome Field Station** benchmark run — the deliberately
> *maximal, still-buildable* app the builder skill is stress-measured against (NOT the frozen golden canary).
> One believable single product (a research-station biodiversity ops console) that exercises, in one brief:
> a **5-level required-FK nesting chain**, **multi-required-FK** tables, **two self-referential FKs**, **two
> payload-carrying N:M junctions**, the b2b org-membership tier with **cross-tenant RLS**, a **wide** create+edit
> table, the **escape hatch** (`nodes_raw` / `policies_raw`), and a broad **creative UI** surface. Its purpose is
> to find the places where the brief grammar + generators can't yet express what a real domain wants — so each
> finding lands in exactly one of four buckets: **PASSED**, **DISTILLED this wave** (generic primitive added),
> **DEFERRED** (skill-side, scoped below), or **ESCALATED** (consume-only platform gap).
>
> **Genericity invariant.** Every DISTILLED item below is a brief-/`_meta`-derived **primitive** named by an
> `SG-*` code — it carries **zero** entity/table/testid/flow literals; the rot-canaries
> (`check-scaffold`, `check-frontend-scaffold`, `check-flow-surfaces`, `check-flows`) stay green, which is the
> genericity proof. The Cleome name appears only in this findings doc; no generator or verification file names
> it (or anything domain-specific to it).
>
> **Cross-refs.** Platform gaps → `references/platform-gaps.md` (GAP-N). Brief grammar → `references/brief-grammar.md`.

---

## 1. What PASSED (the benchmark cleared these as-shipped)

The benchmark proved the generic generators already handle the hard data-model + UI shapes end-to-end:

- **Deep required-FK chain (5 levels).** A `station → site → plot → survey → observation`-shaped chain (each
  child belongs-to its parent via a **required** FK, with multiple required FKs on the lower levels) provisions
  and scaffolds: every child page emits the parent list-hook import, the FK picker testid, and the camelCase FK
  key in its create mutate (SG-1 + SG-6, exercised at depth). The `check-frontend-scaffold` canary covers the
  one-hop case; the benchmark proved it composes down a 5-deep spine.
- **Self-referential FK.** A table with a FK back to itself (a "resurvey-of" / parent-pointer shape) renders the
  same generic picker the cross-table FKs get — no special-casing, no raw-UUID fallthrough (SG-1's required vs
  optional/self-ref split holds for the self-ref case).
- **RLS cross-tenant rigor (b2b).** With the `b2b` preset + `AuthzEntityMembership` tables scoped by the active
  org, org B cannot see org A's rows — the per-org isolation holds transitively through the FK chain (children
  inherit their parent's org). The active-org `entity_id` is threaded into every org-scoped create (SG-C /
  org-membership scoping).
- **Wide create+edit table (sheets).** A table with many scalar columns scaffolds a working create + edit
  surface; required non-text columns (date/int/bool/timestamp) get minimal defaults so the create is not
  NOT-NULL-rejected (SG-B), and the title binding fills the text columns.
- **Creative UI inventory + navigability.** The generated app mounts a coherent, navigable shell (sidebar/nav +
  per-entity CRUD pages + the org switcher for the org tier) across a large, varied entity set — the UI stays
  legible and reachable at benchmark scale.
- **Escape hatch.** Tables reached via `nodes_raw` / `policies_raw` (advanced Authz the mapped intents don't
  cover) provision, and their required owner uuid columns get a self-default so the generated create still
  inserts (SG-2).

---

## 2. What was DISTILLED this wave (generic primitives added — canaries green)

Each is a brief-/`_meta`-derived primitive in the generator or a template; none carries an app literal. The
benchmark surfaced the *class*, and the fix is the class:

| Code | Primitive (generic) | Where |
|------|---------------------|-------|
| **SG-A** | Alias-entity hook derivation: the SDK hooks (`use<Entities>Query` / `useCreate<Entity>Mutation`), the `data.<entities>` accessor and the `DynamicFormCard` `_meta` tableName all derive from the **table** name (what codegen generated), not the route entity — so a route whose entity does not inflect to its backing table imports the **real** table-derived hooks instead of hooks codegen never made. | `scaffold-frontend.mjs` (`emitEntityPage` / `tableFor`) |
| **SG-B** | Required-non-text create defaults: a minimal value for every required non-text column (date/int/bool/timestamp) the title binding can't fill, spliced into the create **mutation body only**, so the quick-add is not NOT-NULL-rejected. | `scaffold-frontend.mjs` (`requiredNonTextDefaults` / `pickCreateExtra`) |
| **SG-C** | Member-owner dual scoping: an `AuthzMemberOwner` create supplies **both** `owner_id` (the actor) **and** `entity_id` (the active org) — the prior single-key create NOT-NULL-rejected on `owner_id`. | `scaffold-frontend.mjs` (`pickCreateExtra`, scoping seams) |
| **SG-2** | `policies_raw` owner-field scoping: an escape-hatch table with no mapped scoping const sets each declared owner uuid column (`data.entity_fields`) to the actor id (a self-default), so its create still inserts. Stage-2 of SG-2 = the **N:M link/unlink manager** (below). | `scaffold-frontend.mjs` (`policiesRawOwnerFields`) + `templates/frontend/crud/relation-manager.tsx` |
| **SG-1** | FK picker for **every** belongs-to FK (required *and* optional *and* self-referential) — not just required cross-table FKs; optional/self-ref no longer fall through to a bare raw-UUID text box. | `scaffold-frontend.mjs` (FK-picker emission) |
| **SG-6** | FK option **label**: each FK picker fetches its parent's first display field (when one exists) alongside the id, so the option shows a human label instead of a bare UUID (falls back to the id when the parent has no label field). | `scaffold-frontend.mjs` (`labelField`) + relation-manager |
| **N:M link UI** | A generic `<…RelationManager>` link/unlink surface for every junction a table OWNS (`manyToManyRelations(brief, table)`): list linked rows, link (insert the junction row), unlink (delete it), with the linked-record label via SG-6. ZERO entity/table literals — all identifiers are substituted from the brief's N:M relation + `_meta`. The empty-array default keeps non-N:M tables byte-identical. | `templates/frontend/crud/relation-manager.tsx`, wired in `scaffold-frontend.mjs` |

**Re-stamp proof:** dry/real-stamping all four fixtures (owner / blog public-read+owner-write / crm org-membership
/ childfk required-FK) and re-stamping the Cleome brief into a scratch dir shows the create mutate now carries the
required/scoping keys, the FK option shows a label, and the N:M manager is emitted on junction-owning tables —
while the four rot-canaries stay green (the owner/blog/crm/childfk fixtures stamp identically for the shapes they
cover, i.e. no over-fit).

---

## 3. What is DEFERRED (skill-side, scoped — not done this wave)

These are real gaps the benchmark wanted but that are **out of scope for this wave**; each is skill-fixable later
(a grammar/generator extension), none is a platform gap. Listed with the smallest correct fix:

- **SG-3 — junction PAYLOAD columns.** A payload-carrying N:M wants extra domain scalar columns on the **link
  row** (not just the FK pair). The brief's M:N `data:` block exposes no payload-column slot, so the
  relation-manager emits link/unlink for the FK pair only. *Fix later:* grow the M:N grammar a payload slot, then
  extend the create mutate + a small payload form in `relation-manager.tsx`. (Cross-ref: GAP-14b notes the
  benchmark hit this on two junctions; the **security** half is the platform GAP-1d, this **payload** half is
  skill-side.)
- **SG-4 — enum field type.** The brief has no first-class enum/`DataEnum` field type, so a constrained-choice
  column is modeled as free text (no `<select>` of allowed values, no DB enum/check). *Fix later:* add an enum
  field kind to the grammar + emit a `<select>` bound to the allowed set and the matching DB constraint.
- **SG-5 — RLS-aware seed pipeline.** No generic seed step that inserts believable starter rows **as an
  authenticated actor** (respecting RLS/scoping) so a fresh app isn't empty on first load. *Fix later:* a
  brief-declared seed block executed through the authed SDK path (owner/org scoping honored), idempotent per run.
- **SG-7 — live-qa multi-actor / temporal / read-only drivers.** The QA layer drives a single actor; it has no
  driver for **cross-tenant** assertions (actor A cannot see actor B's rows), **temporal** windows
  (`AuthzTemporal` in/out-of-window), or **read-only** access-level distinctions. *Fix later:* add generic
  multi-actor + temporal + read-only QA drivers derived from the brief's policy intents.
- **SG-8 — rich UI kind templates + pagination.** Entity pages render a single generic list+create kind; there
  are no per-kind UI templates (board/calendar/gallery/detail) and no list **pagination** (cursor/`hasNextPage`)
  for large tables. *Fix later:* a small set of brief-selectable page-kind templates + a generic paginated list.
- **SG-9 — create-in-context on 1:N spines.** On a deep 1:N spine, a child can only be created from its own page
  with the parent picked manually; there is no "create child **in the context of** this parent" affordance from
  the parent's detail view (the FK pre-filled). *Fix later:* emit a contextual create on the parent page that
  pre-binds the FK.
- **Over-restrictive public-read-cross-tenant boundary.** The current public-read+owner-write tier treats the
  read boundary more tightly than some domains want (a "public" row is still actor/owner-fenced in places a true
  public-read would expose). *Fix later:* a grammar knob to widen the read policy to genuinely public where the
  domain intends it, without loosening the write side.

---

## 4. What was ESCALATED (consume-only platform gaps — NOT skill-fixable)

Filed in `references/platform-gaps.md` in the standard GAP-N style (symptom / root / owner / severity /
close-out probe + status-expiry blockquote):

- **GAP-14 — `construct_blueprint` column-name mangling.** A column whose name ends in `_<single-char>`
  (`elevation_m`, `temperature_c`) is provisioned with the `_` before the last char **stripped** → the deployed
  column + all codegen come back `elevationm` / `temperaturec`, breaking the brief↔codegen name identity (TS
  not-assignable on a valid column). Multi-char trailing segments survive. Owner **constructive-db**; MEDIUM; no
  in-harness fix that keeps the name (re-spell to a multi-char suffix or accept the mangled name).
- **GAP-14b → GAP-1d cross-reference.** The benchmark re-confirmed the **payload N:M junction-security** gap on
  two junctions: `construct_blueprint` reads only the top-level relation security and drops the nested
  `relation.data.{nodes,policy_type,grants}` (the harness `junctionPolicy()` `AuthzAllowAll` coercion keeps the
  M:N *feature* working but the per-org policy is not honored). Already documented as **GAP-1d** — no new entry,
  just a traceable pointer. Owner **constructive-db** (+ **constructive** to forward the nested `data.*`).
- **OrgSwitcher dev-only hydration mismatch — RECLASSIFIED as skill-side, NOT escalated.** The benchmark hit a
  React hydration warning where the org switcher renders server-side `Select organization` vs client-first
  `Loading…`. *Investigation shows the OrgSwitcher is a **skill-owned template*** (`scripts/templates/frontend/
  flows/org-context.tsx`, stamped by `scaffold-frontend.mjs` — it is **not** a dashboard-blocks component), so
  it is **skill-fixable** and does **not** belong in the consume-only platform ledger. *Fix (skill-side, a
  Stage-1/2 template one-liner — deferred here):* gate the client-only `Loading…` text behind a mounted flag
  (`const [m,setM]=useState(false); useEffect(()=>setM(true),[])`, render the loading text only when `m`), or add
  `suppressHydrationWarning` to the switcher's label `<span>` (the `<html suppressHydrationWarning>` already
  present does **not** cover descendant text). Non-fatal, dev-only.

---

## 5. Verdict

The benchmark **PASSED on the hard data-model + UI shapes** (deep FK chains, self-ref, cross-tenant RLS, wide
tables, creative UI, escape hatch). This wave **DISTILLED 7 generic primitives** (SG-A/B/C/2/1/6 + the N:M
link/unlink manager) with the four rot-canaries staying green — the genericity proof. The remaining wants are
**scoped DEFERRALS** (SG-3/4/5/7/8/9 + the public-read read-boundary knob), all skill-side, and **one consume-only
platform gap** was **ESCALATED** (GAP-14, plus the GAP-1d re-confirmation as GAP-14b). The OrgSwitcher hydration
warning was **reclassified** as a skill-side template fix (not a platform gap) once it was traced to a skill-owned
template.
