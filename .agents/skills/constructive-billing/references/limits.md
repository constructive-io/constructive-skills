
# Constructive Limits (SDK Guide)

The limits system provides usage metering, feature gating, and quota enforcement. Everything is configured through **blueprints** (Limit* nodes) and managed via the **ORM**.

Three blueprint nodes cover all limit enforcement:
- **`LimitCounter`** — per-user metered limits (e.g. "each user can create 10 projects")
- **`LimitAggregate`** — per-entity aggregate limits (e.g. "this org can have 50 seats total")
- **`LimitFeatureFlag`** — boolean feature gates (e.g. "analytics is enabled for this org")

Related skills:
- **`constructive-sdk-billing`**: Billing meters, universal credits, billing provider bridge
- **`constructive-sdk-events`**: Achievement rewards grant `limit_credits` when levels are achieved
- **`constructive-platform`**: Blueprint provisioning overview
- **`entity-types-and-provisioning`**: Entity types and `membership_types` in blueprints
- **`constructive-db-limits`**: SQL-level architecture reference (internal implementation)

---

## Prerequisites

The limits module must be provisioned on the database before Data* nodes can be used. This happens automatically when the database is created with `limits_module` in its modules list.

Limits are provisioned per-scope via `membership_types` in a blueprint:

```json
{
  "membership_types": [
    {
      "name": "Organization Member",
      "prefix": "org",
      "parent_entity": "app",
      "has_limits": true
    }
  ]
}
```

Setting `has_limits: true` provisions the limits module for that entity scope (creates the limits tables, aggregate tables, caps tables, and all enforcement functions).

The built-in `app` (type 1) and `org` (type 2) scopes get limits automatically when the database is provisioned with `["limits_module", {"scope": "app"}]` and `["limits_module", {"scope": "org"}]`.

---

## Blueprint Nodes

### 1. Per-user limit tracking (LimitCounter)

Add `LimitCounter` to a table's `nodes` array to enforce per-user usage limits:

```json
{
  "tables": [{
    "table_name": "projects",
    "fields": [
      { "name": "title", "type": { "name": "text" } },
      { "name": "owner_id", "type": { "name": "uuid" } }
    ],
    "nodes": [
      "DataId",
      "DataTimestamps",
      {
        "$type": "LimitCounter",
        "data": {
          "limit_name": "projects",
          "scope": "app",
          "actor_field": "owner_id",
          "events": ["INSERT", "DELETE"]
        }
      }
    ]
  }]
}
```

**What this does:** On INSERT, checks if the `owner_id` user has hit their `projects` limit. If under max, increments the counter. If over, rejects the insert. On DELETE, decrements automatically.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit_name` | text | *(required)* | Name of the limit (must match a `limitDefault` entry) |
| `scope` | text | `'app'` | Membership type prefix — supports any provisioned type (e.g. `'app'`, `'org'`, `'data_room'`, `'channel'`, `'team'`). Resolved dynamically via `memberships_module`. |
| `actor_field` | text | `'owner_id'` | Field on the table holding the user ID |
| `entity_field` | text | — | Column holding (or referencing) the entity_id. For FK lookups, combine with `entity_lookup`. |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK rather than a direct entity_id. |
| `events` | text[] | `['INSERT', 'DELETE']` | DML events: `INSERT`, `DELETE`, `UPDATE` |

**Behavior per event:**
- `INSERT` — BEFORE trigger: checks limit, increments counter. Rejects if over max.
- `DELETE` — AFTER trigger: decrements counter.
- `UPDATE` — BEFORE trigger: if `actor_field` changes, decrements old actor and increments new.

---

### 2. Aggregate entity-level tracking (LimitAggregate)

Add `LimitAggregate` to enforce total usage across an entire entity (org, database, team):

```json
{
  "tables": [{
    "table_name": "seats",
    "fields": [
      { "name": "user_id", "type": { "name": "uuid" } },
      { "name": "entity_id", "type": { "name": "uuid" } }
    ],
    "nodes": [
      "DataId",
      "DataTimestamps",
      {
        "$type": "LimitAggregate",
        "data": {
          "limit_name": "seats",
          "entity_field": "entity_id",
          "events": ["INSERT", "DELETE"]
        }
      }
    ]
  }]
}
```

**What this does:** On INSERT, checks if the org (identified by `entity_id`) has hit its total `seats` quota. If under max, increments the aggregate counter. If over, rejects. On DELETE, decrements. No per-user tracking — this counts total rows per entity.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit_name` | text | *(required)* | Name of the aggregate limit |
| `scope` | text | `'org'` | Membership type prefix — supports any provisioned type (e.g. `'org'`, `'data_room'`, `'channel'`, `'team'`). Resolved dynamically via `memberships_module`. |
| `entity_field` | text | `'entity_id'` | Column holding (or referencing) the entity_id. For FK lookups, combine with `entity_lookup`. |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK. |
| `events` | text[] | `['INSERT', 'DELETE']` | DML events: `INSERT`, `DELETE`, `UPDATE` |

