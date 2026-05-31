---
name: constructive-sdk-uploads
description: "File uploads with GraphQL + S3/MinIO — presigned URL flow (requestUploadUrl → PUT → downloadUrl), bucket provisioning, downloadUrl computed field, public/private/entity-scoped buckets, MIME type restrictions, file size limits, deduplication, the upload-client library, file versioning (has_versioning), audit log (has_audit_log), path shares / virtual filesystem (has_path_shares), custom S3 keys (has_custom_keys), confirm upload flow (has_confirm_upload), multi-module storage (storage_key), file deletion GC, and graphile-upload-plugin (Upload scalar). Use when asked to 'upload files', 'add file uploads', 'configure storage', 'set up MinIO', 'presigned URLs', 'download URLs', 'file versioning', 'audit log', 'path shares', 'custom keys', 'confirm upload', 'storage_key', 'file GC', 'Upload scalar', or when working with graphile-presigned-url-plugin, graphile-bucket-provisioner-plugin, graphile-upload-plugin, or @constructive-io/upload-client."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# File Uploads (Presigned URL Flow)

Constructive provides a complete file upload pipeline using presigned S3 URLs — the client uploads directly to S3/MinIO, never routing file bytes through the GraphQL server.

Related skills:
- **Custom entities (entity-scoped storage):** [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) — provisioning entity types with `has_storage: true`
- **Security policies on storage tables:** [`constructive-safegres`](../constructive-safegres/SKILL.md) — `AuthzAppMembership`, `AuthzEntityMembership`, `AuthzPublishable`

---

## Packages

| Package | Purpose |
|---------|---------|
| `graphile-presigned-url-plugin` | PostGraphile v5 plugin: `requestUploadUrl` mutation, `downloadUrl` computed field |
| `graphile-bucket-provisioner-plugin` | PostGraphile v5 plugin: auto-provisions S3 buckets on row creation, explicit `provisionBucket` mutation |
| `graphile-upload-plugin` | PostGraphile v5 plugin: GraphQL `Upload` scalar for stream-based uploads |
| `@constructive-io/upload-client` | Client-side orchestrator: hash → requestUploadUrl → PUT in one call |
| `@constructive-io/bucket-provisioner` | Low-level S3 bucket provisioner (create, CORS, policies, lifecycle) |

---

## The Upload Flow

```
Client                          GraphQL Server              S3 / MinIO
  │                                  │                          │
  ├── requestUploadUrl ─────────────►│  validate + create file  │
  │◄──── { uploadUrl, fileId } ──────│                          │
  │                                  │                          │
  ├── PUT uploadUrl ────────────────────────────────────────────►│
  │◄──── 200 OK ────────────────────────────────────────────────│
  │                                  │                          │
  │  Done. File is ready.            │                          │
```

Key properties:
- **Content-addressed:** S3 key = SHA-256 hash of file content
- **Deduplication:** same hash in same bucket → `deduplicated: true`, skip the PUT (no extra DB state — enforced by `UNIQUE(bucket_id, key)` constraint)
- **No confirm step:** files are usable immediately after the PUT succeeds
- **RLS-protected:** all DB operations run through RLS policies
- **Lazy provisioning:** S3 buckets are created on first upload (or via `provisionBucket`)

---

## When to Apply

- Setting up file upload capability in a Constructive app
- Adding storage to an entity type (data rooms, teams, channels)
- Configuring public vs private buckets
- Debugging upload errors or presigned URL issues
- Writing integration tests for file uploads

---

## GraphQL Mutations

See [graphql-mutations.md](./references/graphql-mutations.md) for the full GraphQL schema, input types, and payload fields.

## Server Configuration

See [server-setup.md](./references/server-setup.md) for PostGraphile preset configuration, environment variables, and S3/MinIO setup.

## Client-Side Usage

See [client-usage.md](./references/client-usage.md) for the `@constructive-io/upload-client` library and manual upload flow examples.

