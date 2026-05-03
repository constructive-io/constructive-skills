# Server Setup & Configuration

## PostGraphile Preset — Presigned URL Plugin

The presigned URL plugin adds `requestUploadUrl` and the `downloadUrl` computed field.

```typescript
import { PresignedUrlPreset } from 'graphile-presigned-url-plugin';
import { S3Client } from '@aws-sdk/client-s3';

const preset: GraphileConfig.Preset = {
  extends: [
    PresignedUrlPreset({
      // S3 config — lazy getter avoids reading env vars at import time
      s3: () => ({
        client: new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
          endpoint: process.env.CDN_ENDPOINT || 'http://localhost:9000',
          forcePathStyle: true, // required for MinIO
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY!,
            secretAccessKey: process.env.AWS_SECRET_KEY!,
          },
        }),
        bucket: process.env.BUCKET_NAME || 'my-uploads',
        endpoint: process.env.CDN_ENDPOINT,
        publicUrlPrefix: process.env.CDN_PUBLIC_URL, // for public file downloadUrl
      }),

      // Optional: per-database bucket naming (multi-tenant)
      resolveBucketName: (databaseId) => `app-${databaseId}`,

      // Optional: lazy-provision S3 buckets on first upload
      ensureBucketProvisioned: async (bucketName, accessType, databaseId, allowedOrigins) => {
        // create bucket with correct CORS + policies
      },
    }),
  ],
};
```

### Plugin Options (`PresignedUrlPluginOptions`)

| Option | Type | Description |
|--------|------|-------------|
| `s3` | `S3Config \| () => S3Config` | S3 client + bucket config (static or lazy getter) |
| `resolveBucketName` | `(databaseId) => string` | Custom S3 bucket name per database (multi-tenant) |
| `ensureBucketProvisioned` | `(name, type, dbId, origins) => Promise<void>` | Lazy-provision callback on first upload |

### `S3Config` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `client` | `S3Client` | Yes | AWS SDK v3 S3 client instance |
| `bucket` | `string` | Yes | S3 bucket name |
| `endpoint` | `string` | No | S3/MinIO endpoint URL |
| `region` | `string` | No | AWS region |
| `forcePathStyle` | `boolean` | No | Required for MinIO (`true`) |
| `publicUrlPrefix` | `string` | No | CDN URL prefix for public file downloads |

---

## PostGraphile Preset — Bucket Provisioner Plugin

Auto-provisions S3 buckets when bucket rows are created via GraphQL mutations.

```typescript
import { BucketProvisionerPreset } from 'graphile-bucket-provisioner-plugin';

const preset: GraphileConfig.Preset = {
  extends: [
    BucketProvisionerPreset({
      connection: () => ({
        provider: 'minio',
        region: process.env.AWS_REGION || 'us-east-1',
        endpoint: process.env.CDN_ENDPOINT || 'http://localhost:9000',
        accessKeyId: process.env.AWS_ACCESS_KEY!,
        secretAccessKey: process.env.AWS_SECRET_KEY!,
      }),
      allowedOrigins: ['https://app.example.com'],
      autoProvision: true,    // wrap create* mutations on @storageBuckets tables
      versioning: false,       // S3 bucket versioning
      bucketNamePrefix: 'myapp', // "myapp-public", "myapp-private"
    }),
  ],
};
```

### Plugin Options (`BucketProvisionerPluginOptions`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connection` | `StorageConnectionConfig \| () => StorageConnectionConfig` | — | S3 credentials and endpoint |
| `allowedOrigins` | `string[]` | — | CORS origins for browser uploads |
| `autoProvision` | `boolean` | `true` | Auto-provision on create mutations |
| `versioning` | `boolean` | `false` | Enable S3 bucket versioning |
| `bucketNamePrefix` | `string` | — | Prefix for S3 bucket names |
| `resolveBucketName` | `(key, dbId) => string` | — | Custom name resolver (overrides prefix) |

### CORS Resolution Hierarchy

Most specific wins:
1. **Bucket-level** `allowed_origins` column on the bucket row
2. **Storage module-level** `allowed_origins` column on `storage_module`
3. **Plugin config** `allowedOrigins`

Set `['*']` for fully open CDN/public mode.

---

## Combining Both Presets

```typescript
const preset: GraphileConfig.Preset = {
  extends: [
    PresignedUrlPreset({ s3: () => s3Config }),
    BucketProvisionerPreset({
      connection: () => connectionConfig,
      allowedOrigins: ['https://app.example.com'],
    }),
    // ... other presets
  ],
};
```

---

## Smart Tags

The plugins use smart tags to discover storage tables:

| Tag | Applied to | Purpose |
|-----|-----------|---------|
| `@storageBuckets` | Buckets table | Bucket provisioner wraps create/update mutations |
| `@storageFiles` | Files table | `downloadUrl` computed field is added |

These tags are set automatically by the storage module generator in constructive-db via SQL comments:
```sql
COMMENT ON TABLE buckets IS E'@storageBuckets\nStorage buckets table';
COMMENT ON TABLE files IS E'@storageFiles\nStorage files table';
```

---

## Environment Variables

```bash
# S3/MinIO connection
CDN_ENDPOINT=http://localhost:9000     # S3-compatible endpoint
AWS_REGION=us-east-1
AWS_ACCESS_KEY=minioadmin              # MinIO default credentials
AWS_SECRET_KEY=minioadmin
BUCKET_NAME=my-uploads                 # Default S3 bucket name
BUCKET_PROVIDER=minio                  # "minio" | "s3" | "gcs"

# Public URL
CDN_PUBLIC_URL=http://localhost:9000   # URL prefix for public file downloads
```

---

## Configurable Defaults (per storage module)

These defaults are stored in the `storage_module` table and can be overridden per-database:

| Setting | Default | Description |
|---------|---------|-------------|
| `upload_url_expiry_seconds` | 900 (15 min) | Presigned PUT URL lifetime |
| `download_url_expiry_seconds` | 3600 (1 hr) | Presigned GET URL lifetime |
| `default_max_file_size` | 200 MB | Max file size (bucket-level overrides this) |
| `max_filename_length` | 1024 | Max filename characters |
| `cache_ttl_seconds` | 300 (dev) / 3600 (prod) | Storage module config cache TTL |

---

## Storage Module Cache

The presigned URL plugin caches storage module configs in an LRU cache (max 50 entries) to avoid re-querying metaschema on every request. Cache TTL is 5 minutes in development, 1 hour in production.

Bucket configs are also cached per `(databaseId, bucketKey, ownerId)` tuple.