**Behavior per event:**
- `INSERT` — BEFORE trigger: checks aggregate limit, increments. Rejects if entity is over max.
- `DELETE` — AFTER trigger: decrements aggregate counter.
- `UPDATE` — BEFORE trigger: if `entity_field` changes, decrements old entity, increments new.

**Key difference from LimitCounter:**
- `LimitCounter` — "Can user Y do this?" (keyed on user + entity)
- `LimitAggregate` — "Has entity Z hit its quota?" (keyed on entity only)

---

### 3. Feature flag gates (LimitFeatureFlag)

Add `LimitFeatureFlag` to gate an entire table behind a boolean feature toggle:

```json
{
  "tables": [{
    "table_name": "analytics_reports",
    "fields": [
      { "name": "entity_id", "type": { "name": "uuid" } },
      { "name": "report_data", "type": { "name": "jsonb" } }
    ],
    "nodes": [
      "DataId",
      "DataTimestamps",
      {
        "$type": "LimitFeatureFlag",
        "data": {
          "feature_name": "enable_analytics",
          "scope": "org",
          "entity_field": "entity_id"
        }
      }
    ]
  }]
}
```

**What this does:** Before any INSERT, resolves the cap value for `enable_analytics` for the given `entity_id`. If disabled (0), rejects with `FEATURE_DISABLED`. No counters — purely boolean on/off.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `feature_name` | text | *(required)* | Cap name (must exist in caps defaults) |
| `scope` | text | `'app'` | Membership type prefix — supports any provisioned type (e.g. `'app'`, `'org'`, `'data_room'`, `'channel'`, `'team'`). Resolved dynamically via `memberships_module`. |
| `entity_field` | text | `'entity_id'` | Column holding (or referencing) the entity_id. For FK lookups, combine with `entity_lookup`. |
| `entity_lookup` | object | — | FK lookup config: `{ obj_table, obj_schema?, obj_field }`. Resolves entity_id through a related table when `entity_field` is a FK. |

**Resolution:** `COALESCE(per-entity override, scope default, 0)` — if result is 0 or less, raises `FEATURE_DISABLED`.

---

### Entity Lookup (FK-based entity resolution)

When the target table doesn't have `entity_id` directly but references it through a FK, use `entity_lookup`:

```json
{
  "$type": "LimitAggregate",
  "data": {
    "limit_name": "messages",
    "scope": "data_room",
    "entity_field": "channel_id",
    "entity_lookup": {
      "obj_table": "channels",
      "obj_field": "entity_id"
    }
  }
}
```

This generates a trigger that does `SELECT channels.entity_id FROM channels WHERE channels.id = NEW.channel_id` at runtime, baked as a static SQL join (resolved at provision time, not dynamic SQL).

| Field | Required | Description |
|-------|----------|-------------|
| `obj_table` | yes | Related table name (e.g. `"channels"`) |
| `obj_schema` | no | Schema name (e.g. `"public"`). Omit to auto-resolve within the same database. |
| `obj_field` | yes | Column on the related table holding entity_id (e.g. `"entity_id"`) |

All Limit*, Event*, and Billing* generators support `entity_lookup`. The schema is validated against metaschema at provision time.

