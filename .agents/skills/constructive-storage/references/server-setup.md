# Server Setup & Configuration

The server holds only the object-store **credentials**. Every other storage coordinate — endpoint, provider, region, public URL prefix, CORS origins, limits — is a column on the `storage_module` row, so it belongs to the database, not to the server's environment.

## PostGraphile Preset — Presigned URL Plugin

`PresignedUrlPreset` adds the per-files-table `upload<FilesType>` / `upload<FilesType>s` mutations, the `downloadUrl` field on files tables, `maxBulkFiles` on bucket tables, and `<col>Url(width)` / `<col>Versions` on `image` / `upload` columns.

```typescript
import { PresignedUrlPreset } from 'graphile-presigned-url-plugin';

const preset: GraphileConfig.Preset = {
  extends: [
    PresignedUrlPreset({
      // Lazy getter: a server that never touches storage never needs the credentials
      credentials: () => ({
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
      }),
    }),
  ],
};
```

### Plugin Options (`PresignedUrlPluginOptions`)

| Option | Type | Description |
|--------|------|-------------|
| `credentials` | `StorageCredentials \| () => StorageCredentials` | `{ accessKeyId, secretAccessKey }` for the platform object store (static or lazy getter) |
| `fileRefDomains` | `readonly string[]` | Optional. The jsonb domains whose columns get `<col>Url` / `<col>Versions`. Defaults to `image`, `upload`. |

---

## PostGraphile Preset — Bucket Provisioner Plugin

```typescript
import { BucketProvisionerPreset } from 'graphile-bucket-provisioner-plugin';

const preset: GraphileConfig.Preset = {
  extends: [BucketProvisionerPreset()],
};
```

It has **no options**. It only adds the `provisionBucket` mutation, which re-requests the `storage:provision_bucket` job for a bucket. That job — not the GraphQL server — creates the physical bucket, applies CORS and versioning, and records the bucket's physical name. Inserting a bucket row enqueues the same job.

---

## Combining Both Presets

```typescript
const preset: GraphileConfig.Preset = {
  extends: [
    PresignedUrlPreset({ credentials: () => storageCredentials }),
    BucketProvisionerPreset(),
    // ... other presets
  ],
};
```

---

## Smart Tags

The plugins use smart tags to discover storage tables:

| Tag | Applied to | Purpose |
|-----|-----------|---------|
| `@storageBuckets` | Buckets table | Pairs the buckets table with its files table; `maxBulkFiles` field |
| `@storageFiles` | Files table | `upload<FilesType>` mutations and the `downloadUrl` computed field |

The storage module generator sets these tags on the tables it creates; you never write them yourself.

---

## Environment Variables

```bash
STORAGE_ACCESS_KEY_ID=...       # object-store credentials
STORAGE_SECRET_ACCESS_KEY=...
```

These are the only storage env vars. The local stack's object store is RustFS (the `rustfs` service in the constructive `docker-compose.yml`, ports 9000/9001).

---

## Object-Store Coordinates (per storage module)

| Column | Purpose |
|--------|---------|
| `endpoint` | S3 API endpoint presigned URLs are signed for (NULL = AWS S3 regional endpoint) |
| `public_url_prefix` | URL prefix for public `downloadUrl`s (e.g. a CDN domain) |
| `provider` | Storage provider type (e.g. `rustfs`, `s3`) |
| `region` | Object-store region |
| `allowed_origins` | Default CORS origins for every bucket of this module (`['*']` = open/CDN mode) |

A NULL coordinate on a tenant's storage module inherits the platform database's platform storage module. The credentials only sign for that platform object store, so a tenant module that sets its own `endpoint` / `provider` / `region` is refused with `STORAGE_CONNECTION_OVERRIDE_REFUSED`; a platform row missing them fails with `STORAGE_CONNECTION_NOT_CONFIGURED`.

## Configurable Defaults (per storage module)

These are also `storage_module` columns; NULL means the default:

| Setting | Default | Description |
|---------|---------|-------------|
| `upload_url_expiry_seconds` | 900 (15 min) | Presigned PUT URL lifetime; also how long a `requested` row waits for its bytes |
| `download_url_expiry_seconds` | 3600 (1 hr) | Presigned GET URL lifetime |
| `default_max_file_size` | 200 MB | Max file size for every bucket of this module; a bucket's `max_file_size` can only lower it |
| `max_filename_length` | 1024 | Max filename characters |
| `max_bulk_files` | 100 | Max files per bulk upload call |
| `max_bulk_total_size` | 1 GB | Max total bytes per bulk upload call |
| `confirm_upload_delay` | 30 seconds | Delay before the confirm job first checks the object |
| `cache_ttl_seconds` | 300 (dev) / 3600 (prod) | Storage module config cache TTL |

---

## Storage Module Cache

The presigned URL plugin caches storage module configs in an LRU cache (max 50 entries) to avoid re-querying on every request. Cache TTL is 5 minutes in development, 1 hour in production.
