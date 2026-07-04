# Phase 2: Data Model Provisioned

**Goal:** Stand up the workspace, the provision package, and the database schema (tables, relations,
RLS) in one phase — ending with a provisioned database and a provision-side codegen of the SDK.

This phase has three steps that run in sequence: **2.1 Workspace** → **2.2 Provision Package** →
**2.3 Blueprint Provision** (which also runs the inline membership + auto-verify-email SQL and the
provision-side `pnpm codegen`). Two verify gates cover it: `./scripts/verify-phase.sh 2.1` (workspace)
and `./scripts/verify-phase.sh 2.3` (database + tables + policies).

> **Speedrun shortcut:** [speedrun.md](./speedrun.md) S1+S2 collapse this whole phase into
> `scripts/scaffold-provision.mjs build/app-brief.yaml <app>` + run create-db/provision + a read-only grant
> VERIFY (the platform grants `authenticated` natively). This file is the **method the generator automates +
> the hand-edit fallback** — read it to understand/review the generated `schemas/core.ts`, or when your shape
> needs the `nodes_raw`/`policies_raw` escape hatches ([brief-grammar.md](./brief-grammar.md)).

> **Parallelize:** while the backend from Phase 1 finishes deploying, you can already draft the
> `BlueprintDefinition` (step 2.3) — authoring does not need the server until `create-db`/`provision` run.

---

## Phase 2.1: Create pgpm Workspace

**Goal:** Scaffold a pgpm workspace (no database modules — just the workspace shell).

> **You must use `pgpm init` to scaffold this.** Use the `pgpm/workspace` template (the default).

> 🚨 **`pgpm init` REQUIREMENT (read before the first `pgpm init` — applies to ALL `pgpm init` calls in
> Phases 2.1, 2.2, and 2.6):** `pgpm init` uses readline prompts an agent cannot answer. **`--yes` alone
> is NOT enough — it hangs and crashes with `ERR_USE_AFTER_CLOSE`.** You MUST pass `--no-tty` **AND every
> template variable as an explicit flag** (`--name`/`--moduleName`, `--fullName`, `--email`, `--username`,
> `--repoName`, `--license`, …). If any variable is missing, the prompter falls through to readline and
> crashes in a non-TTY shell. `--no-tty` only skips prompts for values already in argv. Example:
> ```bash
> pgpm init workspace --no-tty \
>   --name my-workspace --fullName "Your Name" --email "you@example.com" \
>   --username your-gh-handle --license MIT --repoName my-workspace
> ```
> Full flag lists for workspace **and** module are in [troubleshooting.md](./troubleshooting.md) →
> "Phase 2.1: pgpm init non-interactive mode fails", and the rule is [gotchas.md](./gotchas.md)
> **PGPM-001** ([error-index.md](./error-index.md) indexes it). (Same idea for `cnc server`: pass
> `--origin "*"` or it prompts for the CORS origin.)

### Phase 2.1 Checklist

- **2.1.1** Workspace scaffolded via `pgpm init`
- **2.1.2** Workspace root has `pgpm.json`
- **2.1.3** Workspace root has `pnpm-workspace.yaml`
- **2.1.4** `pnpm install` succeeds without errors
- **2.1.5** Run automated verification: `./scripts/verify-phase.sh 2.1`

---

## Phase 2.2: Create Provision Package

**Goal:** Create a pnpm module (not pgpm) called `packages/provision`.

> **You must use `pgpm init` to scaffold this.** Use the `pnpm/module` template (`pgpm init -t pnpm/module`).
> **Same `--no-tty` + full-params rule as Phase 2.1** (see the 🚨 callout there / PGPM-001) — `--yes` alone
> hangs. Pass `--no-tty` and every flag (`--moduleName`, `--moduleDesc`, `--fullName`, `--email`,
> `--username`, `--repoName`, `--license`, `--access`, …).

**Important pnpm-module patterns (see the `constructive-io/constructive` repo):**

