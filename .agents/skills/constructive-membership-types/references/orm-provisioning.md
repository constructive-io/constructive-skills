# ORM Provisioning for Entity Types

Direct entity type provisioning via the ORM — for cases where you want to provision entity types outside of blueprints.

## entity_type_provision (Trigger Table)

`entity_type_provision` is a **trigger table** — inserting a row fires a trigger that provisions the entire entity type (table, permissions, memberships, security). The INSERT returns the provisioning results.

### Create a new entity type

```typescript
const result = await db.entityTypeProvision.create({
  data: {
    databaseId: database_id,
    name: 'Channel Member',
    prefix: 'channel',
    description: 'Membership to a channel.',
    parentEntity: 'org',
    isVisible: true,
    hasLimits: false,
    hasProfiles: false,
    hasLevels: false,
    skipEntityPolicies: false,
  },
  select: {
    outMembershipType: true,
    outEntityTableId: true,
    outEntityTableName: true,
    outInstalledModules: true,
  },
}).execute();

// result:
// {
//   outMembershipType: 3,              // assigned type ID
//   outEntityTableId: '<uuid>',        // UUID of the channels table
//   outEntityTableName: 'channels',    // table name
//   outInstalledModules: [             // modules installed
//     'permissions_module:channel',
//     'memberships_module:channel',
//     'invites_module:channel'
//   ]
// }
```

### Field reference

