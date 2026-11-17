# Client-Side Upload Usage

The flow is always the same three steps: **hash → `upload<FilesType>` mutation → PUT to the presigned URL with `uploadHeaders`**. The files row then moves from `requested` to `uploaded` once the server confirms the object (see [graphql-mutations.md](./graphql-mutations.md#upload-lifecycle)).

## Dynamic storage client — `createStorageClient`

`@constructive-io/graphql-query` discovers every storage plane from `_meta` and builds the upload mutation for you, so the caller never names a mutation, input type or bucket query field. Pair it with the presigned transport from `@constructive-io/upload-client`:

```bash
pnpm add @constructive-io/graphql-query @constructive-io/upload-client
```

```typescript
import { createStorageClient } from '@constructive-io/graphql-query';
import { storageTransport } from '@constructive-io/upload-client';

const storage = createStorageClient({
  execute: myGraphQLExecutor,  // (query, variables) => Promise<data>
  transport: storageTransport, // SHA-256 hashing + checksum-bound presigned PUT
});

const result = await storage.upload(
  { filesType: 'AppFile' },    // which storage plane (files table)
  {
    file: selectedFile,        // browser File or compatible
    bucketKey: 'avatars',      // omit to use the plane's default bucket
    // isPublic: true,         // picks the default public bucket when bucketKey is omitted
    // ownerId: dataRoomId,    // required when the plane is entity-scoped
    // key: 'docs/readme.md',  // custom key (bucket must allow_custom_keys)
    signal: abortController.signal,
  },
);

// result: { fileId, key, deduplicated, expiresAt }
```

### Plane selector (`StorageSurfaceSelector`)

All provided fields must match exactly; the lookup throws when nothing, or more than one plane, matches.

| Field | Example | Description |
|-------|---------|-------------|
| `filesType` | `'AppFile'` | GraphQL type name of the files table |
| `filesTable` | `'app_files'` | PostgreSQL table name of the files table |
| `schemaName` | — | PostgreSQL schema of the files table |

`storage.discover()` returns every plane (cached after the first call); `storage.surface(selector)` resolves one.

### Errors (`StorageError`)

| Code | Meaning |
|------|---------|
| `INVALID_FILE` | No file, or an empty file |
| `OWNER_REQUIRED` | The plane is entity-scoped and no `ownerId` was given |
| `UPLOAD_MUTATION_FAILED` | The upload mutation failed or returned no payload |
| `PUT_UPLOAD_FAILED` | The PUT to the presigned URL failed |
| `HASH_FAILED` | SHA-256 computation failed |
| `ABORTED` | Cancelled via `AbortSignal` |

---

## Deduplication

The client computes a SHA-256 hash of the file content before calling the upload mutation. Without a custom key, this hash is the object key.

1. Client computes `contentHash = SHA-256(fileBytes)` (hex-encoded, 64 chars)
2. The mutation checks for a **live** file (`uploaded` / `processed`) at that key in the target bucket
3. **If yes** (`deduplicated = true`): `uploadUrl = null`, `fileId` = the existing file's UUID, and the client skips the PUT
4. **If no** (`deduplicated = false`): a new `requested` row and a presigned PUT URL (default 15-minute expiry); the client must PUT the bytes

Two users uploading the same file to the same bucket get the same object key (content-addressed). A previous upload of the same bytes that never completed is not a dedup hit; it is replaced and the upload starts again.

---

## Atomic Functions (`@constructive-io/upload-client`)

```typescript
import { hashFile, hashFileChunked, putToPresignedUrl } from '@constructive-io/upload-client';

const hash = await hashFile(myFile);  // SHA-256 via Web Crypto

// Large files: hash in chunks to avoid loading the whole file into memory
const hash2 = await hashFileChunked(myFile, 1024 * 1024, (pct) => console.log(`Hashing: ${pct}%`));

// PUT with the payload's uploadHeaders, sent as-is
await putToPresignedUrl(uploadUrl, myFile, myFile.type, { headers: uploadHeaders });
```

`putToPresignedUrl(url, body, contentType, { signal?, contentHash?, headers? })` sends `x-amz-checksum-sha256`, which the URL is signed over. When `headers` is omitted it computes the checksum from an in-memory body; a streamed body must pass `contentHash`.

---

## Manual Flow

```typescript
const UPLOAD_APP_FILE = `
  mutation UploadAppFile($input: UploadAppFileInput!) {
    uploadAppFile(input: $input) {
      uploadUrl
      uploadHeaders
      fileId
      key
      deduplicated
      expiresAt
      file
    }
  }
`;

// 1. Hash the file
const contentHash = await hashFile(file);

// 2. Request the presigned URL
const data = await execute(UPLOAD_APP_FILE, {
  input: {
    bucketKey: 'public',
    contentHash,
    contentType: file.type,
    size: file.size,
    filename: file.name,
  },
});
const { uploadUrl, uploadHeaders, fileId, deduplicated, file: fileDoc } = data.uploadAppFile;

// 3. PUT to the presigned URL (skip if deduplicated), with the exact headers returned
if (!deduplicated) {
  await putToPresignedUrl(uploadUrl, file, file.type, { headers: uploadHeaders });
}

// fileId names the files row; store fileDoc verbatim in an image/upload column
```

`uploadHeaders` is `{ 'Content-Type', 'x-amz-checksum-sha256', 'x-amz-meta-upload-id' }`. Send every header unchanged.

### Entity-scoped upload (with `ownerId`)

An entity-scoped plane has its own mutation, named from its files table (e.g. `uploadDataRoomFile` for `data_room_files`), and `ownerId` is required:

```typescript
const data = await execute(UPLOAD_DATA_ROOM_FILE, {
  input: {
    bucketKey: 'documents',
    ownerId: dataRoomId,   // entity instance UUID
    contentHash,
    contentType: file.type,
    size: file.size,
    filename: file.name,
  },
});
```

> **`uploadFile()` from `@constructive-io/upload-client` does not match the current schema.** It queries a `requestUploadUrl` field on a bucket type (`bucketByKey { requestUploadUrl(...) }`), which the server does not expose. Use `createStorageClient` or the manual flow above.
