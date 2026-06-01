# Entity-Scoped Storage Configuration

Configure per-entity storage when provisioning entity types with `has_storage: true`.

## Provisioning

```typescript
await db.entityTypeProvision.create({
  data: {
    databaseId,
    name: 'Data Room Member',
    prefix: 'data_room',
    parentEntity: 'org',
    hasStorage: true,
    storageConfig: {
      is_public: false,
      max_file_size: 52428800,  // 50MB
      allowed_mime_types: ['application/pdf', 'image/*', 'text/*'],
      policies: [
        {
          $type: 'AuthzEntityMembership',
          privileges: ['select', 'insert', 'update', 'delete'],
          data: { entity_field: 'entity_id', membership_type: 6 },
          tables: ['buckets', 'files'],
        },
      ],
    },
  },
  select: { id: true },
}).execute();
```

## Tables Created

| Table | Purpose |
|-------|---------|
| `{prefix}_buckets` | Per-entity bucket records |
| `{prefix}_files` | File metadata (key, hash, size, MIME type) |

## Storage Config Options

| Option | Type | Purpose |
|--------|------|---------|
| `is_public` | boolean | S3 bucket ACL (transport layer) |
| `max_file_size` | integer | Max file size in bytes |
| `allowed_mime_types` | string[] | Allowed MIME types |
| `policies` | Authz*[] | RLS policies for buckets/files tables |

## Default Policies

When `policies` is omitted, the system applies:
- `AuthzEntityMembership` — entity members can access
- `AuthzPublishable` — published files visible to all
- `AuthzDirectOwner` — file owner has full access

See `constructive-security` for the full Authz* type reference and `constructive-storage` for the upload pipeline.