---

### Type 3+ Scopes (custom entity types)

The `scope` parameter now supports any provisioned membership type, not just `'app'` and `'org'`. If your blueprint has custom entity types:

```json
{
  "membership_types": [
    { "name": "Data Room Member", "prefix": "data_room", "has_limits": true },
    { "name": "Channel Member", "prefix": "channel", "has_limits": true }
  ]
}
```

Then you can scope limits to those entities:

```json
{ "$type": "LimitCounter", "data": { "limit_name": "files", "scope": "data_room" } }
{ "$type": "LimitAggregate", "data": { "limit_name": "total_docs", "scope": "data_room" } }
{ "$type": "LimitFeatureFlag", "data": { "feature_name": "enable_sharing", "scope": "channel" } }
```

The scope prefix is resolved dynamically via `memberships_module` at provision time to the corresponding `membership_type` integer.

---

## Managing Limits via ORM

All limits tables are exposed via the generated ORM. Prefix is `app` for app-scope or `org` for org-scope.

### Setting Default Maximums

Every named limit needs a default max. When a user first hits a limit, the system lazy-initializes their row from this default.

```typescript
// Set default: users can create up to 10 projects
await db.appLimitDefault.create({
  data: { name: 'projects', max: '10', softMax: '8' },
  select: { id: true }
}).execute();

// Org-scope default: each user within an org can create 5 reports
await db.orgLimitDefault.create({
  data: { name: 'reports', max: '5' },
  select: { id: true }
}).execute();

// Unlimited (negative max = no limit)
await db.appLimitDefault.create({
  data: { name: 'messages', max: '-1' },
  select: { id: true }
}).execute();
```

### Setting Aggregate Defaults

For `LimitAggregate`, set the entity-level ceiling:

```typescript
// Each org can have up to 50 seats total
await db.orgLimitAggregate.create({
  data: { name: 'seats', entityId: orgId, max: '50', num: '0' },
  select: { id: true }
}).execute();
```

### Setting Up Feature Flags (Caps)

```typescript
// Scope-level default: analytics disabled for all entities
await db.orgLimitCapsDefault.create({
  data: { name: 'enable_analytics', max: '0' },
  select: { id: true }
}).execute();

// Enable for a specific entity (org/database)
await db.orgLimitCap.create({
  data: { name: 'enable_analytics', entityId: orgId, max: '1' },
  select: { id: true }
}).execute();

// App-level cap (no entity dimension)
await db.appLimitCapsDefault.create({
  data: { name: 'max_file_upload_size', max: '10485760' },
  select: { id: true }
}).execute();
```

### Cap Value Convention

| `max` value | Meaning |
|---|---|
| `0` | Feature disabled |
| `1` | Feature enabled (boolean flag) |
| `N > 1` | Numeric cap (max file size in bytes, max items, etc.) |
| `< 0` | Unlimited / always enabled |

### Granting Credits

Credits increase the effective ceiling for a limit without changing the base max:

```typescript
// Grant 10 permanent extra seats to an org
await db.orgLimitCredit.create({
  data: {
    defaultLimitId: seatsLimitDefaultId,
    entityId: orgId,
    amount: '10',
    creditType: 'permanent',
    reason: 'purchase:invoice_123'
  },
  select: { id: true }
}).execute();

// Grant 500 period credits to a user (resets on window expiry)
await db.appLimitCredit.create({
  data: {
    defaultLimitId: apiCallsDefaultId,
    actorId: userId,
    amount: '500',
    creditType: 'period',
    reason: 'promo:WELCOME'
  },
  select: { id: true }
}).execute();
```

**Achievement-based credits:** When using the events module (`has_levels: true`), credits can be granted automatically when achievements are earned. The `tg_achievement_reward` trigger INSERTs into `limit_credits` with `reason: 'achievement:{level_name}'`. See [`constructive-sdk-events`](../constructive-sdk-events/SKILL.md) for configuring achievement rewards.

### Credit Codes (Self-Service Redemption)

