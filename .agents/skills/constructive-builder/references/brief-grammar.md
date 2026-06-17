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
> or `restrict: [read-only]` needs `modules.preset` ∈ `{ b2b, b2b:storage, full }` — the org-scoped
> memberships module backs the policy. On a bare `auth:email` app the brief **fails validation** with a
> legible error, and at provision time such a table would abort `constructBlueprint` with
> `NOT_FOUND (memberships_module)` (RLS-POLICY-001).

---

## Data model (tables)

Each table is described at INTENT level. The scaffolder always prepends `DataId` and appends
`DataTimestamps`, emits object-form FieldType `{ name: … }` + object-form FieldDefault `{ value: … }`, and
resolves your `policy` intent into explicit `nodes[]` + `policies[]`.

### The 5 policy intents

These are the **only** mapped `policy` values (`KNOWN_POLICIES` in `scripts/lib/brief.mjs`). Each maps to a
fixed `{ nodes[], policies[] }` (`DataId` prepended + `DataTimestamps` appended by the assembler):

| `policy` | who can do what | nodes added | policies emitted |
|----------|-----------------|-------------|------------------|
| `owner` | each row belongs to one user; **only the owner** reads/writes it | `DataDirectOwner` | `AuthzDirectOwner` (all-CRUD, permissive, `data.entity_field='owner_id'`) |
| `org-membership` | **any member of the row's OWN owning org/team** reads+writes it (FLAT own-entity access — NOT parent-derived). **b2b only** | `DataEntityMembership` | `AuthzEntityMembership` (all-CRUD, permissive, `data.entity_field='entity_id'`, `membership_type=2`) |
| `member-owner` | the row is BOTH user-owned AND org-scoped: only the author, within their org, sees it. **b2b only** | `DataOwnershipInEntity` | `AuthzMemberOwner` (all-CRUD, permissive, `data.owner_field='owner_id'`, `entity_field='entity_id'`, `membership_type=2`) |
| `public-read+owner-write` | published rows readable by **anyone authenticated**; only the owner creates/edits/unpublishes (the blog / public-SaaS case). Works on `auth:email` (reads open on publish, not org membership) | `DataDirectOwner`, `DataPublishable` | TWO-policy stack: `AuthzDirectOwner` (all-CRUD permissive) + `AuthzPublishable` (select-only permissive, `is_published_field='is_published'`, `published_at_field='published_at'`) |
| `public-lookup` | every authenticated user can read **AND WRITE** (no ownership) — `AuthzAllowAll`. This is authenticated read+write, **NOT** public-read. Use sparingly (shared reference data only) | none | `AuthzAllowAll` (all-CRUD, permissive, `data: {}`) |

> **`org-membership` is FLAT, not hierarchical.** It authorizes on the `entity_id` ON the row — it never
> walks an FK up to a parent's org. For "members of the parent's org can see this child" (parent-derived /
> hierarchical access) you must opt in explicitly via `policies_raw` (the generator deliberately does NOT
> infer hierarchy from FKs — that would false-positive on legit FLAT patterns like CRM contacts
> belongs-to companies). The names `org-hierarchy` and `related-membership` are **recognized but ABORT**
> with a pointer at `policies_raw` + `AuthzRelatedEntityMembership`/`AuthzOrgHierarchy`.

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
| `publishable` | `DataPublishable` (implied by `public-read+owner-write`; list it to add the toggle without opening public reads). A duplicate node is collapsed by `$type` |

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
- `default` is a FieldDefault **OBJECT** `{ value: <literal> }` — never a bare string.
- Other per-field keys: `required: true` (→ `is_required`), `description`, `index`.

### Relations

`data_model.relations[]` mirror the blueprint relation shape 1:1 (`$type` one of `RelationBelongsTo` /
`RelationHasMany` / `RelationHasOne` / `RelationManyToMany`). `delete_action` is written readable
(`SET NULL` / `CASCADE` / `RESTRICT` / `SET DEFAULT` / `NO ACTION`) and normalized to the single-char
enum the platform stores. A `RelationManyToMany` carries its junction security under `data:` (or flat
top-level keys); the generator lifts it to the flat `nodes`/`grants`/`policies` `construct_blueprint`
actually reads (a nested-only `data` block ships a deny-all junction).

> 🚨 **M:N junction security is platform-INCOMPLETE (GAP-1d, [platform-gaps.md](./platform-gaps.md)).** A
> DataId-only junction can't carry an org/owner column, so an `AuthzEntityMembership`/`AuthzMemberOwner`
> junction policy is **coerced to `AuthzAllowAll`** (any authenticated user) with a LOUD warning recorded
> on `brief.warnings[]`. To keep parent-matching security, add the matching DATA node to the relation
> (`nodes: [DataEntityMembership]`). Composite primary keys are NOT a supported intent yet — they ABORT
> loudly (use `nodes_raw` or a surrogate id + `unique_constraints`).

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

### member-owner and the escape hatches

`member-owner` is the same shape as Tier 3 with `policy: member-owner` (b2b). For access models beyond the
five intents (peer ownership, parent-derived/hierarchical, composite), drop to `nodes_raw` / `policies_raw`
and the **`constructive-security`** skill. See also `fixtures/test-childfk-brief.yaml` for a multi-table FK
shape.
