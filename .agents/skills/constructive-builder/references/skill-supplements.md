# Skill Supplements

Supplements for unclear or missing parts in skills. Agents should read this when executing the corresponding phase.

---

## Phase 2.3: Blueprint Provision Template (Recommended)

> **Blueprint is Constructive's declarative schema provisioning system.** Define a complete domain schema (tables, fields, relations, RLS policies, indexes, search) in TypeScript using typed `BlueprintDefinition` objects from `node-type-registry`, and create everything in a single execution via `constructBlueprint`.

The provision package lives at `packages/provision/` with **two scripts** — `create-db` (sign up + create database → writes `.env`) then `provision` (multi-pass schema orchestrator).

**The provision package is no longer inlined here — it lives as real, version-controlled template files** that `scripts/scaffold-provision.mjs` copies (substituting db-name / admin creds / endpoints from the app brief + `constructive.config.json`). Read the canonical source instead of a copy that can drift:

| File | Template (source of truth) |
| --- | --- |
| `config.ts` (centralized env config) | `scripts/templates/provision/config.ts` |
| `helpers.ts` (retry + SDK client factories) | `scripts/templates/provision/helpers.ts` |
| `blueprint.ts` (`provisionBlueprint()` engine) | `scripts/templates/provision/blueprint.ts` |
| `create-db.ts` (Step 1: sign up + create DB → `.env`) | `scripts/templates/provision/create-db.ts` |
| `provision.ts` (Step 2: multi-pass orchestrator) | `scripts/templates/provision/provision.ts` |
| `package.json` (deps + the two scripts) | stamped by `scripts/scaffold-provision.mjs` |

> **Drift note:** these pointers are the SoT — do NOT re-paste the file bodies here. `scripts/check-scaffold.mjs` (run via `pnpm check:scaffold`) asserts every `scripts/templates/provision/*` path referenced above resolves to a real file AND dry-runs the generator, so a renamed/removed template fails the canary instead of silently rotting this doc. The provision-PASS structure / topology lives in `provision.ts`; the imperative `secureTableProvision` alternative is kept below as a genuine fallback.

#### Org-flow extension (the org counterpart to the users self-update step)

