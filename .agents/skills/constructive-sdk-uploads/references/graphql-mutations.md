# GraphQL Mutations & Schema Reference

## `requestUploadUrl` Mutation

```graphql
mutation RequestUploadUrl($input: RequestUploadUrlInput!) {
  requestUploadUrl(input: $input) {
    uploadUrl      # Presigned S3 PUT URL (null if deduplicated)
    fileId         # UUID for the file record
    key            # S3 object key (= SHA-256 content hash)
    deduplicated   # true if file already exists (skip the PUT)
    expiresAt      # URL expiry ISO timestamp (null if deduplicated)
  }
}
```

### `RequestUploadUrlInput` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucketKey` | `String!` | Yes | Logical bucket key — e.g. `"public"`, `"private"`, `"documents"` |
| `contentHash` | `String!` | Yes | SHA-256 hex hash of file content (64 chars, lowercase) |
| `contentType` | `String!` | Yes | MIME type — e.g. `"image/png"`, `"application/pdf"` |
| `size` | `Int!` | Yes | File size in bytes |
| `filename` | `String` | No | Original filename (stored for display + Content-Disposition) |
| `ownerId` | `UUID` | No | Entity ID for entity-scoped uploads. Omit for app-level storage. |

### `RequestUploadUrlPayload` Fields

| Field | Type | Description |
|-------|------|-------------|
| `uploadUrl` | `String` | Presigned PUT URL. `null` if `deduplicated = true`. |
| `fileId` | `UUID!` | File record UUID (existing if dedup, new if fresh). Use this to link to domain tables. |
| `key` | `String!` | S3 object key (= content hash). |
| `deduplicated` | `Boolean!` | `true` = file with same hash already exists. Skip the PUT. |
| `expiresAt` | `Datetime` | Presigned URL expiry. `null` if deduplicated. |

### Validation Rules

1. `bucketKey`: max 255 chars, non-empty string
2. `contentHash`: must match `/^[a-f0-9]{64}$/` (SHA-256 hex, lowercase)
3. `contentType`: max 255 chars, non-empty string
4. `size`: must be > 0 and ≤ `defaultMaxFileSize` (default 200MB)
5. `filename`: if provided, must be ≤ `maxFilenameLength` (default 1024 chars)
6. `allowed_mime_types` on bucket: if set, `contentType` must match a pattern (supports `image/*` wildcards)
7. `max_file_size` on bucket: if set, `size` must not exceed it

### Deduplication

Before creating a new file record, the plugin checks for an existing file with the same key in the same bucket. This is enforced by a `UNIQUE(bucket_id, key)` constraint:

- If a file with the same `(bucket_id, key)` already exists: returns `deduplicated: true`, `uploadUrl: null`, and the existing `fileId`
- If no match: creates a new file record and returns a presigned PUT URL

No separate database tracking or status fields — dedup is purely an API-level optimization.

---

## `provisionBucket` Mutation

```graphql
mutation ProvisionBucket($input: ProvisionBucketInput!) {
  provisionBucket(input: $input) {
    success        # Whether provisioning succeeded
    bucketName     # The S3 bucket name that was created
    accessType     # "public" or "private"
    provider       # "minio", "s3", etc.
    endpoint       # S3 endpoint (null for AWS S3 default)
    error          # Error message if provisioning failed
  }
}
```

### `ProvisionBucketInput` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucketKey` | `String!` | Yes | Logical bucket key (e.g. `"public"`, `"private"`) |
| `ownerId` | `UUID` | No | Entity ID for entity-scoped bucket provisioning |

### Auto-provisioning

When `autoProvision: true` (default), S3 buckets are automatically created when bucket rows are inserted via GraphQL `create*` mutations on tables tagged with `@storageBuckets`. The `provisionBucket` mutation is for manual provisioning or retrying failed provisions.

---

## `downloadUrl` Computed Field

Added to any table tagged with `@storageFiles`. Returns a URL to download the file:

```graphql
query {
  appFiles {
    nodes {
      id
      key
      isPublic
      filename
      downloadUrl   # computed at query time
    }
  }
}
```

| File type | URL format |
|-----------|------------|
| Public (`is_public = true`) | `{publicUrlPrefix}/{key}` — direct CDN URL |
| Private (`is_public = false`) | Presigned GET URL with `X-Amz-Signature` (default 1h expiry) |

Returns a URL for any file that has a `key` value. Returns `null` if the file has no key.

---

## Bucket Resolution Logic

### App-level (no `ownerId`)

```sql
SELECT ... FROM storage_module WHERE database_id = $1 AND membership_type IS NULL
```

Uses the app-level storage module. Buckets table and files table are resolved from this single module.

### Entity-scoped (with `ownerId`)

```sql
SELECT ... FROM storage_module WHERE database_id = $1
-- then probe each entity table:
SELECT 1 FROM {entity_table} WHERE id = $ownerId
```

Loads all storage modules for the database, filters to entity-scoped ones (those with a `membership_type`), probes each module's entity table for a matching `ownerId` row, and uses the matching module.

### CORS Resolution Hierarchy

Most specific wins:
1. **Bucket-level** `allowed_origins` column
2. **Storage module-level** `allowed_origins` column
3. **Plugin config** `allowedOrigins`

Supports `['*']` for fully open CDN/public mode.

---

## TypeScript Types (from `graphile-presigned-url-plugin`)

```typescript
interface RequestUploadUrlInput {
  bucketKey: string;
  ownerId?: string;
  contentHash: string;
  contentType: string;
  size: number;
  filename?: string;
}

interface RequestUploadUrlPayload {
  uploadUrl: string | null;
  fileId: string;
  key: string;
  deduplicated: boolean;
  expiresAt: string | null;
}
```