```typescript
// Admin creates a redeemable code
const code = await db.appLimitCreditCode.create({
  data: { code: 'WELCOME2026', maxRedemptions: '1000', expiresAt: '2026-12-31' },
  select: { id: true }
}).execute();

// Define what the code grants
await db.appLimitCreditCodeItem.create({
  data: {
    creditCodeId: code.id,
    defaultLimitId: seatsLimitDefaultId,
    amount: '5',
    creditType: 'permanent'
  },
  select: { id: true }
}).execute();

// User redeems (trigger validates + cascades to limit_credits)
await db.appLimitCreditRedemption.create({
  data: { creditCodeId: code.id, entityId: userOrgId },
  select: { id: true }
}).execute();
```

### Reading Current Usage

```typescript
// Check a user's current usage
const limit = await db.appLimit.findMany({
  where: { name: { equalTo: 'projects' }, actorId: { equalTo: userId } },
  select: { name: true, num: true, max: true, softMax: true }
}).execute();
// limit[0].num = current usage, limit[0].max = ceiling

// Check an org's aggregate usage
const agg = await db.orgLimitAggregate.findMany({
  where: { name: { equalTo: 'seats' }, entityId: { equalTo: orgId } },
  select: { name: true, num: true, max: true }
}).execute();
// agg[0].num = total seats used, agg[0].max = ceiling

// Check a cap value
const cap = await db.orgLimitCap.findMany({
  where: { name: { equalTo: 'enable_analytics' }, entityId: { equalTo: orgId } },
  select: { name: true, max: true }
}).execute();
// cap[0].max > 0 means enabled

// View audit trail
const events = await db.orgLimitEvent.findMany({
  where: { name: { equalTo: 'seats' }, entityId: { equalTo: orgId } },
  select: { eventType: true, delta: true, numBefore: true, numAfter: true }
}).execute();
```

### Updating Limits (Admin Override)

```typescript
// Manually adjust an entity's aggregate max (admin upgrade)
await db.orgLimitAggregate.update({
  where: { id: aggregateRowId },
  data: { max: '200' },
  select: { id: true }
}).execute();

// Override a user's individual limit
await db.appLimit.update({
  where: { id: limitRowId },
  data: { max: '100' },
  select: { id: true }
}).execute();
```

---

## Decision Table

| Use Case | Blueprint Node | ORM Model |
|----------|----------------|-----------|
| "Each user can create N items" | `LimitCounter` (scope: `'app'`) | `db.appLimitDefault`, `db.appLimit` |
| "Each user within an org can do N things" | `LimitCounter` (scope: `'org'`) | `db.orgLimitDefault`, `db.orgLimit` |
| "Each user within a data room can do N things" | `LimitCounter` (scope: `'data_room'`) | `db.dataRoomLimitDefault`, `db.dataRoomLimit` |
| "This org can have N total seats" | `LimitAggregate` | `db.orgLimitAggregate` |
| "This data room can have N files" | `LimitAggregate` (scope: `'data_room'`) | `db.dataRoomLimitAggregate` |
| "Is feature X enabled for this entity?" | `LimitFeatureFlag` | `db.orgLimitCapsDefault`, `db.orgLimitCap` |
| "Bump a user's ceiling by 10" | *(none — ORM only)* | `db.appLimitCredit.create(...)` |
| "Apply Pro plan to an entity" | *(none — ORM only)* | `db.orgLimitAggregate.update(...)` per limit |
| "Read current usage" | *(none — ORM only)* | `db.appLimit.findMany(...)` / `db.orgLimitAggregate.findMany(...)` |

---

## Using database_id as entity_id

For platform-level gating where databases are the billable unit:

| Need | Approach |
|------|----------|
| Meter API calls per database | `LimitAggregate` with `entity_field: 'database_id'` |
| Gate features per database | `LimitFeatureFlag` with `scope: 'org'`, `entity_field: 'database_id'` |
| Set a database's aggregate ceiling | `db.orgLimitAggregate.create({ data: { name, entityId: databaseId, max } })` |
| Override a feature for a database | `db.orgLimitCap.create({ data: { name, entityId: databaseId, max: '1' } })` |

The `entity_id` column accepts any UUID — it works for orgs, databases, teams, or any other entity.