## Three Bucket Scenarios

### 1. Public Bucket (app-level)

```typescript
{ bucketKey: 'public', contentHash, contentType, size, filename }
```
Files inherit `is_public = true`. `downloadUrl` returns a direct CDN URL.

### 2. Private Bucket (app-level)

```typescript
{ bucketKey: 'private', contentHash, contentType, size, filename }
```
Files inherit `is_public = false`. `downloadUrl` returns a presigned GET URL (default 1h expiry).

### 3. Entity-Scoped Bucket (with `ownerId`)

```typescript
{ bucketKey: 'documents', ownerId: dataRoomId, contentHash, contentType, size, filename }
```
Files belong to a specific entity instance. Secured by `AuthzEntityMembership`. Supports per-bucket MIME type restrictions and file size limits.

See [`constructive-sdk-entities`](../constructive-sdk-entities/SKILL.md) for provisioning entity types with storage.

## Bucket Seeding via Blueprint

Buckets can be pre-seeded at deploy time via the blueprint `storage` key. The `storage` field is a **JSON array** of storage module entries. Each entry has an optional `scope` field:

- `scope: "app"` (default) — app-level storage (`app_buckets`/`app_files`), no `owner_id`
- `scope: "org"` — per-org/user storage (`org_buckets`/`org_files`), with `owner_id`, seeded per-entity via AFTER INSERT trigger

Only `"app"` and `"org"` are allowed at the top level. Child entity types get storage via `entity_types[].storage`.

**App-scoped (default):**
```json
{
  "storage": [
    {
      "buckets": [
        { "name": "avatars", "is_public": true, "allowed_mime_types": ["image/png", "image/jpeg"] },
        { "name": "documents", "is_public": false, "max_file_size": 52428800 }
      ]
    }
  ]
}
```

**Org-scoped (per-org/user):**
```json
{
  "storage": [
    {
      "scope": "org",
      "buckets": [
        { "name": "documents" },
        { "name": "media", "is_public": true }
      ]
    }
  ]
}
```

When infra is installed, a private `functions` bucket is auto-injected into any `scope: "org"` entry that doesn't already include one.

### Multi-module storage (separate tables per use case)

You can provision multiple storage modules with different feature flags by providing multiple array entries with distinct `storage_key` values:

```json
{
  "storage": [
    { "has_path_shares": true, "has_confirm_upload": true, "buckets": [{ "name": "documents" }] },
    { "storage_key": "fn", "has_custom_keys": true, "has_confirm_upload": false, "buckets": [{ "name": "functions" }] }
  ]
}
```

Each module gets its own table pair (`app_buckets`/`app_files` for default, `app_fn_buckets`/`app_fn_files` for `storage_key: "fn"`) and its own GraphQL mutations (`uploadAppFile`, `uploadAppFnFile`).

The `storage_key` must be max 16 chars, lowercase snake_case, and cannot be `'buckets'`/`'files'`/`'bucket'`/`'file'`.

This creates rows in the appropriate buckets table during `construct_blueprint()` Phase 0.5. The physical S3 bucket is still lazily created on the first `requestUploadUrl` call. See [blueprint-definition-format.md](../constructive-platform/references/blueprint-definition-format.md) for the full `storage` key spec.

---

## Storage Feature Flags

Each `storage[]` entry accepts boolean flags that opt into additional tables, triggers, and computed fields. Enable them in blueprint storage config:

```ts
const blueprint = {
  storage: [{
    has_versioning: true,
    has_audit_log: true,
    has_path_shares: true,
    has_confirm_upload: true,
    confirm_upload_delay: '30 seconds',
    buckets: [{ name: 'documents' }],
  }],
};
```

