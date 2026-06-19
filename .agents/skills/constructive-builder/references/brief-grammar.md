# App Brief Grammar

The **app brief** (`build/app-brief.yaml`) is the GENERIC, hand-writable + machine-consumable spec for
building **any** app on Constructive. It is the **only** thing you hand-author; the scaffolders read it
verbatim:

```bash
node scripts/scaffold-provision.mjs build/app-brief.yaml <app>   # → packages/provision/src/*  (data model + RLS)
node scripts/scaffold-frontend.mjs  build/app-brief.yaml <app>   # → src/app/<entity>/*         (after Phase-3 codegen)
```

The brief is **intent-level**: you pick WHAT (a `modules.preset`, a set of `flows`, a per-table access
`policy`) and the generator emits the COMMON CASE as explicit, editable literal arrays (`nodes[]` /
`policies[]`) with `// TODO: advanced` seams for the long tail. Nothing hard-codes a domain — `todos` /
`posts` / `projects` in the examples are just filled-in instances of the same reusable patterns.

> **Authoring start point.** Copy `fixtures/app-brief.template.yaml` to `build/app-brief.yaml` and edit it
> for YOUR app. **Do not edit `fixtures/golden-app-brief.yaml`** — that is the FROZEN harness-rot canary
> (one owner-scoped `todos` table); its value is being small + deterministic + frozen.

> **The grammar is parsed by a small zero-dep YAML reader** (`scripts/lib/brief.mjs`) scoped to exactly
> the constructs this template uses: block mappings, block sequences, flow collections `{…}`/`[…]`,
> scalars (bare / "double" / 'single' / int / float / true|false|null), full-line and trailing comments,
> and bare tokens with internal `+` / `/` / `:` (so `public-read+owner-write` parses). If a brief needs a
> construct beyond this, add to the grammar in that one module — don't reach for a dep.
>
> **Not supported: folded/literal block scalars** (`>-`, `>`, `|`, `|-`). Write every multi-word string
> value (e.g. `app.description`, `design.brief`) as a **single-line quoted string** — never spread it
> across following indented lines with a `>`/`|` indicator (it would be mis-parsed as a nested block).

---

## Top-level sections