- `main`, `module`, `types` point to files inside dist (no `dist/` prefix)
- Use `publishConfig.directory: "dist"` and `makage` for builds
- Do NOT use `exports` map in package.json

### Phase 2.2 Checklist

- **2.2.1** `packages/provision` exists and was scaffolded via `pgpm init`
- **2.2.2** `packages/provision/package.json` follows makage conventions
- **2.2.3** `pnpm build` produces `dist/` directory

---

## Phase 2.3: Build Provision Package with Blueprint

**Goal:** Wire the provision package to use **TypeScript Blueprints** (`BlueprintDefinition` from
`node-type-registry`) to create database, schema, and tables via the `@constructive-io/sdk` SDK.

> **The speedrun uses `scripts/scaffold-provision.mjs` ([speedrun.md](./speedrun.md) S2) to GENERATE
> everything in this section from `build/app-brief.yaml`.** The blueprint shape, policy-intent →
> `nodes[]`/`policies[]` mapping, object-form grants, and module list below are the **conceptual spec the
> generator automates** — read them to understand (and review) the generated `schemas/core.ts`, and as the
> **hand-edit fallback** when your shape needs the `nodes_raw`/`policies_raw` brief escape hatches or a
> manual file.

### Schema Creation Methods (Ranked)

| # | Method | When to Use | Key Package |
|---|--------|------------|-------------|
| **1** | **Blueprint** (preferred) | Always start here. Typed TypeScript definitions — tables, relations, indexes, RLS in one shot. | `node-type-registry` + `@constructive-io/sdk` |
| **2** | **Secure Table Provision** | Adding a table after initial blueprint, or fine-grained single-table control. | `@constructive-io/sdk` |
| **3** | **Direct table creation** | Not recommended. Edge cases only. | `@constructive-io/sdk` |

> **Blueprint is Constructive's declarative schema provisioning system** — define a complete domain
> schema (tables, fields, relations, RLS policies, indexes, search) in TypeScript with full type safety,
> and create everything via `constructBlueprint`.

> **📖 Required reading:**
> - **[skill-supplements.md](./skill-supplements.md)** "Phase 2.3: Blueprint Provision Template" —
>   **complete copy-paste templates** for all provision files
> - **`constructive-blueprints`** skill — declarative blueprints + the authoritative **node-type-registry**
>   (every `nodes[]` entry; which Data* node adds `id` / `owner_id` / `entity_id`)
> - **`constructive-data-modeling`** skill — tables/fields/relations + `secureTableProvision` (Blueprint
>   shape) and database provisioning
> - **`constructive-security`** skill — Authz policy protocol (20 Authz* types) + per-policy config keys
>   (e.g. `AuthzDirectOwner` → `entity_field`)

### Key Packages

| Package | Purpose |
|---------|---------|
| `@constructive-io/sdk` | SDK with `auth`, `public_` — supports Node.js and browsers |
| `node-type-registry` | TypeScript types: `BlueprintDefinition`, `BlueprintTable`, `BlueprintRelation`, etc. |
| `pg` | Direct Postgres access for database config settings |
| `dotenv` | Load `.env` credentials written by `create-db` |
| `tsx` | Run TypeScript directly without build step |

> **IMPORTANT:** Use `@constructive-io/sdk` for all SDK access. It supports both Node.js and browser environments.

### Provision Package Structure

```
packages/provision/
├── package.json            ← scripts: create-db, provision
├── src/
│   ├── config.ts           ← Centralized env config (reads .env)
│   ├── helpers.ts          ← withRetry, createPlatformClient, createAuthClient
│   ├── blueprint.ts        ← provisionBlueprint() engine
│   ├── create-db.ts        ← Step 1: Sign up + create database → writes .env
│   ├── provision.ts        ← Step 2: Multi-pass schema orchestrator
│   └── schemas/
│       ├── core.ts         ← Domain tables (BlueprintDefinition)
│       └── search.ts       ← Search config (separate pass, optional)
```

### Two-Step Workflow