---

## Time Windows

Limits support periodic resets. When a limit has a `windowDuration` set, on the next enforcement check after the window expires:
1. `num` resets to 0
2. Period credits reset to 0
3. `max` recalculates from base plan + purchased credits
4. Window start updates to now

---

## Allocation Modes

Controls how sub-entities share parent capacity:

| Mode | Behavior |
|---|---|
| `pooled` (default) | All sub-entities share the parent's aggregate limit freely |
| `budgeted` | Each sub-entity gets an explicit allocation; transfer between entities enabled |

---

## Complete Blueprint Example

```json
{
  "membership_types": [
    {
      "name": "Organization Member",
      "prefix": "org",
      "parent_entity": "app",
      "has_limits": true
    }
  ],
  "tables": [
    {
      "table_name": "documents",
      "fields": [
        { "name": "title", "type": { "name": "text" } },
        { "name": "owner_id", "type": { "name": "uuid" } },
        { "name": "entity_id", "type": { "name": "uuid" } }
      ],
      "nodes": [
        "DataId",
        "DataTimestamps",
        {
          "$type": "LimitCounter",
          "data": {
            "limit_name": "documents_per_user",
            "scope": "app",
            "actor_field": "owner_id"
          }
        },
        {
          "$type": "LimitAggregate",
          "data": {
            "limit_name": "documents_total",
            "entity_field": "entity_id"
          }
        },
        {
          "$type": "LimitFeatureFlag",
          "data": {
            "feature_name": "enable_documents",
            "scope": "org",
            "entity_field": "entity_id"
          }
        }
      ]
    }
  ]
}
```

Then via ORM, set up the limits and caps:

```typescript
// Set per-user limit: each user can create 50 documents
await db.appLimitDefault.create({
  data: { name: 'documents_per_user', max: '50' },
  select: { id: true }
}).execute();

// Set aggregate limit: each org can have 10000 documents total
await db.orgLimitAggregate.create({
  data: { name: 'documents_total', entityId: orgId, max: '10000', num: '0' },
  select: { id: true }
}).execute();

// Enable the feature flag for this org
await db.orgLimitCapsDefault.create({
  data: { name: 'enable_documents', max: '0' },
  select: { id: true }
}).execute();
await db.orgLimitCap.create({
  data: { name: 'enable_documents', entityId: orgId, max: '1' },
  select: { id: true }
}).execute();
```

**Result:** The `documents` table now enforces:
- Each user can create up to 50 docs (`LimitCounter`)
- The org as a whole can have up to 10,000 docs (`LimitAggregate`)
- The entire table is gated behind the `enable_documents` feature flag (`LimitFeatureFlag`)

All enforcement happens automatically via database triggers. No application code needed beyond the initial ORM setup.

---

## ORM Models Reference

All limits ORM models support standard CRUD: `findMany`, `findOne`, `create`, `update`, `delete`.

| Model | Scope | Purpose |
|-------|-------|---------|
| `db.appLimitDefault` | app | Default max values for app-level limits |
| `db.orgLimitDefault` | org | Default max values for org-level limits |
| `db.appLimit` | app | Per-user usage tracking rows |
| `db.orgLimit` | org | Per-user-within-entity usage tracking rows |
| `db.orgLimitAggregate` | org | Entity-level aggregate counters |
| `db.appLimitCapsDefault` | app | App-level cap defaults (feature flags) |
| `db.orgLimitCapsDefault` | org | Org-level cap defaults (feature flags) |
| `db.appLimitCap` | app | Per-entity app cap overrides |
| `db.orgLimitCap` | org | Per-entity org cap overrides |
| `db.appLimitCredit` | app | Credit ledger (app-level) |
| `db.orgLimitCredit` | org | Credit ledger (org-level) |
| `db.appLimitCreditCode` | app | Redeemable credit codes |
| `db.appLimitCreditCodeItem` | app | What each code grants |
| `db.appLimitCreditRedemption` | app | Redemption records |
| `db.appLimitEvent` | app | Audit trail (app-level) |
| `db.orgLimitEvent` | org | Audit trail (org-level) |
