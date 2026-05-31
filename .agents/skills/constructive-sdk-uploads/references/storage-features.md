# Storage Feature Flags — Detailed Reference

Each storage module entry (top-level `storage[]` or entity `storage[]`) accepts boolean flags
that opt into additional tables, triggers, and computed fields.

---

## File Versioning (`has_versioning`)

Enable via blueprint storage config:

```ts
const blueprint = {
  storage: [{
    has_versioning: true,
    buckets: [{ name: 'documents' }],
  }],
};
```

### What gets created

| Artifact | Description |
|----------|-------------|
| `previous_version_id` (uuid FK) | Self-referencing FK on files table — points to the file this version supersedes. `SET NULL` on delete. |
| `is_latest` (boolean) | `true` for the current version, `false` for all older versions. |
| `set_version_not_latest` trigger | BEFORE INSERT: when `previous_version_id IS NOT NULL`, sets `is_latest = false` on the superseded row. |
| `promote_previous_version` trigger | BEFORE DELETE: when the latest version is deleted, promotes the previous version to `is_latest = true`. |
| `version_history` computed field | Recursive CTE walking the `previous_version_id` chain. PostGraphile exposes this as a connection field on the File type. |
| Partial index | `(bucket_id) WHERE is_latest = true` — fast file browser queries showing only current versions. |

Both `previous_version_id` and `is_latest` are immutable after INSERT.

### ORM: Creating a new version

```typescript
const result = await db.mutation.requestUploadUrl({
  input: {
    bucketKey: 'documents',
    contentHash: newHash,
    contentType: 'application/pdf',
    size: newFile.size,
    filename: 'contract-v2.pdf',
    previousVersionId: existingFileId,  // links to the file being superseded
  },
}).execute();
```

### ORM: Querying version history

```typescript
// The version_history computed field returns the full chain
const file = await db.appFile.findFirst({
  where: { id: { equalTo: fileId } },
  select: {
    id: true,
    filename: true,
    isLatest: true,
    versionHistory: {
      select: { id: true, filename: true, createdAt: true },
    },
  },
}).execute();
```

---

## File Audit Log (`has_audit_log`)

```ts
const blueprint = {
  storage: [{
    has_audit_log: true,
    buckets: [{ name: 'documents' }],
  }],
};
```

### What gets created

| Artifact | Description |
|----------|-------------|
| `{prefix}_file_events` table | Append-only audit trail for file lifecycle events. |
| AFTER trigger on files | Auto-logs `upload`, `version_created`, `move`, `rename`, `publish`/`unpublish`, and `delete` events. |

### `file_events` table columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `created_at` | timestamptz | Event timestamp |
| `file_id` | uuid (FK) | File reference — `SET NULL` on delete (preserves audit record) |
| `bucket_id` | uuid (FK) | Bucket reference — `CASCADE` on delete |
| `actor_id` | uuid | User who performed the action |
| `event_type` | text | One of 13 types (see below) |
| `metadata` | jsonb | Event-specific payload (e.g., `old_path`/`new_path` for move) |

### 13 event types

`upload` | `delete` | `version_created` | `move` | `rename` | `download` | `publish` | `unpublish` | `share_created` | `share_revoked` | `permission_granted` | `permission_revoked` | `bulk_upload`

Records are **immutable** — `bucket_id`, `actor_id`, `event_type`, and `metadata` cannot be updated.
RLS: SELECT + INSERT only (no UPDATE/DELETE for non-admins).

---

## Path Shares / Virtual Filesystem (`has_path_shares`)

```ts
const blueprint = {
  storage: [{
    has_path_shares: true,
    buckets: [{ name: 'documents' }],
  }],
};
```

### What gets created

| Artifact | Description |
|----------|-------------|
| `path` column (ltree) | Added to files table — hierarchical path for virtual filesystem. |
| `{prefix}_file_path_shares` table | Grants path-scoped access to non-members. |
| `filePath` computed field | Returns slash-delimited path: `ltree_to_slash(path) || '/' || filename`. |
| `move_files` function | Moves files (and their path shares) from one path prefix to another. SECURITY INVOKER. |
| `rename_file` function | Updates a file's `filename` column. SECURITY INVOKER. |

### `file_path_shares` table columns

| Column | Type | Description |
|--------|------|-------------|
| `bucket_id` | uuid (FK) | Bucket — CASCADE on delete |
| `path` | ltree | Path prefix this share covers (ltree containment) |
| `grantee_id` | uuid | User receiving access |
| `grantor_id` | uuid | User granting access (forced to current user) |
| `can_read` | boolean | View/download files under this path (default: `true`) |
| `can_write` | boolean | Upload/update files under this path (default: `false`) |
| `can_delete` | boolean | Delete files under this path (default: `false`) |
| `expires_at` | timestamptz | Optional expiration — expired shares are ignored by RLS |

Unique constraint: `(bucket_id, path, grantee_id)`. Immutable fields: `bucket_id`, `grantee_id`, `grantor_id`.

Only available when `entity_table_id IS NOT NULL` or `scope = 'platform'` (not for app-level storage without an entity).

### ORM: Sharing a folder

```typescript
await db.appFilePathShare.create({
  data: {
    bucketId: bucketId,
    path: 'projects.acme.reports',  // ltree path
    granteeId: collaboratorUserId,
    canRead: true,
    canWrite: true,
    canDelete: false,
    expiresAt: '2025-12-31T23:59:59Z',
  },
}).execute();
```

