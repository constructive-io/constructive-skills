---
name: constructive-storage
description: "Uploads, buckets, presigned URLs, file lifecycle — presigned URL flow (upload<FilesType> → PUT with uploadHeaders → confirm → downloadUrl), the requested/uploaded/processed/rejected file lifecycle, bucket provisioning, the dynamic storage client and upload-client, public/private/entity-scoped buckets, custom keys, MIME type restrictions, file size limits, and deduplication. Use when asked to 'upload files', 'add file uploads', 'configure storage', 'set up RustFS', 'presigned URLs', 'uploadAppFile', 'uploadHeaders', 'download URLs', 'bucket provisioning', or when working with storage plugins."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Storage

Complete file upload pipeline using presigned S3 URLs — the client uploads directly to the S3-compatible object store (RustFS locally), never routing file bytes through the GraphQL server.

Use the Storage feature pack through [`constructive-blocks`](../constructive-blocks/SKILL.md) for tenant-facing bucket and object UI. Its standalone view renders host-supplied resources and actions. Its Console module becomes available only when an explicitly configured endpoint exposes compatible storage-tagged bucket and file tables plus executable operations; an object-store endpoint alone does not prove that contract.

## When to Apply

Use this skill when:
- Adding file uploads to a Constructive app
- Configuring buckets (public, private, entity-scoped)
- Working with presigned URLs for upload and download
- Setting MIME type restrictions and file size limits
- Implementing file deduplication
- Using `createStorageClient` / `@constructive-io/upload-client`
- Reading a file's lifecycle status (`requested` → `uploaded` / `rejected`)

## Architecture

```
Client                    GraphQL Server              Object store (S3 API)
  |                            |                         |
  |-- uploadAppFile(input) --->|  files row: requested   |
  |<-- { uploadUrl,            |                         |
  |      uploadHeaders, file } |                         |
  |                            |                         |
  |-- PUT uploadUrl + file + uploadHeaders ------------->|
  |                            |                         |
  |              storage:confirm_upload job checks the object
  |              (SHA-256, Content-Type, size, bucket limits)
  |                            |  -> uploaded | rejected |
  |                            |                         |
  |-- downloadUrl query ------>|-- presigned GET URL ---->|
  |<-- signed download URL ----|  (null until uploaded)  |
```

## Packages

| Package | Purpose |
|---------|---------|
| `graphile-presigned-url-plugin` | `upload<FilesType>` / `upload<FilesType>s` mutations, `downloadUrl` computed field on files tables, `maxBulkFiles` on bucket tables, `<col>Url(width)` / `<col>Versions` on `image` / `upload` columns |
| `graphile-bucket-provisioner-plugin` | `provisionBucket` mutation: re-requests the bucket provisioning job |
| `graphile-upload-plugin` | GraphQL `Upload` scalar for stream-based uploads |
| `@constructive-io/graphql-query` | `createStorageClient`: discovers storage planes from `_meta`, builds and runs the upload mutation |
| `@constructive-io/upload-client` | Byte-level transport: `hashFile`, checksum-bound `putToPresignedUrl`, `storageTransport` |
| `@constructive-io/bucket-provisioner` | Low-level S3 bucket provisioner (CORS, policies, lifecycle) |

## Bucket Types

| Type | `is_public` | RLS | Use Case |
|------|-------------|-----|----------|
| Public | `true` | Minimal | Marketing assets, public images |
| Private | `false` | Full | User documents, sensitive files |
| Entity-scoped | `false` | Entity membership | Per-org/team file storage |

Entity-scoped buckets are provisioned via `has_storage: true` on entity types — see `constructive-entities`.

## References

| File | Content |
|------|---------|
| [client-usage.md](./references/client-usage.md) | `createStorageClient`, upload-client primitives, manual flow |
| [graphql-mutations.md](./references/graphql-mutations.md) | Upload mutations, payload, lifecycle, dedup, custom keys, `provisionBucket`, `downloadUrl` |
| [server-setup.md](./references/server-setup.md) | Presets, credentials, `storage_module` coordinates and defaults |
| [file-columns.md](./references/file-columns.md) | `image` / `upload` columns on your own tables — default image versions, `processing`, `<col>Url(width)` / `<col>Versions` |

## Cross-References

- **Entity-scoped storage:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Storage security policies:** [`constructive-security`](../constructive-security/SKILL.md)
- **File embedding pipeline:** [`constructive-agents`](../constructive-agents/SKILL.md)
- **Storage feature-pack UI:** [`constructive-blocks`](../constructive-blocks/SKILL.md)