> **If the flow provisions org/b2b modules (`organization` / `org-members` / `org-roles` /
> `org-invites` / `app-memberships`), the reconciled recipe above is NOT enough.** The users
> self-update control-plane step (RLS-USERS-UPDATE-001) + the `app_public` blueprint grants cover the
> basic `auth:email` flows, but the **org-\*** flows write **module-owned** org tables and gate org
> creation on an **app-permission bit** that the basic recipe never sets. After provisioning a b2b
> flow, ALSO apply the following — this is the org analogue of the users self-update reconciliation:
>
> 1. **Grant the `create_entity` app-permission bit to the test actor (else org create is RLS-denied).**
>    Org creation requires the actor to hold the **`create_entity`** permission bit — **bit 5 = `0x20`
>    = decimal `32`** — OR be created as `createUser(type=2)`. Without it, `OrgCreateCard` /
>    `createUser(type=2)` fails RLS even though auth works. Grant that bit to the actor's app membership
>    after provisioning. ⚠️ **Verify the exact permission-grant mutation/field and the bit value against
>    the `constructive-security` skill** before wiring it — do not hand-roll a permissions UPDATE from
>    memory; the bit is `0x20` but the mutation surface is platform-owned.
> 2. **INSERT (and UPDATE) grant to `authenticated` on the module-owned tenant `users` table.** Org flows
>    create org rows in the unified user model (`users` with `type=2`), so `authenticated` needs INSERT
>    (and UPDATE) on the per-tenant `users` table — the dynamic provisioner does not emit it (same class
>    as the missing self-update policy). Add it via the SAME `createSecureTableProvision` control-plane
>    path used for the self-update policy above (resolve `users_public` schema/table id by
>    `config.databaseId`), carrying an INSERT/UPDATE grant to `authenticated`.
> 3. **Reconcile the module-owned org tables the org blocks write:** `org_memberships` needs INSERT +
>    UPDATE, and `org_member_profiles` needs SELECT, for `authenticated`/org members. Add the
>    grants/policies for these via `createSecureTableProvision` (resolve each table's schema/table id the
>    same way) so members-list / role-change / invite-accept round-trip.
>
> The `organization` / `org-members` / `org-roles` flows PASSED the fan-out only because the agents
> discovered (1)–(3) **app-side**; bake them into the provision step for b2b flows so the next agent
> doesn't re-derive them. **Where the precise mutation/SQL is not certain (esp. the `create_entity`
> grant and the org-table policy shapes), document the REQUIREMENT + the bit value here and verify the
> exact call against the `constructive-security` skill — do NOT invent a snippet that might be wrong.**
> Frame this as the org counterpart to RLS-USERS-UPDATE-001 (see gotchas.md).
>
> **NOW PLATFORM-NATIVE (no reconcile step):** the platform provisions (a) the `create_entity` bit
> (bit 5 = `0x20`), (b) the `org_memberships` INSERT/UPDATE + `org_member_profiles` SELECT grants, and
> (c) the personal-org row in `<db>-memberships-private.org_memberships_sprt` (actor_id = entity_id =
> user_id) — the row the `AuthzEntityMembership` RLS actually reads — automatically on signup
> (platform-gaps.md GAP-1b/1c, CLOSED 2026-06-15). A fresh signup's `createCompany(entityId = their user
> id)` therefore persists immediately; there is no provision-time appendix or standalone reconcile script
> anymore. The recipe above is retained only as the historical control-plane form for a deployment that
> predates the platform fix. Note (c) was the **direct cause** of the old create-rejection (the
> AFTER-INSERT trigger on `org_memberships` only populates the sprt when an `app_memberships_sprt` parent
> exists, which a bare signup lacked — the platform now seeds it).

### Schema Module: schemas/core.ts (GENERATED — not a template)

`schemas/core.ts` is the heart of the provision package: a typed `BlueprintDefinition` (tables → fields → relations → RLS policies → grants → indexes → FTS). It is **GENERATED from the app brief** by `scripts/scaffold-provision.mjs` (`emitCoreTs()`), NOT copied from a static template — so the authoritative description of what it contains is the brief grammar + the generator, not a hand-maintained snippet that drifts from them:

- **What goes in it / how each table maps:** `references/brief-grammar.md` (the brief is the SoT) and the emitter in `scripts/scaffold-provision.mjs`.
- **Per-field / per-policy / per-relation vocabulary:** the type catalogs below (Common Node Types / Common Policy Types / Common Relation Types / Common Field Types).
- **What a real emitted `core.ts` looks like:** scaffold any brief (e.g. `fixtures/golden-app-brief.yaml`) with `scripts/scaffold-provision.mjs` and read the emitted `packages/provision/src/schemas/core.ts`.
- **A second pass (`schemas/search.ts`)** is added only when the brief declares search; the generator emits it the same way and `provision.ts` runs it as a later pass.

> **Drift note:** `scripts/check-scaffold.mjs` (`pnpm check:scaffold`) dry-runs `emitCoreTs()` on the frozen canary + divergent briefs and asserts the emitted blueprint is structurally equivalent to the reference — that is the live contract for `core.ts`, replacing the old inline example.

### Common Node Types

The full node-type catalog is in [`constructive-blueprints` → references/node-type-registry.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-blueprints) (source of truth) — consult it rather than relying on this excerpt. The few rows below are the ones used most in a basic app, plus the build-flow-specific DataId prereq.

| Node Type | Purpose | Added Fields |
|-----------|---------|--------------|
| `DataEntityMembership` | Entity-level membership + id (pairs with `AuthzEntityMembership`) | `id`, `entity_id` |
| `DataOwnershipInEntity` | Entity ownership + owner tracking | `id`, `entity_id`, `owner_id` |
| `DataDirectOwner` | Direct per-user ownership (pairs with `AuthzDirectOwner`) | `owner_id` **only — no `id`/PK** |
| `DataTimestamps` | Timestamps (use `include_id: false` when composing) | `created_at`, `updated_at` |
| `DataId` | Just adds `id` (UUID primary key) | `id` |
| `SearchUnified` | Multi-strategy search (tsvector, BM25, trgm, pgvector) | Depends on config |
| `DataSoftDelete` | Soft delete | `deleted_at` |
| `DataTags` | Tag array | `tags citext[]` + GIN index |
| `DataEmbedding` | Vector embedding | embedding + HNSW index |

> **DataId prereq for full CRUD (build-flow-specific, F18):** a row needs an `id` primary key for the API
> to expose update/delete. `DataEntityMembership` / `DataOwnershipInEntity` carry `id` already, but
> `DataDirectOwner` adds **only `owner_id`** (no PK) — so for an owner-scoped table that needs full CRUD,
> **prepend `DataId`**: `nodes: ['DataId', 'DataDirectOwner', …]`. Without it the API exposes only
> create + list.

### Common Policy Types

See [`constructive-security` → references/authz-types.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-security) for all 18 Authz* types and their config keys. Most-used in a basic app:

| Policy Type | Purpose | Config key |
|-------------|---------|------------|
| `AuthzDirectOwner` | Users can only access rows they own — **the default for a basic (org-less) app** | `entity_field` (`'owner_id'`) |
| `AuthzAllowAll` | All authenticated users share one pool (no ownership) | — |
| `AuthzEntityMembership` | Org/b2b tenancy — **requires the `b2b` org modules; aborts constructBlueprint on `auth:email`** | `entity_field` (`'entity_id'`), `membership_type` |
| `AuthzAppMembership` | App-level membership gate (hardcoded `membership_type=1`) — silently denies all CRUD until the actor's app_membership is approved+active | optional `permission`/`is_admin` |

> 🚨 **Do NOT default to `AuthzEntityMembership` + `membership_type: 2` on a basic app.** With no
> org/b2b/memberships modules provisioned, `constructBlueprint` FAILS HARD with
> `NOT_FOUND (memberships_module)` and the table is never created — not a silent 0-row. Use
> `AuthzDirectOwner` (owner-scoped) or `AuthzAllowAll` (shared); reserve `AuthzEntityMembership` for the
> `b2b` preset. See gotchas RLS-POLICY-001.

> **`AuthzDirectOwner` config key is `entity_field`, not `owner_field`** (its value is the owner column,
> `'owner_id'`). `owner_field` belongs to `AuthzMemberOwner` / `AuthzPeerOwnership` /
> `AuthzRelatedPeerOwnership` / `AuthzOrgHierarchy` — see `constructive-security` authz-types.md. Using
> `owner_field` with `AuthzDirectOwner` triggers `MISSING_REQUIRED_FIELD`.

### Common Relation Types

| Relation Type | Key Fields | Purpose |
|---------------|------------|---------|
| `RelationBelongsTo` | `source_table`, `target_table`, `delete_action`, `is_required` | Many-to-one (FK in source table) |
| `RelationHasMany` | `source_table`, `target_table`, `delete_action` | One-to-many (FK in target) |
| `RelationHasOne` | `source_table`, `target_table`, `delete_action` | One-to-one (FK + unique) |
| `RelationManyToMany` | `source_table`, `target_table` + junction config | Many-to-many (junction table) |

Relations reference tables by name using `source_table` / `target_table`.

> **`deleteAction` and `isRequired` pairing:**
>
> | `delete_action` | `is_required` | Notes |
> |----------------|--------------|-------|
> | `'n'` (SET NULL) | **Must be** `false` | Otherwise FK field is NOT NULL, SET NULL fails |
> | `'c'` (CASCADE) | `true` or `false` | Based on business requirements |
> | `'r'` (RESTRICT) | Usually `true` | Must remove association before delete |

### .env.example (put in workspace root)

```bash
# Set by create-db (do not edit manually)
DATABASE_ID=
DATABASE_NAME=myapp
ACCESS_TOKEN=
OWNER_ID=          # signup userId — used as the blueprint owner (users == orgs); F7