---

## Custom S3 Keys (`has_custom_keys`)

```ts
const blueprint = {
  storage: [{
    has_custom_keys: true,
    // has_custom_keys implies has_versioning + has_content_hash
    buckets: [{ name: 'functions', allow_custom_keys: true }],
  }],
};
```

When `has_custom_keys` is enabled:

- The `allow_custom_keys` boolean on the **buckets** table controls per-bucket opt-in.
- When `allow_custom_keys = true`, clients provide their own S3 key (e.g., `reports/2024/Q1.pdf`) instead of using the content hash.
- `contentHash` is still required for integrity verification even with custom keys.
- `allow_custom_keys` is **immutable after INSERT** — prevents mode switching after files exist.
- Key validation ensures custom keys are safe S3 paths.

---

## Confirm Upload (`has_confirm_upload`)

```ts
const blueprint = {
  storage: [{
    has_confirm_upload: true,
    confirm_upload_delay: '30 seconds',  // default
    buckets: [{ name: 'documents' }],
  }],
};
```

### Status transitions

```
INSERT (requestUploadUrl)    →  status = 'requested'
  ↓
HeadObject job confirms      →  status = 'uploaded'     (via confirm_file_uploaded)
  ↓
Processing complete          →  status = 'processed'    (via mark_file_processed)
```

### What gets created

| Artifact | Description |
|----------|-------------|
| `confirm_file_uploaded(file_id)` | SECURITY DEFINER function in private schema. Transitions `requested → uploaded`. Called by Knative worker. |
| `mark_file_processed(file_id)` | SECURITY DEFINER function in private schema. Transitions `uploaded → processed`. Called by processing workers. |
| AFTER INSERT trigger | Enqueues `storage:confirm_upload` job on the `storage_confirm` queue. |

### Job configuration

| Parameter | Value |
|-----------|-------|
| Task identifier | `storage:confirm_upload` |
| Queue | `storage_confirm` |
| Max attempts | 12 |
| Priority | 50 |
| Delay | `confirm_upload_delay` (default 30s) |
| Payload | `{ file_id, key, bucket_id, mime_type }` |

The Knative worker performs a HeadObject on S3, then calls `confirm_file_uploaded()`.
Processing triggers (extraction, embedding, etc.) watch for `status = 'uploaded'`.

---

## Multi-Module Storage (`storage_key`)

Each blueprint can provision **multiple storage modules** with distinct feature flags by providing multiple array entries with different `storage_key` values.

```ts
const blueprint = {
  storage: [
    { has_path_shares: true, has_confirm_upload: true, buckets: [{ name: 'documents' }] },
    { storage_key: 'fn', has_custom_keys: true, buckets: [{ name: 'functions' }] },
  ],
};
```

Each module gets:
- Its own table pair: `app_buckets`/`app_files` (default) vs `app_fn_buckets`/`app_fn_files` (key: `fn`)
- Distinct GraphQL mutations: `uploadAppFile` vs `uploadAppFnFile`
- Independent feature flags per module

### `storage_key` rules

- Max **16 characters**, lowercase snake_case
- Cannot be reserved: `'buckets'`, `'files'`, `'bucket'`, `'file'`
- Default key (omitted or `'default'`) produces no infix in table names

---

## File Deletion GC

**Always created** — not controlled by a feature flag.

When a file row is deleted, an AFTER DELETE trigger enqueues a `delete_s3_object` job to clean up the S3 object asynchronously.

| Parameter | Value |
|-----------|-------|
| Task identifier | `delete_s3_object` |
| Queue | `storage_gc` |
| Priority | 100 |
| Delay | 5 seconds |
| Max attempts | 5 |
| Payload | `{ key, bucket_id }` (+ `content_hash` when `has_content_hash`) |

The worker checks **refcount before deleting** from S3 — if another file row references the same S3 key (deduplication), the object is kept. Spurious jobs are harmless no-ops.

The trigger is SECURITY DEFINER because the DELETE itself was RLS-protected; the AFTER trigger only enqueues a cleanup job which requires `app_jobs` access.

---

## graphile-upload-plugin (Stream-Based Uploads)

A separate upload path from the presigned URL flow. The `graphile-upload-plugin` adds a GraphQL `Upload` scalar for **stream-based file uploads** — the file bytes flow through the GraphQL server (multipart form upload).

### When to use

| Flow | Use case |
|------|----------|
| **Presigned URL** (default) | Large files, direct-to-S3, no server-side processing needed at upload time |
| **Upload scalar** | Small files, server-side processing required, or legacy GraphQL upload clients |

### How it works

1. Plugin registers a `GraphQL Upload` scalar type
2. Mutations with matching columns get `*Upload` input fields
3. Resolver intercepts the upload stream before the mutation executes
4. User-supplied resolver processes the file (e.g., save to S3, extract metadata)

### Blueprint: Enable direct uploads

The `enable_direct_uploads` database setting must be `true` (default) for the plugin to activate.

### Server setup

```typescript
import { createUploadPlugin } from 'graphile-upload-plugin';

const preset = {
  plugins: [
    createUploadPlugin({
      uploadFieldDefinitions: [
        { name: 'upload', namespaceName: 'public' },
      ],
      maxFileSize: 10 * 1024 * 1024,  // 10 MB
    }),
  ],
};
```

The plugin supports both type-name based matching and smart-tag based matching for identifying which columns should accept uploads.