| ORM Field | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `databaseId` | UUID | **Yes** | — | Target database |
| `name` | string | **Yes** | — | Human-readable name (e.g. `"Channel Member"`) |
| `prefix` | string | **Yes** | — | SQL prefix (e.g. `"channel"` → `channels` table) |
| `description` | string | No | `null` | Description of the entity type |
| `parentEntity` | string | No | `"org"` | Parent type prefix |
| `tableName` | string | No | `prefix + 's'` | Override entity table name |
| `isVisible` | boolean | No | `true` | Gates the default `parent_member` SELECT policy. **No-op when `tableProvision` is supplied.** See [Entity-Table Policies](#entity-table-policies-isvisible-skipentitypolicies-tableprovision) |
| `hasLimits` | boolean | No | `false` | Provision limits module |
| `hasProfiles` | boolean | No | `false` | Provision profiles module |
| `hasLevels` | boolean | No | `false` | Provision levels module |
| `skipEntityPolicies` | boolean | No | `false` | Escape hatch: apply zero default policies. See [Entity-Table Policies](#entity-table-policies-isvisible-skipentitypolicies-tableprovision) |
| `tableProvision` | object | No | `null` | Override for the entity table (nodes, fields, grants, policies). When supplied, `policies[]` **replaces** the 5 default entity-table policies. See [Entity-Table Policies](#entity-table-policies-isvisible-skipentitypolicies-tableprovision) |

## Entity-Table Policies (`isVisible`, `skipEntityPolicies`, `tableProvision`)

The entity table (e.g. `channels`) needs RLS policies so members can see / create / update / delete their own entities. Three fields decide what lands on the table:

### Decision matrix

| `skipEntityPolicies` | `tableProvision` | Result on the entity table |
|---|---|---|
| `false` (default) | `null` (default) | **5 defaults** (gated by `isVisible`) |
| `false` | object | **caller's `policies[]` only**; `isVisible` is a no-op |
| `true` | `null` | **0 policies** (escape hatch — you add them later) |
| `true` | object | **caller's `policies[]` only** |

**Mental model:** "defaults **OR** your overlay, never both." The presence of `tableProvision` means "I know what I'm doing, give me full control." `isVisible` only matters on the defaults path.

### The 5 default policies

When `tableProvision` is `null` and `skipEntityPolicies` is `false`:

| Default | Privilege | Summary |
|---|---|---|
| `self_member` | `SELECT` | Members of this entity can see it |
| `parent_member` | `SELECT` | Members of the **parent** entity can see it **— only when `isVisible: true`** |
| `admin_create` | `INSERT` | Parent members with `create_entity` permission can create one |
| `admin_update` | `UPDATE` | Entity admins can update |
| `admin_delete` | `DELETE` | Entity admins can delete |

### `tableProvision` shape

Same vocabulary as blueprint `tables[]` entries / `secure_table_provision`:

```typescript
const result = await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Data Room Member',
    prefix: 'data_room',
    parentEntity: 'org',
    tableProvision: {
      use_rls: true,
      nodes: [{ $type: 'DataTimestamps' }],
      fields: [{ name: 'topic', type: 'text' }],
      grant_privileges: [['select', '*'], ['insert', '*']],
      grant_roles: ['authenticated'],
      policies: [
        {
          $type: 'AuthzEntityMembership',
          data: { entity_field: 'id', entity_type: 'data_room' },
          privileges: ['select', 'update', 'delete'],
          name: 'self_member',
        },
        {
          $type: 'AuthzEntityMembership',
          data: { entity_field: 'owner_id', entity_type: 'org' },
          privileges: ['insert'],
          name: 'org_insert',
        },
      ],
    },
  },
  select: { outMembershipType: true, outEntityTableId: true },
}).execute();
```

| Field | Type | Default | Description |
|---|---|---|---|
| `use_rls` | boolean | `true` | Enable RLS on the entity table |
| `nodes` | array | `[]` | Data behavior nodes applied to the entity table (e.g. `DataTimestamps`) |
| `fields` | array | `[]` | Extra columns on the entity table |
| `grant_privileges` | array | inherited | Privilege tuples (e.g. `[["select","*"], ["insert","*"]]`) |
| `grant_roles` | string[] | `["authenticated"]` | Roles that receive the grants |
| `policies` | array | `[]` | Safegres policy definitions. When present, **fully replaces** the 5 defaults |

> **snake_case inside the object:** `tableProvision` is a JSONB payload, so its inner keys use snake_case (`grant_privileges`, `grant_roles`, `use_rls`) — the same convention as blueprint `tables[]` entries. The outer `tableProvision` key itself is camelCase because it's an ORM column name.

### When to use which

| Goal | Config |
|---|---|
| "Standard defaults" | leave all three fields at defaults |
| "Hide from parent members" | `isVisible: false` |
| "Custom fields/grants on the entity table (no custom policies)" | `tableProvision: { nodes, fields, grant_privileges }`. **Heads up:** because `tableProvision` is the override flag, this skips the 5 default policies too. If you want custom fields **and** defaults, also copy the 5 defaults into `tableProvision.policies[]` |
| "Completely different policy model" | `tableProvision: { policies: [...] }` |
| "I'll add policies later" | `skipEntityPolicies: true` |

### Output fields

| ORM Field | Type | Description |
|-----------|------|-------------|
| `outMembershipType` | integer | Assigned type ID (3, 4, 5, ...) |
| `outEntityTableId` | UUID | UUID of the created entity table |
| `outEntityTableName` | string | Name of the created entity table |
| `outInstalledModules` | string[] | Array of installed module names |

## CLI Equivalent

```bash
constructive public:entity-type-provision create \
  --databaseId <UUID> \
  --name "Channel Member" \
  --prefix "channel" \
  --description "Membership to a channel." \
  --parentEntity "org" \
  --isVisible true \
  --hasLimits false \
  --hasProfiles false \
  --hasLevels false \
  --skipEntityPolicies false \
  --select outMembershipType,outEntityTableId,outEntityTableName,outInstalledModules
```

## Nested Entity Types

Provision parent types first, then children:

```typescript
// 1. Provision channel (parent = org)
const channel = await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Channel Member',
    prefix: 'channel',
    description: 'Membership to a channel.',
    parentEntity: 'org',
  },
  select: { outMembershipType: true, outEntityTableName: true },
}).execute();
// channel.outMembershipType === 3

// 2. Provision thread (parent = channel)
const thread = await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Thread Member',
    prefix: 'thread',
    description: 'Membership to a thread.',
    parentEntity: 'channel',
  },
  select: { outMembershipType: true, outEntityTableName: true },
}).execute();
// thread.outMembershipType === 4
```

## provisionMembershipTable (SQL Function)

There is also a lower-level SQL function `provision_membership_table()` exposed via the ORM. It takes different parameters (integer `parentType` instead of string `parentEntity`):

```typescript
const result = await db.mutation.provisionMembershipTable({
  input: {
    vDatabaseId: dbId,
    vName: 'Channel',
    vPrefix: 'channel',
    vDescription: 'Membership to a channel.',
    vParentType: 2,        // org type (integer, not prefix string)
    vHasLimits: false,
    vHasProfiles: false,
    vHasLevels: false,
    vSkipEntityPolicies: false,
  },
}).execute();
```

**Prefer `entityTypeProvision`** over `provisionMembershipTable` — it uses string prefixes for parent types (more readable) and validates the parent exists.

## After Provisioning

Once a type is provisioned, run introspection + codegen to get typed SDK access to the new tables:

```bash
# Regenerate types from the updated schema
cnc codegen --database <db-name>
```

The new entity tables (`channels`, `channel_permissions`, etc.) will appear in the generated SDK like any other table.
