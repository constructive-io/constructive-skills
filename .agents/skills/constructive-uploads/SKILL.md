---
name: constructive-uploads
description: "File uploads with GraphQL + S3/MinIO — presigned URL flow (requestUploadUrl → PUT → confirmUpload), bucket provisioning, downloadUrl computed field, public/private/entity-scoped buckets, MIME type restrictions, file size limits, deduplication, and the upload-client library. Use when asked to 'upload files', 'add file uploads', 'configure storage', 'set up MinIO', 'presigned URLs', 'download URLs', or when working with graphile-presigned-url-plugin, graphile-bucket-provisioner-plugin, or @constructive-io/upload-client."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# File Uploads (Presigned URL Flow)

Constructive provides a complete file upload pipeline using presigned S3 URLs — the client uploads directly to S3/MinIO, never routing file bytes through the GraphQL server.

Related skills:
- **Custom entities (entity-scoped storage):** [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) — provisioning entity types with `has_storage: true`
- **Security policies on storage tables:** [`constructive-safegres`](../constructive-safegres/SKILL.md) — `AuthzMembership`, `AuthzEntityMembership`, `AuthzPublishable`

---

## Packages

| Package | Purpose |
|---------|---------|
| `graphile-presigned-url-plugin` | PostGraphile v5 plugin: `requestUploadUrl` + `confirmUpload` mutations, `downloadUrl` computed field |
| `graphile-bucket-provisioner-plugin` | PostGraphile v5 plugin: auto-provisions S3 buckets on row creation, explicit `provisionBucket` mutation |
| `graphile-upload-plugin` | PostGraphile v5 plugin: GraphQL `Upload` scalar for stream-based uploads |
| `@constructive-io/upload-client` | Client-side orchestrator: hash → requestUploadUrl → PUT → confirmUpload in one call |
| `@constructive-io/bucket-provisioner` | Low-level S3 bucket provisioner (create, CORS, policies, lifecycle) |

---

## The Upload Flow

```
Client                          GraphQL Server              S3 / MinIO
  │                                  │                          │
  ├── requestUploadUrl ─────────────►│  validate + create file  │
  │◄──── { uploadUrl, fileId } ──────│  (status='pending')      │
  │                                  │                          │
  ├── PUT uploadUrl ────────────────────────────────────────────►│
  │◄──── 200 OK ────────────────────────────────────────────────│
  │                                  │                          │
  ├── confirmUpload(fileId) ────────►│  HEAD object ───────────►│
  │◄──── { status: 'ready' } ───────│  → 'ready'               │
```

Key properties:
- **Content-addressed:** S3 key = SHA-256 hash of file content
- **Deduplication:** same hash in same bucket → `deduplicated: true`, skip the PUT
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

See [`constructive-custom-entities`](../constructive-custom-entities/SKILL.md) for provisioning entity types with storage.

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
| `FILE_NOT_IN_S3` | S3 HEAD returns 404 during `confirmUpload` |
| `CONTENT_TYPE_MISMATCH` | S3 object Content-Type doesn't match declared type |

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