# Postgres (set via: eval "$(pgpm env)")
PGUSER=
PGHOST=
PGPASSWORD=
PGDATABASE=        # `pgpm env` sets this to `postgres` — but tenant/metaschema SQL must hit the hub db
                   # `constructive` (app schemas live inside it). provision.ts uses config.pgDatabase
                   # (default 'constructive') for its Pools; PGDATABASE=postgres is the WRONG db for them.
PGPORT=
# PG_HUB_DATABASE=constructive   # override only if your physical hub db is named differently

# Override API endpoints (optional)
# API_ENDPOINT=http://api.localhost:3000/graphql       # metaschema READS only
# MODULES_ENDPOINT=http://modules.localhost:3000/graphql # provisioning + blueprint WRITES (F4)
# AUTH_ENDPOINT=http://auth.localhost:3000/graphql

# Admin credentials
ADMIN_EMAIL=admin@myapp.local
ADMIN_PASSWORD=Password123!
```

---

## Phase 2.3: Provision Script Template (Imperative via secureTableProvision — Fallback)

> **Use this approach ONLY when blueprints don't work for your use case** (e.g., fine-grained control over individual tables). The blueprint approach above is strongly preferred.

The `secureTableProvision` approach creates a table with RLS, grants, and policies in a single call. The input is the **Blueprint shape** — four independent, optional arrays (`nodes[]` / `fields[]` / `grants[]` / `policies[]`) plus `useRls`, mirroring the blueprint table definition. **The flat `nodeType` / `grantRoles` / `grantPrivileges` / `policyType` / `policyPermissive` / `policyData` / `nodeData` shape is stale** and no longer matches the live platform — the generated `CreateSecureTableProvisionInput` exposes only `nodes` / `fields` / `grants` / `policies` / `useRls`. Do not duplicate the API here — the canonical reference (input shape, casting rules, paired Data/Authz nodes) is [`constructive-security` → SKILL.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-security) (`secureTableProvision (Recommended)`) and [`constructive-data-modeling` → SKILL.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-data-modeling) (`Tables`).

> **Build-flow-specific (not in the skill):** the write endpoint is `modules.localhost:3000/graphql`. `secureTableProvision` / `field` / `relationProvision` live ONLY on `modules.localhost` — they 404 on `api.localhost` (api is metaschema **reads only**). See gotchas PROVISION-001 / F4.

```typescript
import { public_ } from '@constructive-io/sdk';

