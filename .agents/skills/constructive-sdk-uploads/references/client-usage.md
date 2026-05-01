# Client-Side Upload Usage

## `@constructive-io/upload-client`

The upload client wraps the entire presigned URL flow into a single function call: **hash → requestUploadUrl → PUT → confirmUpload**.

```bash
pnpm add @constructive-io/upload-client
```

### `uploadFile(options)`

```typescript
import { uploadFile } from '@constructive-io/upload-client';

const result = await uploadFile({
  file: selectedFile,          // browser File or FileInput-compatible object
  bucketKey: 'avatars',
  execute: myGraphQLExecutor,  // your GraphQL client wrapper
  onProgress: (pct) => console.log(`${pct}%`),
  signal: abortController.signal, // optional cancellation
});

// result: { fileId, key, deduplicated, status }
```

### Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `file` | `FileInput` | Yes | File to upload (browser `File`, Node.js `Blob`, or compatible) |
| `bucketKey` | `string` | Yes | Bucket key (e.g. `"public"`, `"private"`, `"avatars"`) |
| `execute` | `GraphQLExecutor` | Yes | Function that runs GraphQL mutations |
| `onProgress` | `(percent: number) => void` | No | Progress callback (0–100), fires during PUT |
| `signal` | `AbortSignal` | No | Cancellation signal |

### Result (`UploadResult`)

| Field | Type | Description |
|-------|------|-------------|
| `fileId` | `string` | UUID of the file record — use this to link to domain tables |
| `key` | `string` | S3 object key (= SHA-256 content hash) |
| `deduplicated` | `boolean` | `true` if file already existed (no bytes uploaded) |
| `status` | `string` | `"ready"` for confirmed fresh uploads, `"ready"` or `"processed"` for dedup (from server). `"pending"` during upload (before `confirmUpload`). |

### `GraphQLExecutor`

A function that sends a GraphQL mutation and returns the `data` portion:

```typescript
type GraphQLExecutor = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
```

Works with any GraphQL client. Example with `fetch`:

```typescript
const execute: GraphQLExecutor = async (query, variables) => {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new UploadError('GRAPHQL_ERROR', json.errors[0].message);
  return json.data;
};
```

---

## Deduplication

The upload client computes a SHA-256 hash of the file content before calling `requestUploadUrl`. This hash becomes the S3 object key.

**How it works:**

1. Client computes `contentHash = SHA-256(fileBytes)` (hex-encoded, 64 chars)
2. `requestUploadUrl` checks: does a file with this hash already exist in the target bucket?
3. **If yes** (`deduplicated = true`):
   - `uploadUrl = null` — no presigned URL is generated
   - `fileId` = the *existing* file's UUID
   - `status` = the existing file's status (`'ready'` or `'processed'`) — file is immediately usable
   - The client **skips the PUT entirely** — the bytes are already in S3
   - No `confirmUpload` needed
4. **If no** (`deduplicated = false`):
   - `uploadUrl` = a presigned PUT URL (default 15-minute expiry)
   - `fileId` = a *new* UUID (file record created with `status = 'pending'`)
   - `status = 'pending'` — the file is **not yet usable**
   - Client must PUT the file bytes, then call `confirmUpload` to transition to `ready`

**Why it matters:**
- Saves bandwidth — identical files are never uploaded twice to the same bucket
- Saves storage — S3 stores one copy per unique content hash
- Two users uploading the same file get the same S3 key (content-addressed)
- The `uploadFile()` function handles this automatically — it checks `deduplicated` and skips the PUT if true

---

## Atomic Functions

If you need more control, use the atomic functions individually:

### `hashFile(file)`

Computes SHA-256 hash using the Web Crypto API:

```typescript
import { hashFile } from '@constructive-io/upload-client';

const hash = await hashFile(myFile);
// "e3b0c44298fc1c149afbf4c8996fb924..."
```

### `hashFileChunked(file, chunkSize?, onProgress?)`

For large files — hashes in chunks to avoid loading the entire file into memory:

```typescript
import { hashFileChunked } from '@constructive-io/upload-client';

const hash = await hashFileChunked(myFile, 1024 * 1024, (pct) => {
  console.log(`Hashing: ${pct}%`);
});
```

---

## `FileInput` Interface

The upload client accepts any object matching this interface (compatible with browser `File`):

```typescript
interface FileInput {
  readonly name: string;
  readonly size: number;
  readonly type: string;          // MIME type
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number): Blob;
}
```

---

## Error Handling

The client throws `UploadError` with typed error codes:

```typescript
import { UploadError } from '@constructive-io/upload-client';

try {
  await uploadFile({ ... });
} catch (err) {
  if (err instanceof UploadError) {
    switch (err.code) {
      case 'HASH_FAILED':     // SHA-256 computation failed
      case 'INVALID_FILE':    // File is null/empty/invalid
      case 'GRAPHQL_ERROR':   // GraphQL mutation returned errors
      case 'REQUEST_UPLOAD_URL_FAILED': // requestUploadUrl failed
      case 'PUT_UPLOAD_FAILED':         // S3 PUT failed
      case 'CONFIRM_UPLOAD_FAILED':     // confirmUpload failed
      case 'ABORTED':         // Upload cancelled via AbortSignal
    }
  }
}
```

---

## Manual Flow (without upload-client)

If you prefer to manage the flow yourself:

### GraphQL Mutations

```typescript
const REQUEST_UPLOAD_URL = `
  mutation RequestUploadUrl($input: RequestUploadUrlInput!) {
    requestUploadUrl(input: $input) {
      uploadUrl
      fileId
      key
      deduplicated
      expiresAt
    }
  }
`;

const CONFIRM_UPLOAD = `
  mutation ConfirmUpload($input: ConfirmUploadInput!) {
    confirmUpload(input: $input) {
      fileId
      status
      success
    }
  }
`;
```

### Step-by-step

```typescript
import { createHash } from 'crypto';

// 1. Hash the file
const fileContent = await file.arrayBuffer();
const contentHash = createHash('sha256')
  .update(Buffer.from(fileContent))
  .digest('hex');

// 2. Request presigned URL
const { data } = await graphqlClient.mutate({
  mutation: REQUEST_UPLOAD_URL,
  variables: {
    input: {
      bucketKey: 'public',
      contentHash,
      contentType: file.type,
      size: file.size,
      filename: file.name,
      // ownerId: entityId,  // for entity-scoped uploads
    },
  },
});

const { uploadUrl, fileId, deduplicated } = data.requestUploadUrl;

// 3. PUT to presigned URL (skip if deduplicated)
if (!deduplicated) {
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
      'Content-Length': file.size.toString(),
    },
    body: file,
  });

  // 4. Confirm upload
  await graphqlClient.mutate({
    mutation: CONFIRM_UPLOAD,
    variables: { input: { fileId } },
  });
}

// fileId is ready to use — link it to your domain tables
```

### Entity-scoped upload (with `ownerId`)

Same flow, just add `ownerId` to the input:

```typescript
const { data } = await graphqlClient.mutate({
  mutation: REQUEST_UPLOAD_URL,
  variables: {
    input: {
      bucketKey: 'documents',
      ownerId: dataRoomId,   // entity instance UUID
      contentHash,
      contentType: file.type,
      size: file.size,
      filename: file.name,
    },
  },
});
```