| Flag | Default | Creates |
|------|---------|---------|
| `has_versioning` | `false` | `previous_version_id` FK, `is_latest` boolean, `set_version_not_latest` trigger, `promote_previous_version` trigger, `version_history` computed field (recursive CTE) |
| `has_audit_log` | `false` | `{prefix}_file_events` table with 13 event types, AFTER trigger on files, immutable records. `SET NULL` on file delete. |
| `has_path_shares` | `false` | `{prefix}_file_path_shares` table (`bucket_id`, `path` ltree, `grantee_id`, `can_read`/`write`/`delete`, `expires_at`), `filePath` computed field, `move_files` function, `rename_file` function |
| `has_custom_keys` | `false` | `allow_custom_keys` boolean on buckets (immutable). Clients provide custom S3 keys instead of content hash. Implies `has_versioning` + `has_content_hash`. |
| `has_confirm_upload` | `false` | `confirm_file_uploaded` + `mark_file_processed` SECURITY DEFINER functions, AFTER INSERT trigger enqueuing `storage:confirm_upload` job. Status flow: `requested → uploaded → processed`. |
| `has_content_hash` | `false` | Content-hash addressing for deduplication |
| `has_audit_log` event types | — | `upload`, `delete`, `version_created`, `move`, `rename`, `download`, `publish`, `unpublish`, `share_created`, `share_revoked`, `permission_granted`, `permission_revoked`, `bulk_upload` |

### File deletion GC (always active)

An AFTER DELETE trigger on the files table always enqueues a `delete_s3_object` job on the `storage_gc` queue (priority 100, 5-second delay, max 5 attempts). The worker checks refcount before deleting from S3 — deduplicated files are kept until the last reference is removed.

### graphile-upload-plugin (stream-based uploads)

Separate from the presigned URL flow. The `graphile-upload-plugin` adds a GraphQL `Upload` scalar for stream-based file uploads where bytes flow through the GraphQL server (multipart form). Use for small files or when server-side processing is needed at upload time. Controlled by the `enable_direct_uploads` database setting.

See [storage-features.md](./references/storage-features.md) for detailed reference on each feature flag including table schemas, trigger behavior, ORM examples, and job configuration.

---

## Bucket Configuration

| Column | Type | Description |
|--------|------|-------------|
| `key` | text | Logical bucket key (`"public"`, `"private"`, `"avatars"`) |
| `type` | text | `"public"`, `"private"`, or `"temp"` |
| `is_public` | boolean | Files inherit this visibility |
| `allowed_mime_types` | text[] | MIME whitelist (supports wildcards: `"image/*"`) |
| `max_file_size` | integer | Max file size in bytes (overrides module default) |
| `allowed_origins` | text[] | Per-bucket CORS override |

---

## Error Codes

| Error | Cause |
|-------|-------|
| `INVALID_CONTENT_HASH_FORMAT` | Not a 64-char lowercase hex SHA-256 |
| `BUCKET_NOT_FOUND` | No bucket with that key (or RLS denied) |
| `CONTENT_TYPE_NOT_ALLOWED` | MIME type not in bucket's `allowed_mime_types` |
| `FILE_TOO_LARGE` | Exceeds bucket's `max_file_size` |
| `STORAGE_MODULE_NOT_PROVISIONED` | No storage module for this database |
| `STORAGE_MODULE_NOT_FOUND_FOR_OWNER` | No entity-scoped storage for this `ownerId` |

---

## Integration Tests

| File | Scope |
|------|-------|
| `constructive/graphql/server-test/__tests__/upload.integration.test.ts` | End-to-end presigned URL flow (public + private, dedup) |
| `constructive/packages/upload-client/__tests__/upload.test.ts` | Client library unit tests |
| `constructive/graphile/graphile-upload-plugin/__tests__/plugin.test.ts` | Upload scalar plugin tests |
| `constructive/packages/bucket-provisioner/__tests__/provisioner.test.ts` | S3 provisioning tests |

```bash
# Run upload integration tests (requires MinIO at localhost:9000)
cd graphql/server-test
CDN_ENDPOINT=http://localhost:9000 pnpm test -- upload.integration
```