| Section | Required | Purpose |
|---------|----------|---------|
| `version: 1` | yes | document version scalar |
| `app` | `app.id` required | app identity: `id` (kebab-case, drives `pgpm init --name`), `label` (blueprint description), `description`, `workspace_root` (`.` = the pnpm workspace root) |
| `naming` | `naming.db_name` required | every downstream package name + the database name. `db_name` MUST be **plain lowercase `[a-z][a-z0-9]*`** — no hyphens, no underscores (per-DB schema names dash-collapse from it). The rest (`package_scope`, `provision_package`, `schema_package`, `sdk_package`, `cli_package`, `app_package`) drive package names in generated code |
| `modules` | `modules.preset` required | the **provisioning driver** — see [Module presets](#module-presets) |
| `flows` | optional (list) | auth/account/org capability bundles — see [flow-catalog.md](./flow-catalog.md). Flows are AUTH/ACCOUNT/ORG surfaces ONLY, never your domain UI |
| `platform` | optional | local hub coordinates (defaults are the standard local ports; leave unless your ports differ) |
| `auth` | optional | the bootstrap admin seed account (`admin_email`/`admin_password`/`roles`). Capabilities come from `modules.preset` + `flows`, not here |
| `generated` | optional | `frontend_port` (canonical dev port, default 3081) + `app_path` (documentation; the toolkit auto-detects `packages/app` or a root-level `app`) |
| `data_model` | `data_model.tables` non-empty | your domain tables + relations — see [Data model](#data-model-tables) |
| `ui` | optional | one route per surface (`ui.routes[]`); `kind` selects how the page is emitted — see [UI routes](#ui-routes) |
| `acceptance` | optional | `required_flows[]` the live-QA gate verifies end-to-end (the SAME flow ids as `flows`) |
| `design` | optional | look-and-feel intent (theme + layout dials). **ABSENT ⇒ auto-propose** a domain-fitting theme; `{ preset: constructive }` ⇒ keep today's look. See [design (optional)](#design-optional) + [design-system.md](./design-system.md) |
| `assumptions` | optional | free-text notes |

> **App-id / per-app state.** The build-state id (`APP_ID`) is derived from `naming.db_name`, sanitized to
> `[a-z0-9]`. With `APP_ID` set the gates read `build/<app-id>/run-state.json` + `build/<app-id>/app-brief.yaml`;
> unset, they collapse to the legacy singleton `build/run-state.json` + `build/app-brief.yaml`. See
> [speedrun.md](./speedrun.md) "Checkpoint + run-state".

---

## Module presets

`modules.preset` is the FIRST-CLASS driver of which backend modules are provisioned. The scaffolder
**unions** this preset's base modules with the `backend.modules` of every `flow` you list, plus any
node/relation module dependencies, and emits a native-tuple module list — **NEVER `modules: ['all']`**
(`'all'` is not a sentinel and installs nothing; PROVISION-001). Scoped modules are native tuples
`['name', { scope }]`, written in `extra:` as `'name:scope'` strings the scaffolder expands.

| preset | adds (on top of the auth:email base) | use for |
|--------|--------------------------------------|---------|
| `auth:email` | email+password, sessions, account, API keys | solo / single-user apps |
| `auth:email+magic` | + magic-link / passwordless sign-in | email-first, no password |
| `auth:sso` | + connected_accounts + identity_providers (OAuth) | "Sign in with Google/GitHub" |
| `auth:passkey` | + webauthn credentials/auth (passkeys) | passwordless WebAuthn |
| `b2b` | + org-scoped memberships/permissions/invites/… | multi-tenant / orgs / teams |
| `b2b:storage` | b2b + org-scoped file storage buckets | teams that upload files |
| `full` | everything (all auth + b2b + storage + extras) | kitchen-sink / prototyping |
| `minimal` | no auth modules at all | bespoke / advanced |

These are the **only** accepted presets (`scripts/lib/brief.mjs` rejects anything else by name). `extra:`
appends any module not implied by the preset/flows — e.g. a node you use needs its module
(`LimitCounter`/`LimitFeatureFlag` → `'limits_module:<scope>'`; `DataRealtime` → `'realtime_module'`;
`DataI18n` → `'i18n_module'`; `Search*` → their modules; see the `NODE_MODULE_DEPS` map). Example:
`extra: ['realtime_module', 'limits_module:org']`.

> 🚨 **Org policies REQUIRE a b2b preset.** Any table using `policy: org-membership`, `policy: member-owner`,
> `policy: org-hierarchy`, or `restrict: [read-only]` needs `modules.preset` ∈ `{ b2b, b2b:storage, full }` —
> the org-scoped memberships module backs them (and `org-hierarchy` additionally needs `hierarchy_module`,
> which ships in the b2b base; the generator folds it into the module closure). On a bare `auth:email` app
> the brief **fails validation** with a legible error, and at provision time such a table would abort
> `constructBlueprint` with `NOT_FOUND (memberships_module)` — or, for `org-hierarchy`,
> `NOT_FOUND (hierarchy_module …)` (RLS-POLICY-001).

---

## Data model (tables)

Each table is described at INTENT level. The scaffolder always prepends `DataId` and appends
`DataTimestamps`, emits object-form FieldType `{ name: … }` + object-form FieldDefault `{ value: … }`, and
resolves your `policy` intent into explicit `nodes[]` + `policies[]`.

### The 7 policy intents

These are the **only** mapped `policy` values (`KNOWN_POLICIES` in `scripts/lib/brief.mjs`). Each maps to a
fixed `{ nodes[], policies[] }` (`DataId` prepended + `DataTimestamps` appended by the assembler):

| `policy` | who can do what | nodes added | policies emitted |
|----------|-----------------|-------------|------------------|
| `owner` | each row belongs to one user; **only the owner** reads/writes it | `DataDirectOwner` | `AuthzDirectOwner` (all-CRUD, permissive, `data.entity_field='owner_id'`) |
| `org-membership` | **any member of the row's OWN owning org/team** reads+writes it (FLAT own-entity access — NOT parent-derived). **b2b only** | `DataEntityMembership` | `AuthzEntityMembership` (all-CRUD, permissive, `data.entity_field='entity_id'`, `membership_type=2`) |
| `member-owner` | the row is BOTH user-owned AND org-scoped: only the author, within their org, sees it. **b2b only** | `DataOwnershipInEntity` | `AuthzMemberOwner` (all-CRUD, permissive, `data.owner_field='owner_id'`, `entity_field='entity_id'`, `membership_type=2`) |
| `org-hierarchy` | managers see subordinates' rows (`direction: down`) or subordinates see managers' rows (`direction: up`) via the org hierarchy **closure table**. **b2b/full only; requires `hierarchy_module`** (in the b2b base). Needs a `policy_params` sub-map (below) | `DataOwnershipInEntity` (materializes BOTH `owner_id` + `entity_id` — the closure join needs both) | `AuthzOrgHierarchy` (all-CRUD, permissive, `data.direction=<policy_params.direction>`, `anchor_field=<policy_params.anchor_field>`, `entity_field=<policy_params.entity_field ?? 'entity_id'>`, `max_depth` only when set) |
| `related-membership` | members of the entity reached by JOINing this row's FK up to a parent/join table can read+write (**parent-derived** — the case `org-membership`'s FLAT model cannot express). **b2b/full only.** Needs a `policy_params` sub-map (below) | (no data node — the FK column already exists on the row from its `RelationBelongsTo`) | `AuthzRelatedEntityMembership` (all-CRUD, permissive, `data.entity_field=<policy_params.entity_field>`, `obj_table=<policy_params.join_table>`, `obj_field=<policy_params.join_entity_field>`, `membership_type=<policy_params.membership_type ?? 2>`, **`sel_obj:true`+`sel_field:'id'`** (project the parent PK the FK references — the deny-all fix, GAP-15), `obj_schema=<policy_params.join_schema ?? 'app_public'>` (the `app_public` sentinel is rewritten to the physical domain schema by the blueprint engine before construct)) |
| `public-read+owner-write` | published rows readable by the **anonymous (logged-out) public**; only the owner creates/edits/unpublishes (the blog / public-SaaS case). Works on `auth:email` (reads open on publish, not org membership). **LIVE-VERIFIED semantic:** the provision step's public-read reconcile binds `AuthzPublishable`'s SELECT policy to the **`anonymous`** role + GRANTs `anonymous` SELECT, so a logged-OUT visitor reads published rows. NOTE: it is bound to `anonymous`, **not** `authenticated` — so a *second authenticated, non-owner* user does NOT see another user's published rows through this policy (their `authenticated` reads are still owner-scoped by `AuthzDirectOwner`). "Public read" here = the unauthenticated public, the superset of "any logged-in user". | `DataDirectOwner`, `DataPublishable` | TWO-policy stack: `AuthzDirectOwner` (all-CRUD permissive) + `AuthzPublishable` (select-only permissive, `is_published_field='is_published'`, `published_at_field='published_at'`). The assembler also materializes `is_published` (nullable, `default:false`) + `published_at` so this policy can be added day-2 to a **populated** table (see the publishable feature row + the NOT-NULL note) |
| `public-lookup` | every authenticated user can read **AND WRITE** (no ownership) — `AuthzAllowAll`. This is authenticated read+write, **NOT** public-read. Use sparingly (shared reference data only) | none | `AuthzAllowAll` (all-CRUD, permissive, `data: {}`) |

> **`org-membership` is FLAT, not hierarchical.** It authorizes on the `entity_id` ON the row — it never
> walks an FK up to a parent's org. For "members of the parent's org can see this child" (parent-derived
> access) use the first-class **`related-membership`** intent (see its row above and the `policy_params`
> sub-map below) — it JOINs this row's FK up to the parent and authorizes on the PARENT's `entity_id`. The
> generator deliberately does NOT infer this from FKs (that would false-positive on legit FLAT patterns like
> CRM contacts belongs-to companies) — you opt in EXPLICITLY via `policy: related-membership` + `policy_params`,
> so there is no FK-inference false-positive risk. (`org-hierarchy` is likewise a first-class intent for
> closure-table visibility.)

> **`org-hierarchy` requires a `policy_params` sub-map.** Unlike the other intents (which are fully
> determined by the `policy` name), `org-hierarchy` is PARAMETRIC — the closure direction and the
> user/anchor column are app-specific, so you supply them:
>
> ```yaml
> - name: reports
>   policy: org-hierarchy
>   policy_params: { direction: down, anchor_field: owner_id }   # direction ∈ up|down (required); anchor_field required
>   #              optional: entity_field (default entity_id), max_depth: <int>
>   fields:
>     - { name: title,  type: { name: text },    required: true }
>     - { name: amount, type: { name: numeric } }
> ```
>
> `direction` must be `up` or `down`; `anchor_field` is the user column the closure joins on (e.g.
> `owner_id`); `entity_field` defaults to `entity_id`; `max_depth` (optional int) caps visibility depth. A
> missing/invalid `direction` or `anchor_field` **fails validation** with a legible error. `DataOwnershipInEntity`
> materializes both `owner_id` and `entity_id` on the table so the `AuthzOrgHierarchy` predicate can join the
> anchor column to the closure within the row's entity.

> **`related-membership` requires a `policy_params` sub-map.** Author it on a CHILD table that has an FK into
> a parent (join) table. The predicate JOINs this row's FK UP to the parent and authorizes on the **parent's**
> entity/org column — "a member of the org that OWNS THE PARENT can access this CHILD" (parent-derived):
>
> ```yaml
> - name: cards
>   policy: related-membership
>   policy_params: { entity_field: board_id, join_table: boards, join_entity_field: entity_id }
>   #              entity_field      = the FK column ON THIS (child) table that joins up to the parent (required)
>   #              join_table        = the parent/join table NAME this row's FK points at            (required)
>   #              join_entity_field = the entity/org column ON THE PARENT the membership SPRT matches (required)
>   #              optional: membership_type (default 2 = org); join_schema (override the parent's schema — by
>   #                        default the emitter supplies the 'app_public' sentinel, rewritten to the physical
>   #                        domain schema by the blueprint engine; pin join_schema only for a non-default schema)
>   fields:
>     - { name: title, type: { name: text }, required: true }
> ```
>
> All three of `entity_field` / `join_table` / `join_entity_field` are **required** (a missing one **fails
> validation** — `parse.sql` itself raises `BAD_RLS_EXPRESSION entity_field` / `obj_field`). There is **no data
> node**: `AuthzRelatedEntityMembership` materializes nothing (it JOINs at eval time), and the FK column already
> exists on the row from its `RelationBelongsTo`. The emitter sets **`sel_obj:true` + `sel_field:'id'`** so the
> predicate projects the **parent PK the FK references** (the platform default `sel_field='entity_id'` projects an
> org id → compares it to the child's parent-PK FK → **deny-all**; see references/platform-gaps.md GAP-15). It also
> supplies **`obj_schema`** as the logical `app_public` sentinel — omitting it aborts construct with `relation
> "<parent>" does not exist` (the platform does NOT auto-resolve a bare `obj_table` name to a schema) — and the
> generic blueprint engine (`templates/provision/blueprint.ts`) rewrites the sentinel to THIS tenant's physical
> domain schema right before construct, so no hashed/app-specific literal is ever hard-coded. Pin
> `policy_params.join_schema` only when the join table lives in a non-default (already-physical) schema (emitted
> verbatim as `obj_schema`, not rewritten). The **parent** join table must itself carry the entity column the JOIN
> reads (give it `policy: org-membership`, which materializes `entity_id`).

A table needs **either** a `policy` **or** a `nodes_raw`/`policies_raw` escape hatch — validation fails
otherwise.

### restrict modifiers (RESTRICTIVE — ANDed on top)

`restrict: [...]` adds `permissive:false` policies that PostgreSQL **ANDs** with the permissive base
(`KNOWN_RESTRICTS`):

| `restrict` | effect |
|------------|--------|
| `temporal` | adds `valid_from` / `valid_until` timestamptz fields + `AuthzTemporal` (row visible only inside its time window) |
| `read-only` | adds `AuthzNotReadOnly` (org members flagged `is_read_only` can read but not write). **b2b only** |

### features (data-behavior nodes)

`features: [...]` layers data-behavior nodes (`KNOWN_FEATURES`):

| `features` | effect |
|------------|--------|
| `soft-delete` | `DataSoftDelete` (`deleted_at` / `is_deleted`) |
| `slug` | a `slug` text field + `DataSlug` trigger. The source column is DERIVED per-table (a `title`/`name` field, else the first required text field, else the first text field) — never hard-coded |
| `tags` | `DataTags` (a `tags` text[] + GIN index) |
| `jsonb` | `DataJsonb` (a `data` jsonb column) |
| `fts` | a top-level `full_text_searches[]` entry over the table's text fields. The assembler MATERIALIZES a `search` tsvector COLUMN (the live procedure only resolves an existing one) fed by the weighted text sources |
| `publishable` | `DataPublishable` (implied by `public-read+owner-write`; list it to add the toggle without opening public reads). A duplicate node is collapsed by `$type`. The assembler ALSO MATERIALIZES the publish-state columns itself — `is_published` (boolean, **nullable**, `default: false`) + `published_at` (timestamptz, nullable) — so the platform's own `data_publishable` generator finds them present and SKIPS its `NOT NULL` column path. This is what makes "turn an existing, **populated** table publishable" work day-2 (see the NOT-NULL backfill note under [Field shape rules](#field-shape-rules-objects-not-bare-strings--field-type-001--f5)). An author who declares `is_published`/`published_at` explicitly in `fields` wins (deduped by name) |

### Escape hatches (the long tail)

For anything the intents above don't cover, two keys pass through **verbatim**:

- `nodes_raw: [...]` → spliced into the table's `nodes[]`
- `policies_raw: [...]` → spliced into the table's `policies[]`

Use these for the advanced Authz* types (`AuthzPeerOwnership`, `AuthzRelatedEntityMembership`,
`AuthzOrgHierarchy`, `AuthzComposite`, …) and advanced nodes (`SearchVector`, `EventTracker`,
`DataRealtime`, …). See the **`constructive-security`** skill `references/authz-types.md` and the
**`constructive-blueprints`** skill `references/blueprint-definition-format.md`.

### Field shape rules (OBJECTS, not bare strings — FIELD-TYPE-001 / F5)

```yaml
fields:
  - { name: title,  type: { name: text },    required: true }
  - { name: is_done, type: { name: boolean }, default: { value: false } }
```

- `type` is a FieldType **OBJECT** `{ name: 'text' }` — **never** a bare string `type: text`. Validation
  rejects a non-object `type` with a FIELD-TYPE-001 error.
- The boolean type name is **`boolean`**, not `bool`.
- `default` is a FieldDefault **OBJECT** `{ value: <literal> }` — never a bare string. The default is
  forwarded verbatim to the blueprint and applied as the column's `DEFAULT`.
- Other per-field keys: `required: true` (→ `is_required`), `description`, `index`.

> 🚨 **Adding a `required: true` column DAY-2 to a table that already holds rows.** On a **fresh** table
> a required column is fine (created NOT NULL). On a table that **already has rows**, the platform
> sequences the DDL as `ADD COLUMN` (nullable, no default) → `SET NOT NULL` → `SET DEFAULT` — the
> `DEFAULT` lands AFTER the NOT-NULL check, so it does **not** backfill the existing rows, and the
> whole (atomic) `constructBlueprint` ABORTS with `column "<col>" of relation "<t>" contains null
> values` (an upstream platform DDL-ordering limitation — see references/platform-gaps.md). The brief's
> `default:` cannot rescue this: the platform applies a day-2 ADD COLUMN's default too late to backfill.
> **Workarounds for a day-2 required column on a populated table:** (1) add it **nullable** first
> (`required` omitted) — give it a `default:` so NEW rows get a value and existing rows stay NULL; later
> backfill + tighten to `required` only once every row has a value; or (2) make the change on an empty
> table / pre-backfill the rows before tightening. The generator does this for you automatically for the
> ONE case it can detect generically — the **publishable** columns (`is_published`/`published_at`), which
> it pre-materializes as nullable+default so `policy: public-read+owner-write` / `features: [publishable]`
> can be added to a populated table day-2 (see the `publishable` feature row above).

### Relations

`data_model.relations[]` mirror the blueprint relation shape 1:1 (`$type` one of `RelationBelongsTo` /
`RelationHasMany` / `RelationHasOne` / `RelationManyToMany`). `delete_action` is written readable
(`SET NULL` / `CASCADE` / `RESTRICT` / `SET DEFAULT` / `NO ACTION`) and normalized to the single-char
enum the platform stores. A `RelationManyToMany` carries its junction security under `data:` (or flat
top-level keys); the generator lifts it to the flat `nodes`/`grants`/`policies` `construct_blueprint`
actually reads (a nested-only `data` block ships a deny-all junction).

> **Org-scoped M:N junctions are fully supported via Pattern 3** — the generator adds
> `DataEntityMembership` (materializing `entity_id` on the junction) + an `AuthzEntityMembership` policy +
> `authenticated` grants, forwarded to `secure_table_provision` as-is. Request it either way:
>
> - **nested `data:`** (as today) —
>   `data: { policy_type: AuthzEntityMembership, policy_data: { entity_field: entity_id, membership_type: 2 } }`, or
> - **`junction_policy:` shorthand** — `junction_policy: org-membership` (mirrors the table `policy`
>   vocabulary; `member-owner` → `AuthzMemberOwner` + `DataOwnershipInEntity`).
>
> No column-management burden on the author: the generator MATERIALIZES the org column on the junction.
> The emitted relation carries `nodes: [DataEntityMembership{entity_field_name:entity_id, include_id:false,
> include_user_fk:true}]`, `policies: [AuthzEntityMembership{entity_field:entity_id, membership_type:2}]`,
> and `grants: [authenticated full-CRUD]`, and **records NO warning**. **Only edge case:** if you hand-write
> an org policy onto an explicit DataId-only `nodes` set (no org column), the generator coerces to
> `AuthzAllowAll` with a LOUD `brief.warnings[]` entry (GAP-1d safety net) — let the default Pattern-3 path
> materialize the column instead. Composite primary keys on a *parent table* are NOT a supported intent yet —
> they ABORT loudly (use `nodes_raw` or a surrogate id + `unique_constraints`).
>
> **`use_composite_key: true` — composite-keyed junctions.** `use_composite_key` is a first-class boolean
> `RelationManyToMany` param: when `true`, the platform trigger builds the junction's PRIMARY KEY from its
> two FK columns (e.g. `(project_id, tag_id)`), so the pair IS the identity and **no surrogate `DataId`
> belongs on the junction**. The platform contract is explicit that this is **mutually exclusive with a
> `DataId` node** (a `DataId` would add a second, conflicting PK and abort provision). The generator honors
> this on BOTH junction-security paths:
>
> - **plain (no junction policy)** — the default node set drops `DataId` and keeps only `DataTimestamps`
>   (the FK columns come from the trigger): emitted `nodes: [DataTimestamps{include_id:false}]`.
> - **org-scoped (Pattern 3)** — the materializing `DataEntityMembership` already carries `include_id:false`,
>   so it is composite-safe by construction; the org policy + grants are emitted exactly as above. The flag
>   is forwarded verbatim, so the emitted relation reads
>   `{ …, use_composite_key: true, nodes: [DataEntityMembership{…include_id:false}], policies:
>   [AuthzEntityMembership{…}], grants: [authenticated full-CRUD] }`.
>
> Setting `use_composite_key: true` AND hand-writing a `DataId` into the junction's `nodes` (or `data.nodes`)
> is a contradiction (a double PK) — the generator **ABORTS loudly** with a legible `BriefError` rather than
> ship a blueprint the platform would reject deep inside an atomic provision. Drop the `DataId`, or set
> `use_composite_key: false` to use a surrogate UUID id. Worked fixture: `fixtures/test-mn-composite-brief.yaml`
> (composite-keyed org-scoped junction).

---

## UI routes

One `ui.routes[]` entry per surface. `kind` selects how `scaffold-frontend.mjs` emits the page:

| `kind` | emitted |
|--------|---------|
| `crud` | a typed list + `DynamicFormCard` (meta-forms) bound to the entity's generated SDK hooks. Set `entity` to the **singular** of the table name; testids fall out as `<entity>-*` |
| `dashboard` | a stub landing/overview page + `// TODO: custom UI` seam |
| `detail` | a stub single-record page + `// TODO: custom UI` seam |
| `custom` | a stub page you fill in + `// TODO: custom UI` seam |

Auth/account/org routes come from `flows` (their Blocks) — do **not** list them here.

---

## Worked examples — one per tier

### Tier 1 — owner (solo / single-user; `auth:email`)

The safe default: each user owns their rows, nobody else sees them; round-trips CRUD with zero org
modules. (This is the canary's pattern.)

```yaml
modules: { preset: auth:email, extra: [] }
flows:  [ email-password ]
data_model:
  tables:
    - name: todos
      policy: owner
      fields:
        - { name: title,   type: { name: text },    required: true }
        - { name: notes,   type: { name: text } }
        - { name: is_done, type: { name: boolean }, default: { value: false } }
ui:
  routes:
    - { path: /todos, label: Todos, kind: crud, entity: todo }
acceptance: { required_flows: [ email-password ] }
```

Full file: `fixtures/golden-app-brief.yaml` (FROZEN canary — copy the template instead of editing it).

### Tier 2 — public-read+owner-write (the blog / public-SaaS case; `auth:email`)

The #1 pattern single-owner CRUD cannot express: published rows readable by anyone authenticated, only the
author writes/unpublishes. Emits the two-policy stack (`AuthzDirectOwner` all-CRUD + `AuthzPublishable`
select-only). Needs NO b2b preset.

```yaml
modules: { preset: auth:email, extra: [] }
flows:  [ email-password, profile ]
data_model:
  tables:
    - name: posts
      policy: public-read+owner-write
      features: [ slug, tags, fts, publishable ]   # publishable is implied; listing it is a harmless no-op
      fields:
        - { name: title, type: { name: text }, required: true }
        - { name: body,  type: { name: text } }
ui:
  routes:
    - { path: /posts, label: Posts, kind: crud, entity: post }
acceptance: { required_flows: [ email-password ] }   # only flows with a live-QA driver belong here
```

Full file: `fixtures/test-blog-brief.yaml`.

### Tier 3 — org-membership (multi-tenant / B2B; `b2b`)

Two org-scoped tables joined by a real FK; any member of the owning org reads+writes. REQUIRES `preset: b2b`.

```yaml
modules: { preset: b2b, extra: [] }
flows:  [ email-password, organization, org-members ]
data_model:
  tables:
    - name: companies
      policy: org-membership
      fields:
        - { name: name,   type: { name: text }, required: true }
        - { name: domain, type: { name: text } }
    - name: contacts
      policy: org-membership
      features: [ fts ]
      fields:
        - { name: first_name, type: { name: text }, required: true }
        - { name: last_name,  type: { name: text } }
        - { name: email,      type: { name: text } }
  relations:
    - $type: RelationBelongsTo
      source_table: contacts
      target_table: companies
      field_name: company_id
      delete_action: SET NULL
      is_required: false
ui:
  routes:
    - { path: /companies, label: Companies, kind: crud, entity: company }
    - { path: /contacts,  label: Contacts,  kind: crud, entity: contact }
acceptance: { required_flows: [ email-password ] }
```

Full file: `fixtures/test-crm-brief.yaml`. (B2B org state — the personal-org membership a fresh signup's org
writes need — is provisioned natively by the platform; GAP-1b/1c, CLOSED. No reconcile step.)

> **`acceptance.required_flows` is a hard gate, not a wish list.** List only flows with a FULLY-implemented
> live-QA driver (today: `email-password`). Listing a flow with no driver is a hard coverage-gap FAIL.
> `email-password` is email-free, so it runs on a bare warm hub; flows needing email/OAuth/org need those
> services up ([infra-setup.md](./infra-setup.md)). The other fixtures' `organization`/`org-members`/`profile`
> are PROVISIONED but verified structurally by the Phase-2 gates, not listed under acceptance.

### Tier 3 + M:N — org-scoped many-to-many junction (Pattern 3; `b2b`)

Two org-scoped tables linked many-to-many. The junction inherits the parents' org-membership access via
**Pattern 3** — the generator materializes `entity_id` on the junction and emits the real
`AuthzEntityMembership` policy + grants (NO `AuthzAllowAll`, NO warning). Request the junction policy with
the nested `data:` block OR the `junction_policy: org-membership` shorthand.

```yaml
modules: { preset: b2b, extra: [] }
flows:  [ email-password, organization, org-members ]
data_model:
  tables:
    - name: projects
      policy: org-membership
      fields: [{ name: name, type: { name: text }, required: true }]
    - name: tags
      policy: org-membership
      fields: [{ name: label, type: { name: text }, required: true }]
  relations:
    - $type: RelationManyToMany
      source_table: projects
      target_table: tags
      junction_table_name: project_tags
      # nested form — equivalently: `junction_policy: org-membership`
      data: { policy_type: AuthzEntityMembership, policy_data: { entity_field: entity_id, membership_type: 2 } }
ui:
  routes:
    - { path: /projects, label: Projects, kind: crud, entity: project }
    - { path: /tags,     label: Tags,     kind: crud, entity: tag }
acceptance: { required_flows: [ email-password ] }
```

Full file: `fixtures/test-mn-pattern3-brief.yaml`. The emitted `project_tags` relation carries
`nodes: [DataEntityMembership{…}]` + `policies: [AuthzEntityMembership{entity_field:entity_id,
membership_type:2}]` + `grants: [authenticated full-CRUD]`, and `brief.warnings[]` stays empty.

### Tier 3 + hierarchy — org-hierarchy closure visibility (`b2b`)

Rows owned by a user within an org, visible UP or DOWN the org hierarchy closure. With `direction: down`
a manager sees every report owned by someone below them in the hierarchy; with `direction: up` a report's
owner sees their managers' rows. Emits `DataOwnershipInEntity` (materializes `owner_id` + `entity_id`) +
`AuthzOrgHierarchy`. REQUIRES `preset: b2b` (the `hierarchy_module` backing the closure ships in the b2b
base; the generator folds it into the module closure).

```yaml
modules: { preset: b2b, extra: [] }
flows:  [ email-password, organization, org-members ]
data_model:
  tables:
    - name: reports
      policy: org-hierarchy
      policy_params: { direction: down, anchor_field: owner_id }   # direction ∈ up|down (req); anchor_field req
      fields:
        - { name: title,  type: { name: text },    required: true }
        - { name: amount, type: { name: numeric } }
ui:
  routes:
    - { path: /reports, label: Reports, kind: crud, entity: report }
acceptance: { required_flows: [ email-password ] }
```

Full file: `fixtures/test-orghierarchy-brief.yaml`. The emitted `reports` table carries
`nodes: [DataId, DataOwnershipInEntity, DataTimestamps]` + `policies: [AuthzOrgHierarchy{direction:down,
anchor_field:owner_id, entity_field:entity_id}]`, and the module closure includes `hierarchy_module`. The
same brief on a non-b2b preset (e.g. `auth:email`) **fails validation**.

### Tier 3 + parent-derived — related-membership (the parent-owns-the-child case; `b2b`)

A CHILD table whose access derives from the org that owns its PARENT — the case the FLAT `org-membership`
intent cannot express. The child carries only an FK to the parent (no `entity_id` of its own); a member of
the parent's org reads+writes the child. Emits `AuthzRelatedEntityMembership` (which JOINs the FK up to the
parent and authorizes on the parent's `entity_id`) and **no** data node on the child. The parent table is a
normal `org-membership` table (it carries the `entity_id` the JOIN reads). REQUIRES `preset: b2b`.

```yaml
modules: { preset: b2b, extra: [] }
flows:  [ email-password, organization, org-members ]
data_model:
  tables:
    - name: boards               # the PARENT/join table — FLAT org-membership (carries entity_id)
      policy: org-membership
      fields: [{ name: name, type: { name: text }, required: true }]
    - name: cards                # the CHILD — parent-derived access via the board_id FK
      policy: related-membership
      policy_params: { entity_field: board_id, join_table: boards, join_entity_field: entity_id }
      fields: [{ name: title, type: { name: text }, required: true }]
  relations:
    - $type: RelationBelongsTo
      source_table: cards
      target_table: boards
      field_name: board_id
      delete_action: CASCADE
      is_required: true
ui:
  routes:
    - { path: /boards, label: Boards, kind: crud, entity: board }
    - { path: /cards,  label: Cards,  kind: crud, entity: card }
acceptance: { required_flows: [ email-password ] }
```

Full file: `fixtures/test-relatedmembership-brief.yaml`. The emitted `cards` table carries
`nodes: [DataId, DataTimestamps]` (NO `DataEntityMembership`/`DataOwnershipInEntity` — a child has no
`entity_id` of its own; the `board_id` FK comes from the relation) + `policies:
[AuthzRelatedEntityMembership{entity_field:board_id, obj_table:boards, obj_field:entity_id,
membership_type:2, sel_obj:true, sel_field:id, obj_schema:app_public}]`, and the module closure includes
`memberships_module`. The `sel_obj:true`+`sel_field:'id'` project the parent PK the FK references (the deny-all
fix — GAP-15); `obj_schema:'app_public'` is the logical sentinel the blueprint engine rewrites to this tenant's
physical domain schema before construct (omitting it would abort construct with `relation "boards" does not
exist`). The same brief on a non-b2b preset **fails validation**.

### member-owner (compound: user-owned AND org-scoped)

`member-owner` (b2b) is the COMPOUND intent: a row is owned by ONE user **and** lives within an org, and only
that author, only within an org they belong to, may read/write it. It maps to the platform's **`AuthzMemberOwner`**
— a predicate the SQL builder (`ast_helpers.cpt_member_owner`) **ANDs** from two halves:

```
( owner_id = current_user_id() )                                                   -- half 1: ownership
  AND
( entity_id = ANY( SELECT org_sprt.entity_id FROM org_sprt                          -- half 2: org membership
                    WHERE org_sprt.actor_id = current_user_id() ) )
```

**RLS behavior (the contract):** the OWNER who is a MEMBER of the row's org **sees + writes** (both halves true);
a *different* member of the same org (a NON-owner) is **denied** (half 1 false: `owner_id ≠ actor`); a NON-member
is **denied** (half 2 false: the row's org is not in the actor's memberships).

```yaml
- name: notes
  policy: member-owner             # fully determined by the name — no policy_params
  fields:
    - { name: title, type: { name: text }, required: true }
    - { name: body,  type: { name: text } }
```

The emitted `notes` table carries `nodes: [DataId, DataOwnershipInEntity, DataTimestamps]` + `policies:
[AuthzMemberOwner{owner_field:owner_id, entity_field:entity_id, membership_type:2}]` (all-CRUD, permissive), and
the module closure includes `memberships_module`. Two things make this correct:

> - **`DataOwnershipInEntity` materializes BOTH `owner_id` + `entity_id`** — the two columns the compound policy
>   dereferences (it is the platform's canonical owner_id+entity_id data module). A single-column node
>   (`DataDirectOwner`→`owner_id` only, or `DataEntityMembership`→`entity_id` only) would leave the other column
>   unmaterialized and abort construct with `column "<col>" does not exist`.
> - **No `sel_obj`/`sel_field` projection** (the contrast with `related-membership`). member-owner is the
>   FLAT-own-entity shape: the row carries its OWN `entity_id` (an org id), and the org SPRT also projects
>   `entity_id`, so the platform default `sel_field='entity_id'` makes half 2 `row.entity_id = ANY(my org ids)` —
>   correct as-is. (`related-membership` is the OTHER shape — the row's FK is a *parent PK*, not an org id — which
>   is why ONLY that intent sets `sel_obj:true`+`sel_field:'id'`; member-owner must NOT carry those keys.)

`membership_type:2` selects the ORG SPRT (`get_sprt_alias` maps `2 → org_sprt`); the `rls_parser` resolves
`sprt_table`/`sprt_schema` from it at provision time, so no physical literal is emitted. The same brief on a
non-b2b preset **fails validation**. Full file: `fixtures/test-memberowner-brief.yaml`.

### escape hatches

For access models beyond the seven intents (peer ownership, composite, related-member-list, …), drop to
`nodes_raw` / `policies_raw` and the **`constructive-security`** skill. See also `fixtures/test-childfk-brief.yaml`
for a multi-table FK shape.

---

## design (optional)

`design:` is an **additive, optional** top-level block that shapes the generated app's **look and feel**
— the theme tokens (colors / radius / fonts) plus the layout **dials** (variance / motion / density). It
sits alongside the other top-level sections (logically near `ui`, since it shapes presentation). It is
purely additive: a brief **without** a `design:` block is fully valid and predates this feature.

> **Default = auto-propose.** When `design:` is **absent**, the build **auto-proposes** a full,
> domain-fitting theme (the new baseline — a generated app should not ship the stock Constructive blue
> unless asked). The build agent reads `app.label`/`app.description` + entity names, classifies the look
> into the three dials, picks/adapts a preset, and authors a `design.md` that the deterministic engine
> lints (invariants + WCAG contrast) and compiles into the app's `globals.css` token overrides. The
> reasoning methodology — dials, the words→dials table, the color invariants, the `design.md` format, the
> preset catalog, and the compile/override contract — lives in **[design-system.md](./design-system.md)**.
> This block is how a brief *constrains or overrides* that auto-proposal; it is **not** required to get a
> theme.

> **Opt-out = keep today's look.** `design: { preset: constructive }` is the explicit opt-out: the design
> step is a **no-op** and the boilerplate `globals.css` is left exactly as shipped (the stock blue,
> light-first theme). Use it when a brief deliberately wants the default look.

### Shape (every field optional)

```yaml
design:
  brief: "warm editorial, calm, trustworthy, high-end print feel"   # natural-language style words → dials
  preset: minimalist                  # a named archetype anchor: constructive | minimalist | trust-first |
                                       #   editorial | soft | brutalist | playful  (constructive = opt-out / no-op)
  dials: { variance: 5, motion: 3, density: 3 }                     # explicit override of the inferred dials (each 1–10)
  art_direction:                       # OPTIONAL structural pin — which shell + page composition to restructure to
    shell: top-nav                     #   sidebar | top-nav | minimal | editorial-wide | dense-dashboard
    composition: data-table            #   list | data-table | gallery | split-pane | editorial | board (default per entity)
    density: compact                   #   comfortable | cozy | compact (human echo of the DENSITY dial)
    notes: "scanning-first admin"      #   single-line free text — why this shell/composition
  colors:                              # role-level palette overrides (semantic roles, NOT shadcn var names)
    primary: "oklch(0.55 0.11 162)"   # the ONE brand/action color (required if you give `colors`)
    accent:  "oklch(0.7 0.12 250)"    # at most ONE accent
    neutral: "oklch(0.55 0.01 250)"   # ONE gray temperature
    surface: "oklch(0.99 0.004 250)"
    on-surface: "oklch(0.27 0.01 250)"
    error: "oklch(0.55 0.2 25)"
  font:   { sans: "Geist", mono: "Geist Mono" }                     # next/font/google allowlist (off-list → Geist + warn)
  radius: "0.5rem"                     # seeds --radius (px / em / rem)
  default_mode: dark                   # which theme loads first → layout.tsx ThemeProvider defaultTheme (light | dark)
  allow_brand_hue: true                # opt out of the "AI purple/blue" hue-band warning for a deliberate brand hue
```

Colors accept `oklch(L C H)`, `#rrggbb`, or `rgb(…)`. Every key is optional — supply only what you want
to pin and let the engine synthesize the rest. The three common shapes:

- **`design:` absent** → auto-propose a theme (default).
- **`design: { preset: <name> }`** → anchor on a named preset, auto-fill the palette/dials from it.
  `preset: constructive` is the special no-op opt-out.
- **`design: { brief: "<words>", colors: { primary: … } }`** → classify the words to dials, then pin the
  brand color explicitly; the engine derives everything else and enforces the invariants + contrast.

> **`design.art_direction` — pinning the STRUCTURE (optional).** Beyond the theme tokens + dials,
> `design.art_direction` records the *structural* direction — the **shell** + per-entity **page composition** +
> **density** the build restructures the app to (`shell` ∈ sidebar | top-nav | minimal | editorial-wide |
> dense-dashboard; `composition` ∈ list | data-table | gallery | split-pane | editorial | board; `density` ∈
> comfortable | cozy | compact; `notes` free single-line text). It is **GUIDANCE-level** — no scaffolder
> consumes it as a token; it is the durable record so re-runs / day-2 turns reproduce the same layout. **Default
> = auto-propose** (the agent picks shell/composition/density from the dials + prose and writes them into the
> emitted `design.md`); pin it here only to constrain that. Every key is optional. The structural rules + the
> preserve-contract checklist live in [art-direction.md](./art-direction.md); the block's shape +
> single-source-of-truth note for `density` are in [design-system.md §5.3](./design-system.md). (The emit-time
> spacing tier still resolves from `design.dials.density` first — `art_direction.density` is the human echo of
> that choice, not a second input.)

> **`design.brief` must be a single-line quoted string.** The zero-dep brief YAML reader
> (`scripts/lib/brief-yaml.mjs`) does **not** support folded/literal block scalars (`>-`, `>`, `|`, `|-`).
> Write the style words on one line: `brief: "warm editorial, calm, trustworthy"` — never
> `brief: >-` / `brief: |` with the text on following indented lines (those would be mis-parsed as a
> nested block). The same applies to every other string value in the brief.

> **DENSITY dial — where to put it (resolution order).** The DENSITY dial drives the generated entity
> pages' **layout density** and is read by `scaffold-frontend`. Its **single source of truth is
> `design.dials.density`** here in the brief. As a robustness fallback, if `design.dials.density` is
> absent, `scaffold-frontend` reads `dials.density` from the **emitted `design.md`** discovered next to
> the app — so an auto-propose agent that recorded the dials in the design.md (rather than the brief)
> still threads density correctly. Resolution order: **(1) `brief.design.dials.density` → (2) emitted
> `design.md` `dials.density` → (3) the `cozy` default** (byte-identical to a design-less build). See
> [design-system.md §8](./design-system.md). (The emitted `design.md` holds the palette / type / radius
> *tokens*; the `dials` hold the *layout* dials.)

### Validation (optional strictness — `validateDesign`)

The `design:` block has **no required keys**, so any brief with a syntactically valid `design:` mapping
passes. When the block is present, `scripts/lib/brief-policy.mjs` runs an **optional** `validateDesign`
pass that fails fast with a **legible** error on a *malformed* block (so a typo never silently reaches the
compiler) while **tolerating unknown keys** (forward-compatible):

- `design` must be a mapping (not a list/scalar).
- `preset`, if set, must be one of the known anchors (`constructive | minimalist | trust-first |
  editorial | soft | brutalist | playful`).
- `dials`, if set, must be a mapping; each present dial (`variance`/`motion`/`density`) must be an integer
  in **1–10**.
- `colors`, if set, must be a mapping; each value (e.g. `primary`/`accent`/`neutral`/`surface`/
  `on-surface`/`error`) must be a string color token. (Deeper invariants — ≤1 accent, chroma cap,
  AI-purple ban, **WCAG contrast** — are enforced by the deterministic linter `check-design.mjs`, not
  here; this is shape-validation only.)
- `font`, if set, must be a mapping (`sans`/`mono` string family names).
- `radius`, if set, must be a string (px/em/rem).
- `default_mode`, if set, must be `light` or `dark`.
- `allow_brand_hue`, if set, must be a boolean.

Anything not listed is passed through untouched (unknown keys tolerated). The full reasoning + the
compile/override contract are in **[design-system.md](./design-system.md)**.