```
Step 1: pnpm run create-db
   - Signs up via auth API (unique email per run)
   - Provisions database via databaseProvisionModule with an explicit module list (the `auth:email`
     list — never ['all']; see gotchas.md PROVISION-001)
   - Writes DATABASE_ID, ACCESS_TOKEN, DATABASE_NAME to .env

Step 2: pnpm run provision
   - Reads .env credentials
   - Configure database settings (deterministic_ids, etc.)         [SQL only]
   - Pass 1: Core domain schemas (tables, fields, relations)       [GraphQL API]
   - Pass 2: Search configuration (requires tables from Pass 1)    [GraphQL API]
   - Fix membership defaults (is_approved, is_verified)            [SQL only]
   - Reset deterministic IDs for normal operation                  [SQL only]
```

### Blueprint Definition Example (TypeScript)

> 🚨 **Field shapes are OBJECTS (F5).** In a `BlueprintField`, `type` is a **FieldType object**
> `{ name: 'text' }` / `{ name: 'boolean' }` (note: `boolean`, not `bool`) and any default is a
> **FieldDefault object** `{ value: false }` / `{ value: 0 }` — **never** bare strings (`type: 'text'`,
> `default_value: 'false'` are rejected). See [skill-supplements.md](./skill-supplements.md) "Common
> Field Types" and [gotchas.md](./gotchas.md) F5.

```typescript
import type { BlueprintDefinition } from 'node-type-registry';
import { provisionBlueprint } from '../blueprint.js';

const definition: BlueprintDefinition = {
  tables: [
    {
      ref: 'boards',
      table_name: 'boards',
      // DEFAULT = owner-scoped (each user owns their rows): DataDirectOwner + AuthzDirectOwner.
      // DataDirectOwner adds ONLY owner_id (no id PK), so prepend DataId for full update/delete
      // CRUD (F18). For org/b2b tenancy swap to DataEntityMembership + AuthzEntityMembership —
      // but that REQUIRES the b2b org modules; on auth:email it FAILS HARD at constructBlueprint
      // (NOT_FOUND memberships_module) and the table is never created (RLS-POLICY-001).
      nodes: [
        'DataId',
        'DataDirectOwner',
        { $type: 'DataTimestamps', data: { include_id: false } },
      ],
      fields: [
        // FieldType + FieldDefault are OBJECTS, not bare strings:
        { name: 'name', type: { name: 'text' }, is_required: true },
        { name: 'description', type: { name: 'text' } },
        { name: 'is_archived', type: { name: 'boolean' }, default: { value: false } },
      ],
      // OBJECT-FORM grants — constructBlueprint applies these as GRANT … TO authenticated
      // server-side. Do NOT use the stale `grant_roles: [...]` + bare `grants: [['select','*'],…]`
      // shape: it lands NO grant and every authenticated write 403s (gotchas F3).
      grants: [{ roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] }],
      use_rls: true,
      // Owner-scoped: config key is `entity_field` (value = the owner column), NOT `owner_field`.
      // The client sets ownerId to the authed user's id on create (WITH CHECK blocks any other = anti-spoof).
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: ['select', 'insert', 'update', 'delete'],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    },
  ],
  relations: [
    { $type: 'RelationBelongsTo', source_table: 'lists', target_table: 'boards', delete_action: 'c', is_required: true },
  ],
};

export default async function main() {
  await provisionBlueprint(definition, 'App Core');
}
```

