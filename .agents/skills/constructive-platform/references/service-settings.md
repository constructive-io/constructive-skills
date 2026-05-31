# Service Settings Reference

Typed configuration tables in `services_public` that control per-database and per-API runtime behavior. These replace legacy `api_modules` JSONB blobs with typed, FK-validated columns.

All examples use the codegen'd ORM. No raw SQL.

---

## cors_settings

Per-database and per-API CORS origin configuration.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `database_id` | uuid (FK → database) | Metaschema database reference |
| `api_id` | uuid (FK → apis), nullable | Per-API override; NULL = database-wide default |
| `allowed_origins` | text[] | Array of allowed CORS origins (e.g. `https://example.com`) |

**Unique constraint:** `(database_id, api_id)` — one row per database/API combination.

```ts
// Database-wide CORS default
await db.corsSettings.create({
  data: {
    databaseId,
    allowedOrigins: ['https://app.example.com', 'https://admin.example.com']
  }
});

// Per-API CORS override
await db.corsSettings.create({
  data: {
    databaseId,
    apiId: publicApiId,
    allowedOrigins: ['https://app.example.com']
  }
});
```

---

## database_settings

Database-wide feature flags controlling which platform capabilities are available to all APIs in this database.

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `enable_aggregates` | boolean | `false` | Aggregate queries (sum, avg, min, max) |
| `enable_postgis` | boolean | `true` | PostGIS spatial types and operators |
| `enable_search` | boolean | `true` | Unified search (tsvector, BM25, pg_trgm, pgvector) |
| `enable_direct_uploads` | boolean | `true` | Direct (multipart) file upload mutations |
| `enable_presigned_uploads` | boolean | `true` | Presigned URL upload flow for S3/MinIO |
| `enable_many_to_many` | boolean | `true` | Many-to-many relationship queries |
| `enable_connection_filter` | boolean | `true` | Connection filter (where argument) |
| `enable_ltree` | boolean | `true` | Ltree hierarchical data type support |
| `enable_llm` | boolean | `false` | LLM/AI integration features |
| `enable_realtime` | boolean | `false` | Realtime subscriptions (cursor-tracked change delivery) |
| `enable_bulk` | boolean | `false` | Bulk mutation operations (insert, upsert, update, delete) |
| `enable_i18n` | boolean | `false` | Internationalization plugin (localeStrings, translation table discovery) |
| `options` | jsonb | `{}` | Extensible JSON for additional settings |

**Unique constraint:** one row per `database_id`.

```ts
await db.databaseSettings.create({
  data: {
    databaseId,
    enableAggregates: true,
    enableRealtime: true,
    enableBulk: true,
    enableI18n: false
  }
});
```

---

## api_settings

Per-API feature flag overrides. Columns mirror `database_settings` but are **nullable** — `NULL` means inherit from the database default, explicit `true`/`false` overrides it.

| Column | Type | Purpose |
|--------|------|---------|
| `database_id` | uuid (FK → database) | Metaschema database reference |
| `api_id` | uuid (FK → apis), unique | API these settings override for |
| `enable_*` | boolean, nullable | Same 12 flags as `database_settings` — NULL = inherit |
| `options` | jsonb | Extensible JSON for per-API settings |

```ts
// Override: disable bulk mutations for the public API
await db.apiSettings.create({
  data: {
    databaseId,
    apiId: publicApiId,
    enableBulk: false,
    enableRealtime: null  // inherit from database_settings
  }
});
```

---

## rls_settings

Per-database RLS module runtime configuration. References the schema and function IDs for the authentication and role resolution functions.

| Column | Type | Purpose |
|--------|------|---------|
| `database_id` | uuid (FK → database), unique | Database these settings apply to |
| `authenticate_schema_id` | uuid (FK → schema) | Schema containing authenticate functions |
| `role_schema_id` | uuid (FK → schema) | Schema containing current_role functions |
| `authenticate_function_id` | uuid (FK → function) | The `authenticate` function |
| `authenticate_strict_function_id` | uuid (FK → function) | The `authenticate_strict` function |
| `current_role_function_id` | uuid (FK → function) | The `current_role` function |
| `current_role_id_function_id` | uuid (FK → function) | The `current_role_id` function |
| `current_user_agent_function_id` | uuid (FK → function) | The `current_user_agent` function |
| `current_ip_address_function_id` | uuid (FK → function) | The `current_ip_address` function |

Typically populated automatically by `rls_module` during provisioning. The GraphQL server reads this table at startup to wire request-level authentication.

---

## pubkey_settings

Per-database public-key / crypto auth runtime configuration. Used for blockchain wallet authentication (Cosmos, Ethereum, etc.).

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `database_id` | uuid, unique | — | Database reference |
| `schema_id` | uuid (FK → schema) | — | Schema containing crypto auth functions |
| `crypto_network` | text | `'cosmos'` | Crypto network for key derivation |
| `user_field` | text | `'user_id'` | Field name for user identification |
| `sign_up_with_key_function_id` | uuid (FK → function) | — | Sign-up-with-key function |
| `sign_in_request_challenge_function_id` | uuid (FK → function) | — | Challenge request function |
| `sign_in_record_failure_function_id` | uuid (FK → function) | — | Failure recording function |
| `sign_in_with_challenge_function_id` | uuid (FK → function) | — | Sign-in-with-challenge function |

---

## webauthn_settings

Per-database WebAuthn / passkey runtime configuration.

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `database_id` | uuid, unique | — | Database reference |
| `schema_id` | uuid (FK → schema) | — | Schema containing WebAuthn auth procedures |
| `credentials_table_id` | uuid (FK → table) | — | Reference to webauthn_credentials table |
| `sessions_table_id` | uuid (FK → table) | — | Reference to sessions table |
| `rp_id` | text | `''` | WebAuthn Relying Party ID (typically domain name) |
| `rp_name` | text | `''` | Relying Party display name |
| `origin_allowlist` | text[] | `{}` | Allowed origins for WebAuthn ceremonies |
| `attestation_type` | text | `'none'` | Attestation type: `none`, `indirect`, `direct`, `enterprise` |
| `require_user_verification` | boolean | `false` | Whether UV is required for assertions |
| `resident_key` | text | `'required'` | Resident key preference: `discouraged`, `preferred`, `required` |
| `challenge_expiry_seconds` | bigint | `300` | Challenge TTL in seconds (5 min default) |

---

## apps

Mobile and native app configuration in `services_public`, linked to a site.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid | Primary key |
| `database_id` | uuid (FK → database) | Database this app belongs to |
| `site_id` | uuid (FK → sites), unique | Associated site (one app per site) |
| `name` | text | Display name |
| `app_image` | image | App icon or promotional image |
| `app_store_link` | url | Apple App Store listing URL |
| `app_store_id` | text | Apple App Store application identifier |
| `app_id_prefix` | text | Apple App ID prefix (Team ID) for universal links |
| `play_store_link` | url | Google Play Store listing URL |

```ts
await db.apps.create({
  data: {
    databaseId,
    siteId,
    name: 'My App',
    appStoreLink: 'https://apps.apple.com/app/id123456',
    playStoreLink: 'https://play.google.com/store/apps/details?id=com.example.app'
  }
});
```
