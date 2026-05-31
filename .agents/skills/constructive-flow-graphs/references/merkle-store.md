# Merkle Store

Content-addressed state tracking provisioned via blueprints. Provides git-like semantics for storing and versioning structured data.

## Provisioning

Set `has_merkle_store: true` on an entity type:

```json
{
  "entity_types": [{
    "name": "Organization Member",
    "prefix": "org",
    "parent_entity": "app",
    "has_merkle_store": true
  }]
}
```

## Tables

| Table | Columns | Purpose |
|-------|---------|---------|
| `{prefix}_objects` | `hash` (uuid PK), `data` (jsonb), `size` (int) | Content-addressed blobs |
| `{prefix}_stores` | `id`, `entity_id`, `name`, `created_at` | Named stores (like repos) |
| `{prefix}_commits` | `id`, `store_id`, `parent_id`, `tree_hash`, `message`, `created_at` | Commit chain |
| `{prefix}_refs` | `id`, `store_id`, `name`, `commit_id` | Named references (branches/tags) |

## Content Addressing

Objects are stored by hash using `object_hash_uuid()`:
```
uuid_generate_v5(uuid_ns_url(), jsonb::text)
```

Duplicate content produces the same hash — stored once, referenced many times.

## ORM Operations

```typescript
// Create a store
const store = await db.orgStore.create({
  data: { entityId: orgId, name: 'schema-state' },
  select: { id: true },
}).execute();

// Store an object
const obj = await db.orgObject.create({
  data: { data: { tables: [...], relations: [...] } },
  select: { hash: true },
}).execute();

// Create a commit
const commit = await db.orgCommit.create({
  data: { storeId: store.id, treeHash: obj.hash, message: 'initial schema' },
  select: { id: true },
}).execute();

// Point a ref at the commit
await db.orgRef.create({
  data: { storeId: store.id, name: 'main', commitId: commit.id },
  select: { id: true },
}).execute();
```