> **The owner-scoped default above — the DataId prereq (F18) and the config-key gotcha.** The example
> ships the default `DataDirectOwner` + `AuthzDirectOwner` ("each user owns their own rows"). Two things
> the template already gets right, so don't regress them:
>
> 1. **`DataDirectOwner` adds ONLY `owner_id` — no `id` primary key.** Without an `id` PK the GraphQL API
>    exposes **create + list only** (no update/delete — a mutation has no key to target). That is why the
>    example **prepends a `DataId` node** (`DataEntityMembership` / `DataOwnershipInEntity` carry `id` on
>    their own). Probe-confirmed: `nodes: ['DataDirectOwner']` → `{owner_id, …}` with NO primary key
>    (create + list only); `nodes: ['DataId', 'DataDirectOwner']` → `{id, owner_id, …}` with an `id` PK
>    and full create/update/delete/list.
> 2. **`AuthzDirectOwner`'s config key is `entity_field` (NOT `owner_field`).** The key is `entity_field`;
>    its value is the owner column name (`owner_id`). Using `owner_field` here triggers
>    `MISSING_REQUIRED_FIELD`. `owner_field` belongs to **`AuthzMemberOwner` / `AuthzPeerOwnership` /
>    `AuthzRelatedPeerOwnership` / `AuthzOrgHierarchy`**, not `AuthzDirectOwner` — see the
>    **`constructive-security`** skill `references/authz-types.md` (§1 `AuthzDirectOwner`) for the full
>    per-policy config shapes.
>
> **Org/b2b swap (only when the `b2b` preset is provisioned).** For org tenancy, swap the data+policy pair
> to `DataEntityMembership` + `AuthzEntityMembership` (fields unchanged). This is **opt-in** — it requires
> the org modules, and on an `auth:email` app it aborts `constructBlueprint` with `NOT_FOUND
> (memberships_module)` (RLS-POLICY-001). App-wide shared pool with no ownership → `AuthzAllowAll`.
> ```typescript
> nodes: ['DataEntityMembership', { $type: 'DataTimestamps', data: { include_id: false } }], // carries id
> policies: [{
>   $type: 'AuthzEntityMembership',
>   privileges: ['select', 'insert', 'update', 'delete'],
>   permissive: true,
>   data: { entity_field: 'entity_id', membership_type: 2 }, // requires the b2b org modules
> }],
> ```

### Common Node Types

> **Authoritative list:** the full node-type registry (data / check / relation / search / view / process /
> job / event / limit / authz nodes) lives in the **`constructive-blueprints`** skill
> `references/node-type-registry.md`. Treat that as the source of truth; the subset below is just the few
> you reach for most, plus the build-flow-specific **`DataId` prereq** tip.

| Node Type | Purpose | Added Fields |
|-----------|---------|--------------|
| `DataId` | Just adds `id` (UUID primary key) | `id` |
| `DataDirectOwner` | Direct ownership — pairs with `AuthzDirectOwner` | `owner_id` **(no `id`)** |
| `DataEntityMembership` | Entity membership (carries id) | `id`, `entity_id` |
| `DataOwnershipInEntity` | Entity ownership + owner tracking (carries id) | `id`, `entity_id`, `owner_id` |
| `DataTimestamps` | Timestamps (use `include_id: false` when composing) | `created_at`, `updated_at` |
| `SearchUnified` | Multi-strategy search (tsvector, BM25, trgm, pgvector) | Depends on config |
| `DataSoftDelete` | Soft delete | `deleted_at` |
| `DataTags` | Tags array | `tags citext[]` + GIN index |
| `DataEmbedding` | Vector embedding | embedding + HNSW index |

> 🚨 **`DataId` prereq for full CRUD.** `DataEntityMembership` and `DataOwnershipInEntity` already carry
> an `id` primary key, but **`DataDirectOwner` does NOT add `id`** (only `owner_id`). Any table that needs
> update/delete must carry an `id` PK, so when composing `DataDirectOwner` (or any node set that lacks one)
> **prepend `DataId`** — otherwise the API exposes only create + list. See the Owner-scoped callout (F18) above.

### Common Policy Types

> Full per-policy config shapes (all 20 Authz* types) are in the **`constructive-security`** skill
> `references/authz-types.md`. A few common ones:

