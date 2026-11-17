# GraphQL Mutations & Schema Reference

## Upload mutations — one pair per files table

Every files table tagged `@storageFiles` gets its own pair of root mutations, named from the table's GraphQL type:

| Files table type | Single upload | Bulk upload |
|------------------|---------------|-------------|
| `AppFile` (app-level storage) | `uploadAppFile(input: UploadAppFileInput!)` | `uploadAppFiles(input: UploadAppFileBulkInput!)` |
| `DataRoomFile` (entity-scoped, prefix `data_room`) | `uploadDataRoomFile(...)` | `uploadDataRoomFiles(...)` |
| `<Type>` | `upload<Type>` | `upload<Type>s` |

Because the mutation is per files table, it already names the storage module; there is no global upload mutation.

```graphql
mutation UploadAppFile($input: UploadAppFileInput!) {
  uploadAppFile(input: $input) {
    uploadUrl      # Presigned PUT URL (null if deduplicated)
    uploadHeaders  # The exact headers the PUT must send (null if deduplicated)
    fileId         # UUID of the files row
    key            # Object key (= SHA-256 content hash unless a custom key was given)
    deduplicated   # true if a live file with these bytes already exists (skip the PUT)
    expiresAt      # URL expiry ISO timestamp (null if deduplicated)
    file           # Projection document to store in an image/upload column
  }
}
```