// Create SDK client (reuse createModulesClient from helpers.ts in the blueprint approach).
const sdk = public_.createClient({
  endpoint: 'http://modules.localhost:3000/graphql',
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

// Create a table with RLS + grants + policy in one call (Blueprint shape — see constructive-security).
// nodes/grants/policies are typed as a single Record<string, unknown>, so each array literal needs
// `as unknown as Record<string, unknown>`. fields[] is already an array type — no cast.
const result = await sdk.secureTableProvision.create({
  data: {
    databaseId,
    tableName: 'boards',
    useRls: true,
    // nodes[]: one entry per Data* field module. DataId adds the `id` PK; DataDirectOwner adds
    // `owner_id` + FK to the tenant users table (owner-scoped default — see RLS-POLICY-001).
    nodes: [
      { $type: 'DataId' },
      { $type: 'DataDirectOwner' },
      { $type: 'DataTimestamps', data: { include_id: false } },
    ] as unknown as Record<string, unknown>,
    // grants[]: each entry = roles + a list of [privilege, columns] tuples ('*' = all columns).
    grants: [
      { roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] },
    ] as unknown as Record<string, unknown>,
    // policies[]: one entry per Authz* policy, discriminated by $type. Owner-scoped default.
    // Do NOT default to AuthzEntityMembership + membership_type: 2: on an org-less app it
    // aborts with NOT_FOUND (memberships_module) and the table is never created. Use that only
    // when the `b2b` org modules are provisioned. See gotchas RLS-POLICY-001.
    policies: [
      {
        $type: 'AuthzDirectOwner',
        permissive: true,
        privileges: ['select', 'insert', 'update', 'delete'],
        data: { entity_field: 'owner_id' },
      },
    ] as unknown as Record<string, unknown>,
    // fields[]: explicit columns (snake_case). type accepts a FieldType object or a legacy bare string.
    fields: [
      { name: 'name', type: { name: 'text' }, is_required: true },
    ],
  },
  select: { id: true, tableId: true, outFields: true },
}).unwrap();

const tableId = result?.createSecureTableProvision?.secureTableProvision?.tableId;

// Add relations
await sdk.relationProvision.create({
  data: {
    databaseId,
    relationType: 'RelationBelongsTo',
    sourceTableId: listsTableId,
    targetTableId: boardsTableId,
    deleteAction: 'c',  // CASCADE
  },
  select: { id: true },
}).unwrap();
```

### Common Field Types

> 🚨 **Blueprint field shapes are OBJECTS, not bare strings (F5 — see VERIFICATION-FINDINGS.md).**
> In a `BlueprintField` (the `fields:[]` of a `createBlueprint`/`constructBlueprint` definition),
> `type` is a **FieldType object** `{ name: '<type>' }` and any default is a **FieldDefault object**
> `{ value: <literal> }`. Bare strings like `type: 'text'`, `type: 'bool'`, or `default_value: 'false'`
> are **rejected**. Also note the boolean type name is **`boolean`**, not `bool`.
>
> ```typescript
> // ✅ correct (blueprint field)
> { name: 'title',     type: { name: 'text' },    is_required: true }
> { name: 'done',      type: { name: 'boolean' }, default: { value: false } }
> { name: 'priority',  type: { name: 'int4' },    default: { value: 0 } }
> // ❌ wrong — bare strings / wrong type name / wrong default key
> { name: 'title', type: 'text' }
> { name: 'done',  type: 'bool', default_value: 'false' }
> ```
>
> (The imperative `sdk.field.create({ data: { type, isRequired } })` fallback below is a *different*
> API surface — the flat SDK mutation — and is not the blueprint shape. Prefer blueprints.)

The `name` for the FieldType object (`type: { name: '<below>' }`):

| `type.name` | Description | Example default (`default: { value: … }`) |
|-------------|-------------|--------------------------------------------|
| `text` | Text | `{ value: 'todo' }` |
| `int4` | Integer | `{ value: 0 }` |
| `boolean` | Boolean (NOT `bool`) | `{ value: false }` |
| `uuid` | UUID | — |
| `timestamptz` | Timestamp | — |
| `jsonb` | JSON | `{ value: {} }` |

### Common Relation Types

| Type | Description | deleteAction |
|------|-------------|--------------|
| `RelationBelongsTo` | Many-to-one (FK in source) | `'c'` CASCADE / `'r'` RESTRICT / `'n'` SET NULL |
| `RelationHasMany` | One-to-many (FK in target) | Same as above |
| `RelationHasOne` | One-to-one (FK + unique) | Same as above |
| `RelationManyToMany` | Many-to-many (junction table) | Not required |

> ⚠️ **Must Read: `deleteAction` and `isRequired` Pairing Rules**
>
> | `deleteAction` | `isRequired` | Description |
> |----------------|--------------|-------------|
> | `'n'` (SET NULL) | **Must be** `false` | Otherwise SDK generates required field, passing null throws `Invalid UUID` |
> | `'c'` (CASCADE) | `true` or `false` | Based on business requirements |
> | `'r'` (RESTRICT) | Usually `true` | Must remove association before delete |
>
> **Wrong Example:**
> ```typescript
> // ❌ Missing isRequired: false
> await publicDb.relationProvision.create({
>   data: { deleteAction: 'n' },  // SET NULL but field is NOT NULL!
>   ...
> })
> ```
>
> **Correct Example:**
> ```typescript
> // ✅ SET NULL must be paired with isRequired: false
> await publicDb.relationProvision.create({
>   data: {
>     deleteAction: 'n',
>     isRequired: false,  // <- Must add!
>   },
>   ...
> })
> ```

---

## Phase 3: constructive-frontend (CRUD Stack) Supplement

The CRUD Stack cards (Create / Edit / List) and the dynamic meta-form machinery are **real template files** that `scripts/scaffold-frontend.mjs` stamps per entity (deriving fields, testids, FK pickers from the brief) — they are no longer inlined here. Read the canonical source instead of a copy that can drift:

| Surface | Template (source of truth) |
| --- | --- |
| Per-entity CRUD page (Create + List + Edit wired) | `scripts/templates/frontend/entity-page.tsx` |
| Dynamic form card (Create/Edit body) | `scripts/templates/frontend/crud/dynamic-form-card.tsx` |
| Dynamic field + field renderer | `scripts/templates/frontend/crud/dynamic-field.tsx`, `scripts/templates/frontend/crud/field-renderer.ts` |
| Relation manager (M:N / FK relation UI) | `scripts/templates/frontend/crud/relation-manager.tsx` |
| Meta-form hook + types | `scripts/templates/frontend/crud/use-meta.ts`, `scripts/templates/frontend/crud/meta-types.ts` |
| Auth pages (sign-in / sign-up) | `scripts/templates/frontend/auth-page.tsx` |

> **Drift note:** these pointers are the SoT — do NOT re-paste the card bodies here. `scripts/check-scaffold.mjs` (`pnpm check:scaffold`, via the bundled `check-frontend-scaffold.mjs`) asserts every `scripts/templates/frontend/*` path referenced above resolves AND dry-runs the frontend emitter (e.g. the required-FK fixture's picker testid + camelCase FK key), so a renamed/removed template fails the canary instead of silently rotting this doc. The relation-UI PRINCIPLES (when to use which approach) are kept below as genuine guidance.

## Relation Fields UI (Principles)

> **Must check relation definitions in provision script before starting Phase 3.**

### Inspection Steps

1. **Read provision script** -> Find all `relationProvision.create()` calls
2. **List relations** -> e.g., `notes -> folders`, `cards -> lists`
3. **Think about UI** -> What interaction does each relation need?

### Relation Types -> UI Approach

| Relation Type | Considerations |
|---------------|----------------|
| `RelationBelongsTo` (many-to-one) | Create/Edit needs parent entity selection (dropdown?) |
| `RelationHasMany` (one-to-many) | Show child list on parent detail page? |
| `RelationManyToMany` | Multi-select? Tags? |

### Don'ts

- ❌ Copy template code directly
- ❌ Ignore relation definitions in provision
- ❌ Only do basic fields, miss relation fields

### Dos

- ✅ Analyze table structure and relations in provision script first
- ✅ Design UI interactions for each relation
- ✅ Include relation fields in queries (e.g., `folderId`)
- ✅ Consider whether to show related info on list pages

---

## constructive-data-modeling Supplement

### orderBy Only Supports Indexed Fields

The generated `XxxOrderBy` enum **only includes indexed fields**. Defaults are:

```typescript
'NATURAL' | 'PRIMARY_KEY_ASC' | 'PRIMARY_KEY_DESC' | 'ID_ASC' | 'ID_DESC'
```

**Wrong Examples:**
```typescript
// ❌ POSITION_ASC doesn't exist (unless position field is indexed)
orderBy: ['POSITION_ASC', 'ID_ASC']

// ❌ CREATED_AT_DESC doesn't exist (unless created_at is indexed)
orderBy: ['CREATED_AT_DESC']
```

**Correct Approach:**
```typescript
// ✅ ID_ASC is always available, and UUID is time-ordered
orderBy: ['ID_ASC']
```

**If other sorting is needed:** Add index in provision, then re-run codegen.

### SDK Nullable Field Handling

SDK returned fields are usually `string | null | undefined`. Handle when passing to state:

```typescript
// ❌ May throw error
const [name, setName] = useState(data.board.name);

// ✅ Handle with ?? ''
const [name, setName] = useState(data.board.name ?? '');
```

### Update Mutation Patch Naming

Update mutation's patch parameter name is `${entity}Patch`:

```typescript
// Board → boardPatch
await updateMutation.mutateAsync({
  id: boardId,
  boardPatch: { name, description },
});

// List → listPatch
await updateMutation.mutateAsync({
  id: listId,
  listPatch: { name, position },
});

// Card → cardPatch
await updateMutation.mutateAsync({
  id: cardId,
  cardPatch: { title, description },
});
```

### Query Hook Parameter Format

Generated query hooks have specific parameter structures:

**List query (useBoardsQuery):**
```typescript
// ✅ Correct - selection contains fields + where + orderBy
useBoardsQuery({
  selection: {
    fields: { id: true, name: true },
    where: { entityId: { equalTo: entityId } },
    orderBy: ['ID_ASC'],
  },
  enabled: !!entityId,  // <- At top level, not options: { enabled }
});
```

**Single query (useBoardQuery):**
```typescript
// ✅ Correct - id at top level, selection only has fields
useBoardQuery({
  id: boardId,
  selection: { fields: { id: true, name: true } },
  enabled: isReady,  // <- At top level
});
```

---

## Next.js app Supplement (boilerplates moved out — see the constructive-io/constructive repo)

### Getting Current User

The template provides two ways to get user information:

**Method 1: useAuth (local store, recommended for getting entityId)**
```typescript
import { useAuth } from '@/store/app-store';

const auth = useAuth();
const entityId = auth.user?.id ?? '';
const isAuthenticated = auth.isAuthenticated;
```

**Method 2: useCurrentUser (GraphQL API, for detailed info)**
```typescript
import { useCurrentUser } from '@/lib/gql/hooks/admin/app';

const { user, isLoading } = useCurrentUser({});
```

> **Note**: `useAuthStore` doesn't exist! Don't import from `@/store/auth-slice`.

### Homepage Replacement

Use `Write` to overwrite `src/app/page.tsx` directly, no need to read existing file:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/auth/auth-context';
import { LoginScreen } from '@/components/auth/screens/login-screen';

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { isAuthenticated, isLoading, login } = useAuthContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isLoading && isAuthenticated) {
      router.push('/boards');  // <- Change to your main route
    }
  }, [mounted, isLoading, isAuthenticated, router]);

  if (!mounted || isLoading || isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-transparent" />
      </div>
    );
  }

  return <LoginScreen onLogin={login} />;
}
```

### Adding New Route Checklist

When adding a new feature route, update 3 places:

1. **Create page file**: `src/app/<feature>/page.tsx`
2. **Register route**: `src/app-routes.ts` add route configuration
3. **Add navigation**: `src/lib/navigation/sidebar-config.ts` add sidebar link

```typescript
// app-routes.ts
export const APP_ROUTES = {
  // ... existing routes
  BOARDS: {
    path: '/boards' as Route,
    searchParams: {},
    access: 'protected' as RouteAccessType,
    context: 'app' as SchemaContext,
  },
};

// sidebar-config.ts - Add in mainItems of getRootNavigation
const mainItems: NavItem[] = [
  {
    id: 'boards',
    label: 'Boards',
    icon: RiLayoutGridLine,  // Import from @remixicon/react
    href: '/boards',
    isActive: isRouteActive?.('BOARDS'),
  },
  // ... existing items
];
```

---

## Common Imports Quick Reference

```typescript
// UI Components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Stack
import { useCardStack, useCardReady } from '@/components/ui/stack';
import type { CardComponent } from '@/components/ui/stack';

// Auth (correct import methods)
import { useAuth } from '@/store/app-store';           // <- Get auth state
import { useAuthContext } from '@/lib/auth/auth-context'; // <- Get login/logout methods
import { useCurrentUser } from '@/lib/gql/hooks/admin/app'; // <- Get detailed user info

// SDK (change to your entity)
import {
  useBoardsQuery,
  useBoardQuery,
  useCreateBoardMutation,
  useUpdateBoardMutation,
  useDeleteBoardMutation,
} from '@sdk/app';

// Icons (remixicon)
import { RiLayoutGridLine, RiSettings3Line, RiAddLine } from '@remixicon/react';

// Icons (lucide-react) - also available
import { Plus, Settings, Trash2, Edit, Layout } from 'lucide-react';
```

---

## Phase 3: Adding Routes + Sidebar (done by the scaffolder)

Registering an entity's route in `app-routes.ts` and its link in `sidebar-config.ts` is performed by the harness, not by hand-pasting snippets: `scripts/scaffold-frontend.mjs` / `scripts/wire-app.mjs` edit those two files (deriving the path/label/icon from the brief). The concrete edit snippets are no longer inlined here — read the emitters (and the "Adding New Route Checklist" above for the manual procedure if you must do it by hand):

- **Route registration** (`src/app-routes.ts`) and **sidebar link** (`src/config/sidebar-config.ts`): emitted/edited by `scripts/scaffold-frontend.mjs` (see also `scripts/wire-app.mjs`).
- **Icons:** any Remixicon (`ri*`) name; the scaffolder picks a default per entity.

> **Drift note:** `scripts/check-scaffold.mjs` (`pnpm check:scaffold`) asserts the `scripts/scaffold-frontend.mjs` / `scripts/wire-app.mjs` emitters referenced here resolve, and the bundled `check-flow-surfaces.mjs` verifies every emitted route is reachable — replacing the old hand-paste snippets.