| Policy Type | Purpose | Key config |
|-------------|---------|------------|
| `AuthzDirectOwner` | **Default** — users can only access rows they own | `entity_field` (value = owner column, e.g. `owner_id`) |
| `AuthzAllowAll` | App-wide shared pool — all authenticated users access | `{}` |
| `AuthzEntityMembership` | Org/b2b tenancy — **requires the `b2b` org modules; aborts `constructBlueprint` on `auth:email`** | `entity_field`, `membership_type` |
| `AuthzAppMembership` | App-level membership gate (hardcoded `membership_type=1`) | optional `permission`/`is_admin` |

> **Config-key gotcha:** `AuthzDirectOwner` uses **`entity_field`** (NOT `owner_field`). `owner_field` is
> for `AuthzMemberOwner` / `AuthzPeerOwnership` / `AuthzRelatedPeerOwnership` / `AuthzOrgHierarchy`. See
> authz-types.md (linked above) for which key each policy takes.

### Reference Skills

| Step  | Skill | Repo |
| ----- | ----- | ---- |
| 2.3.1 | `constructive-blueprints` — blueprint shape + node-type-registry (authoritative: which node adds `id`/`owner_id`/`entity_id`) | public |
| 2.3.2 | `constructive-data-modeling` — tables/fields/relations + `secureTableProvision` Blueprint shape | public |
| 2.3.3 | `constructive-security` — Authz* policies, per-policy config keys (`AuthzDirectOwner` → `entity_field`), grants, RLS | public |

### Phase 2.3 Checklist

- **2.3.0** Consulted [troubleshooting.md](./troubleshooting.md) for Phase 2.3 (search for "Phase 2.3")
- **2.3.1** Provision package created at `packages/provision/` with `@constructive-io/sdk` + `node-type-registry`
- **2.3.2** `create-db.ts` runs successfully — database provisioned, `.env` written
- **2.3.3** `provision.ts` runs successfully — all schema modules executed
- **2.3.4** Database settings configured (`deterministic_ids`, `simple_schema_names`, `schema_use_underscores`)
- **2.3.5** All app tables created with correct fields (including the ownership column: `owner_id` for the owner-scoped default, `entity_id` on a b2b app)
- **2.3.6** Tables have RLS policies applied (owner-scoped `AuthzDirectOwner` by default; `AuthzEntityMembership` only on a b2b app)
- **2.3.7** Relations (FKs) use `source_table` / `target_table`
- **2.3.8** Membership defaults fixed (`is_approved = TRUE, is_verified = TRUE`)
- **2.3.9** Deterministic IDs reset after provisioning
- **2.3.10** Run `pnpm codegen` to generate SDK
- **2.3.11** Run automated verification: `./scripts/verify-phase.sh 2.3`

> 🚨 **Membership defaults + the `authenticated` GRANT are REQUIRED, not optional (F3).** Without them
> every authenticated per-DB app mutation comes back **`permission denied`**, so a "green build" still has
> zero working CRUD. Two things must be true:
>
> 1. **The signed-in user must be an approved/verified member** of the app. The
>    `app_membership_defaults` row gates this; with defaults off, the new user is unapproved and RLS
>    denies all writes. Set `is_approved = TRUE, is_verified = TRUE` (the `fix-membership-defaults`
>    workaround), and `emails.is_verified` default `true` (`auto-verify-email`). The `provision.ts`
>    template runs both at the end of `pnpm run provision`.
> 2. **The `authenticated` role must actually hold the table grants.** Your blueprint declares the
>    **object-form** `grants: [{ roles: ['authenticated'], privileges: [['select','*'],…] }]` (NOT the
>    stale `grant_roles` + bare-tuple shape, which lands no grant); **`constructBlueprint` applies those
>    GRANTs server-side** (GRANT … TO authenticated). If the grants don't land, even an approved member
>    gets `permission denied` — VERIFY post-provision (`information_schema.role_table_grants`) and, only on a
>    deployment that predates the native grant, apply the one-time manual GRANT fallback
>    ([speedrun.md](./speedrun.md) S2 step 3) if the hub did not.
>
> **GraphQL-only approve/grant path (no PostgreSQL connection).** If you have only the GraphQL API
> (no `PGHOST`), do **not** "skip and hope the defaults apply" — drive it through the API instead:
> - Re-run provisioning via `constructBlueprint` with the **object-form** `grants: [{ roles:
>   ['authenticated'], privileges: [['select','*'],['insert','*'],['update','*'],['delete','*']] }]`
>   so the role gets the table grants applied server-side (the only grant path that does not need raw SQL;
>   the stale `grant_roles` + bare-tuple shape lands no grant).
> - Approve/verify the membership through the admin/memberships mutations the platform exposes
>   (e.g. update the app membership to `is_approved: true` / accept it) rather than `UPDATE`-ing the
>   defaults table directly. The membership-defaults row only governs *future* signups; an
>   already-created member is approved via the membership mutation.
> - Then confirm: a signed-in `authenticated` user can insert AND read back a row (reload-persist). A
>   2xx that returns no row, or a `permission denied`, means a grant or the approval did not land.
>
> > **Known caveat (root cause is platform-side).** The underlying reason these are needed at all —
> > membership defaulting to unapproved and `authenticated` grants not being auto-applied — is a
> > platform/constructive-db behavior, not a build-flow bug. We document the workaround here; the durable
> > fix lands in the platform ([platform-gaps.md](./platform-gaps.md)). Do not edit
> > constructive-db/constructive from this build flow.
>
> Full SQL for the with-PostgreSQL path in [gotchas.md](./gotchas.md) → "Provisioning Workarounds (SQL
> Access Required)".