### `Upload<Type>Input` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucketKey` | `String` | No | Logical bucket key — e.g. `"public"`, `"private"`, `"documents"`. Omit to use the database's default bucket for the requested access. |
| `isPublic` | `Boolean` | No | Which default bucket to resolve when `bucketKey` is omitted: public (`true`) or private (default `false`). Ignored when `bucketKey` is given. |
| `ownerId` | `UUID!` | Entity-scoped only | Owner entity ID. Present (and required) only when the buckets table has an `owner_id` column. |
| `databaseId` | `UUID` | No | Present only when the files table has a `database_id` column. Omit for the current session's database; a caller who is not a member of the named database is refused (`DATABASE_ACCESS_DENIED`). |
| `contentHash` | `String!` | Yes | SHA-256 hex hash of file content (64 chars, lowercase) |
| `contentType` | `String!` | Yes | MIME type — e.g. `"image/png"`, `"application/pdf"` |
| `size` | `Int!` | Yes | File size in bytes |
| `filename` | `String` | No | Original filename (stored for display + Content-Disposition) |
| `key` | `String` | No | Custom object key — only when the bucket has `allow_custom_keys = true` (see [Custom keys](#custom-keys)) |

### `Upload<Type>Payload` Fields

| Field | Type | Description |
|-------|------|-------------|
| `uploadUrl` | `String` | Presigned PUT URL. `null` if `deduplicated = true`. |
| `uploadHeaders` | `JSON` | The headers the PUT to `uploadUrl` must send, forwarded as-is: `Content-Type`, `x-amz-checksum-sha256` (the content hash, base64) and `x-amz-meta-upload-id` (the file ID). `null` if deduplicated. |
| `fileId` | `String!` | Files row UUID (existing if dedup, new if fresh). |
| `key` | `String!` | Object key. |
| `deduplicated` | `Boolean!` | `true` = a live file with the same bytes already exists at this key. Skip the PUT. |
| `expiresAt` | `String` | Presigned URL expiry. `null` if deduplicated. |
| `file` | `JSON` | Projection document `{ id, key, bucket_id, mime, size, filename }`. Store it verbatim in an `image` / `upload` column: its `id` is what keeps the object from being garbage-collected while the column references it. |

### Bulk upload

`upload<Type>s` takes the same `bucketKey` / `isPublic` / `ownerId` / `databaseId` once, plus `files: [Upload<Type>BulkFileInput!]!` (each with `contentHash`, `contentType`, `size`, `filename`, `key`). It returns `files: [Upload<Type>BulkFilePayload!]!`, one payload per file with the same fields as the single upload.

A batch is capped by the storage module's `max_bulk_files` (default 100) and `max_bulk_total_size` (default 1 GB); exceeding them fails with `BULK_UPLOAD_FILES_EXCEEDED` / `BULK_UPLOAD_SIZE_EXCEEDED`. Bucket types expose `maxBulkFiles: Int!`, so a client can size its batches before uploading.

### Validation Rules

1. `contentHash`: must match `/^[a-f0-9]{64}$/` (SHA-256 hex, lowercase)
2. `contentType`: max 255 chars, non-empty string
3. `size`: must be > 0 and ≤ the storage module's `default_max_file_size` (default 200 MB)
4. `filename`: if provided, must be ≤ `max_filename_length` (default 1024 chars)
5. `filename` and `contentType` must agree: an upload declaring `image/jpeg` under the name `payload.html` is refused with `UPLOAD_TYPE_MISMATCH` before any row exists
6. `allowed_mime_types` on bucket: if set, `contentType` must match a pattern (supports `image/*` wildcards) — `CONTENT_TYPE_NOT_ALLOWED`
7. `max_file_size` on bucket: if set, `size` must not exceed it — `FILE_TOO_LARGE`. Both this and the module limit apply.

The bytes are checked again after the PUT — see [Upload lifecycle](#upload-lifecycle).

---

## Upload lifecycle

The mutation writes the files row **before** the PUT, as `status = 'requested'`. Its insert enqueues the `storage:confirm_upload` job, which reads the stored object and settles the row:

| Status | Meaning |
|--------|---------|
| `requested` | Presigned URL issued; the bytes may not be in the store yet |
| `uploaded` | The object's SHA-256 checksum, `Content-Type` and size match the row, and it satisfies the bucket's `allowed_mime_types` / `max_file_size` |
| `processed` | Post-upload processing (image versions, text extraction, embeddings) has run |
| `rejected` | The object disagreed with the row; `rejectionReason` says why |

A `requested` row whose bytes never arrive within the upload URL's lifetime (`upload_url_expiry_seconds`, default 900) is **deleted** by the confirm job — an abandoned upload does not stay in file lists.

The presigned PUT is signed over the content hash (`x-amz-checksum-sha256`), so the store only accepts bytes that hash to the declared `contentHash`. Send `uploadHeaders` unchanged: the URL is signed over them.

### Deduplication

Dedup only ever matches a **live** row (`uploaded` or `processed`):

- A live row at the same `(bucket_id, key)` → `deduplicated: true`, `uploadUrl: null`, the existing `fileId`.
- A `requested` row at that key (an upload whose bytes never landed) is dropped and the upload proceeds as a fresh one, so a retry restarts the lifecycle instead of returning a reference to an object that is not in the store.
- No match → a new `requested` row and a presigned PUT URL.

### Custom keys

With `allow_custom_keys = true` on the bucket, `key` places the object at a caller-chosen path (max 1024 chars; must start with a letter, digit or `_`; no `..`, no leading `/`, no NUL; the `.versions/` segment is reserved for a file's rendered versions).

A custom key is **one object**: re-uploading different bytes to the same key inserts a new `requested` row beside the current one, the PUT overwrites the object, and the confirm step deletes the row it replaced. Until then the current row stays listable and downloadable. A custom key has no version chain. Re-uploading the *same* bytes to the key is a dedup hit.

---

## `provisionBucket` Mutation

Physical buckets are created by the `storage:provision_bucket` job, which runs when a bucket row is inserted. `provisionBucket` re-requests that job (for a retry or after a configuration change); it does not call the object store itself.

```graphql
mutation ProvisionBucket($input: ProvisionBucketInput!) {
  provisionBucket(input: $input) {
    bucketId              # Logical bucket row ID
    bucketKey             # Logical bucket key
    physicalName          # Recorded physical bucket name, null while reconciliation is pending
    provisionRequestedAt  # When reconciliation was last requested
  }
}
```

### `ProvisionBucketInput` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucketKey` | `String!` | Yes | Logical bucket key (e.g. `"public"`, `"private"`) |
| `ownerId` | `UUID` | No | Entity ID for entity-scoped bucket provisioning |

An upload to a bucket that has not been reconciled yet (no physical name recorded) is refused with `STORAGE_BUCKET_NOT_RECONCILED`.

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
      status
      downloadUrl   # computed at query time
    }
  }
}
```

| File type | URL format |
|-----------|------------|
| Public (`is_public = true`) | `{publicUrlPrefix}/{key}` — direct CDN URL |
| Private (`is_public = false`) | Presigned GET URL with `X-Amz-Signature` (default 1h expiry, `download_url_expiry_seconds`) |

`downloadUrl` is `null` until the upload is confirmed (status `uploaded` or `processed`), for a `rejected` file, and for a row with no `key`.

`downloadUrl` is on files-table rows. For an `image` / `upload` column on one of your own tables use `<col>Url(width)` and `<col>Versions` — see [file-columns.md](./file-columns.md).

---

## Bucket Resolution

- The files table the mutation belongs to selects the storage module (app-level or a specific entity type's storage).
- With `bucketKey`, the bucket is looked up by key (plus `ownerId` for entity-scoped storage), under the caller's RLS. No visible bucket → `BUCKET_NOT_FOUND`.
- Without `bucketKey`, the database resolves its own default bucket for the requested access (`isPublic`), so a client never has to know a tenant's bucket naming.

### CORS

The bucket provisioning job applies CORS to the physical bucket. Most specific wins:
1. **Bucket-level** `allowed_origins` column
2. **Storage module-level** `allowed_origins` column
3. **Platform default origins** — the deployment's first-party browser hosts, so a fresh database's first browser upload is not refused by CORS before anyone sets `allowed_origins`

Supports `['*']` for fully open CDN/public mode (only when set explicitly on the bucket or module).
