# Entity-Scoped Storage Configuration Reference

## `storage[]` Entry Fields

Each element in the `storage` array is a storage module definition:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `storage_key` | string | `'default'` | Unique key for this module. Becomes infix in table names (omitted for 'default'). Max 16 chars, lowercase snake_case. |
| `has_path_shares` | boolean | `false` | Enable ltree path column + file_path_shares table |
| `has_versioning` | boolean | `false` | Enable file version history (previous_version_id, is_latest) |
| `has_content_hash` | boolean | `false` | Enable content-hash addressing |
| `has_custom_keys` | boolean | `false` | Allow clients to specify S3 keys |
| `has_audit_log` | boolean | `false` | Create file_events audit table |
| `has_confirm_upload` | boolean | `false` | Enable HeadObject upload confirmation flow |
| `restrict_reads` | boolean | `false` | Add read_files permission requirement for SELECT |
| `upload_url_expiry_seconds` | number | plugin default | Override presigned URL expiry |
| `download_url_expiry_seconds` | number | plugin default | Override download URL expiry |
| `default_max_file_size` | number | `null` | Module-level max file size in bytes |
| `allowed_origins` | string[] | `null` | Module-level CORS origins |
| `buckets` | array | `[]` | Auto-seed bucket rows per entity instance |
| `provisions` | object | `null` | Per-table overrides keyed by `"files"` or `"buckets"`. Each value: `{ nodes, fields, grants, use_rls, policies }`. Fanned out to `secure_table_provision`. When a key includes `policies[]`, those REPLACE the default storage policies for that table |

Each policy object (inside `provisions.{table}.policies`) has `$type` (required), `privileges` (required), plus optional `data` and `policy_name`. Missing `data` is auto-populated with storage-specific defaults (e.g., `AuthzPublishable` → `{"is_published_field": "is_public", "require_published_at": false}`).

## Default Storage Policies

When `provisions` is omitted (or a table key has no `policies`), the system applies **sensible locked-down defaults**: membership gets `select` + `insert`, `AuthzDirectOwner` on `actor_id` gates `update` + `delete`, and `AuthzPublishable` on `is_public` gates public `select`. See [storage-policies.md](../../constructive-platform/references/storage-policies.md) for the full default policy matrix.

When a table key includes `policies[]`, defaults are skipped **for that table only** — other tables without a `policies` key still get defaults. It's per-table replacement, not all-or-nothing.

## Typical Policy Combinations

| Combination | Use case |
|-------------|----------|
| *(omit provisions entirely)* | Locked-down default: members view/upload, only creator can update/delete |
| `provisions.files.policies: [{ "$type": "AuthzEntityMembership", "privileges": ["select", "insert", "update", "delete"] }]` | Full CRUD for all members on files (buckets still get defaults) |
| Per-table explicit policies on both keys | Full custom: you control exactly what each storage table gets |
| `provisions.files.nodes: [{ "$type": "SearchBm25", ... }]` (no policies key) | Add search to files, keep default policies |

For the complete storage feature flag reference (versioning, audit log, path shares, custom keys, confirm upload, GC), see [`constructive-sdk-uploads`](../../constructive-sdk-uploads/SKILL.md).

## ORM: Entity with Storage

```typescript
const result = await db.entityTypeProvision.create({
  data: {
    databaseId: dbId,
    name: 'Data Room',
    prefix: 'data_room',
    parentEntity: 'org',
    hasStorage: true,
    storageConfig: [
      {
        has_path_shares: true,
        provisions: {
          files: {
            policies: [
              { $type: 'AuthzEntityMembership', privileges: ['select', 'insert', 'update', 'delete'] },
              { $type: 'AuthzPublishable', privileges: ['select'] },
            ],
          },
          buckets: {
            policies: [
              { $type: 'AuthzEntityMembership', privileges: ['select', 'insert', 'update', 'delete'] },
            ],
          },
        },
      },
    ],
  },
  select: {
    outMembershipType: true,
    outEntityTableId: true,
    outInstalledModules: true,
  },
}).execute();
// outInstalledModules includes 'storage_module (data_room)'
```

## Creating Buckets for an Entity

After provisioning the entity type with storage, create bucket rows for each entity instance:

```typescript
// Create a 'documents' bucket for a specific data room
await db.dataRoomBucket.create({
  data: {
    key: 'documents',
    type: 'private',
    isPublic: false,
    ownerId: dataRoomId,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
    maxFileSize: 10485760,  // 10MB
  },
}).execute();
```

Or via the `provisionBucket` GraphQL mutation:

```graphql
mutation {
  provisionBucket(input: {
    bucketKey: "documents"
    ownerId: "data-room-uuid"
  }) {
    success
    bucketName
    accessType
  }
}
```

## Uploading to Entity-Scoped Buckets

Pass `ownerId` in the `requestUploadUrl` mutation to target the entity's storage:

```typescript
const { data } = await graphqlClient.mutate({
  mutation: REQUEST_UPLOAD_URL,
  variables: {
    input: {
      bucketKey: 'documents',
      ownerId: dataRoomId,     // entity instance UUID
      contentHash,
      contentType: 'application/pdf',
      size: file.size,
      filename: 'contract.pdf',
    },
  },
});
```

The plugin resolves the correct storage module by probing entity tables for the `ownerId`, then uses that module's file tables.
