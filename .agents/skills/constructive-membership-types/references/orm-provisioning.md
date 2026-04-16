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
| `isVisible` | boolean | No | `true` | Parent members can see children |
| `hasLimits` | boolean | No | `false` | Provision limits module |
| `hasProfiles` | boolean | No | `false` | Provision profiles module |
| `hasLevels` | boolean | No | `false` | Provision levels module |
| `skipEntityPolicies` | boolean | No | `false` | Skip default RLS policies |

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