> 🚨 **One more grant reconcile runs automatically (preset-keyed) — HANDS-FREE and generic.**
> `provision.ts` applies a further platform-gap workaround derived from the **policy intent / schema**,
> never from any table or column name:
>
> 1. **Public-read (anonymous) — for any `public-read+owner-write` table.** The platform lands the
>    `AuthzPublishable` SELECT policy scoped to `authenticated` ONLY and grants the `anonymous` role
>    nothing, so a logged-OUT visitor hitting the public data API gets `permission denied for table <t>`
>    and "public read" is not actually public. The reconcile **discovers every publishable table from
>    `pg_policies`** (a SELECT policy whose name ends `_publishable` = the `AuthzPublishable` derivation)
>    in this tenant's `app_public` schema, then GRANTs the `anonymous` role `SELECT` and extends that
>    policy's role list to include `anonymous`. RLS still filters to `is_published`, so anon sees **only
>    published rows**; the owner-write policies stay `authenticated`-only. A non-public app has zero such
>    policies → clean no-op. Runs for **any** non-`minimal` auth preset (public-read apps use `auth:email`).
>
> **B2B org grants + personal-org seed are now PLATFORM-NATIVE** (no reconcile): on the `b2b`/`full` preset
> the platform provisions the org-table GRANTs (`org_memberships` INSERT/UPDATE, `org_member_profiles`
> SELECT, the memberships-schema USAGE) + `create_entity` bit and self-seeds the per-actor personal-org sprt
> row on signup. See [gotchas.md](./gotchas.md) RLS-ORG-RECONCILE-001 / [platform-gaps.md](./platform-gaps.md)
> GAP-1b/1c (CLOSED 2026-06-15).

> **Search (was Phase 2.3.1) is optional** and lives in the **Optional Extensions** appendix of the slim
> SKILL.md — only add it if a table needs full-text / fuzzy / vector search. Skip it for a basic app.

**This completes Phase 2 (Data Model Provisioned).** Proceed to Phase 3
([phase-3-frontend-sdk.md](./phase-3-frontend-sdk.md)).

> **After the `2.1` and `2.3` gates pass (Rule 7):** update the run-state (workspace fields; then
> `packages.provision.*`, `database.name`, `database.subdomain`, `database.app_data_endpoint` /
> `app_auth_endpoint` per SUBDOMAIN-001, `auth.*_token_ref`; keep `notes[]` SDK-only — never describe a
> non-SDK provisioning path or the 2.3 gate hard-fails). Then `git commit` (tag `green-phase-2`).
