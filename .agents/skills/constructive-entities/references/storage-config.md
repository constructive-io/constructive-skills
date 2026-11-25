# Entity-Scoped Storage Configuration

Configure per-entity storage when provisioning entity types with a `storage` array.

## Provisioning

```typescript
await db.entityTypeProvision.create({
  data: {
    databaseId,
    name: 'Data Room Member',
    prefix: 'data_room',
    parentEntity: 'org',
    storage: [{
      key: 'default',
      buckets: [{
        name: 'documents',
        is_public: false,
        max_file_size: 52428800,
        allowed_mime_types: ['application/pdf', 'image/*', 'text/*'],
      }],
    }],
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

Set `is_public`, `max_file_size`, and `allowed_mime_types` on each entry in `storage[].buckets[]`.

| Option | Type | Purpose |
|--------|------|---------|
| `is_public` | boolean | S3 bucket ACL (transport layer) |
| `max_file_size` | integer | Max file size in bytes |
| `allowed_mime_types` | string[] | Allowed MIME types |
| `provisions.<table>.policies` | Authz*[] | Override RLS policies on `buckets` or `files` |

## Default Policies

When no table policy override is supplied, the system applies:
- `AuthzEntityMembership` — entity members can access
- `AuthzPublishable` — published files visible to all
- `AuthzMemberOwner` — the uploader can update/delete their own files while they remain a member (never a bare `AuthzDirectOwner`, which would survive membership removal)

See `constructive-security` for the full Authz* type reference and `constructive-storage` for the upload pipeline.
