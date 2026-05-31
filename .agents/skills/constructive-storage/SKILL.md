---
name: constructive-storage
description: "Uploads, buckets, presigned URLs, file lifecycle — presigned URL flow (requestUploadUrl → PUT → downloadUrl), bucket provisioning, upload-client, public/private/entity-scoped buckets, MIME type restrictions, file size limits, and deduplication. Use when asked to 'upload files', 'add file uploads', 'configure storage', 'set up MinIO', 'presigned URLs', 'download URLs', 'bucket provisioning', or when working with storage plugins."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Storage

Complete file upload pipeline using presigned S3 URLs — the client uploads directly to S3/MinIO, never routing file bytes through the GraphQL server.

## When to Apply

Use this skill when:
- Adding file uploads to a Constructive app
- Configuring buckets (public, private, entity-scoped)
- Working with presigned URLs for upload and download
- Setting MIME type restrictions and file size limits
- Implementing file deduplication
- Using the `@constructive-io/upload-client` library

## Architecture

```
Client                    GraphQL Server              S3/MinIO
  |                            |                         |
  |-- requestUploadUrl() ----->|                         |
  |<-- { uploadUrl, key } -----|                         |
  |                            |                         |
  |-- PUT uploadUrl + file ----|------------------------>|
  |                            |                         |
  |-- downloadUrl query ------>|-- presigned GET URL ---->|
  |<-- signed download URL ----|                         |
```

## Packages

| Package | Purpose |
|---------|---------|
| `graphile-presigned-url-plugin` | `requestUploadUrl` mutation, `downloadUrl` computed field |
| `graphile-bucket-provisioner-plugin` | Auto-provisions S3 buckets on row creation |
| `graphile-upload-plugin` | GraphQL `Upload` scalar for stream-based uploads |
| `@constructive-io/upload-client` | Client orchestrator: hash → requestUploadUrl → PUT |
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
| [client-usage.md](./references/client-usage.md) | Upload client library usage and patterns |
| [graphql-mutations.md](./references/graphql-mutations.md) | GraphQL mutation reference for uploads |
| [server-setup.md](./references/server-setup.md) | Server-side plugin configuration |

## Cross-References

- **Entity-scoped storage:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Storage security policies:** [`constructive-security`](../constructive-security/SKILL.md)
- **File embedding pipeline:** [`constructive-agents`](../constructive-agents/SKILL.md)
