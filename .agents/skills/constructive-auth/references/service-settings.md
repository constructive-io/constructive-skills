# Service Settings Reference

Typed configuration tables in `services_public` that control per-database and per-API runtime behavior. Settings are typed, FK-validated columns rather than JSONB blobs.

All examples use the codegen'd ORM. No raw SQL.

---

## cors_settings — `db.corsSetting`

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
await db.corsSetting
  .create({
    data: { databaseId, allowedOrigins: ['https://app.example.com', 'https://admin.example.com'] },
    select: { id: true, allowedOrigins: true },
  })
  .unwrap();

// Per-API CORS override
await db.corsSetting
  .create({
    data: { databaseId, apiId: publicApiId, allowedOrigins: ['https://app.example.com'] },
    select: { id: true, apiId: true },
  })
  .unwrap();
```

---

## database_settings — `db.databaseSetting`

Database-wide feature flags plus the scope-wide layer of the **request-protection cascade**. One row per `databaseId`. Generated model: `db.databaseSetting` (api target / default `constructive-sdk`).

### Feature flags (boolean, required, seeded at provisioning)

| Field | Default | Purpose |
|-------|---------|---------|
| `enableAggregates` | `false` | Aggregate queries (sum, avg, min, max) |
| `enablePostgis` | `true` | PostGIS spatial types and operators |
| `enableSearch` | `true` | Unified search (tsvector, BM25, pg_trgm, pgvector) |
| `enableDirectUploads` | `true` | Direct (multipart) file upload mutations |
| `enablePresignedUploads` | `true` | Presigned URL upload flow |
| `enableManyToMany` | `true` | Many-to-many relationship queries |
| `enableConnectionFilter` | `true` | Connection filter (`where` argument) |
| `enableLtree` | `true` | Ltree hierarchical type support |
| `enableLlm` | `false` | LLM/AI integration features |
| `enableRealtime` | `false` | Realtime subscriptions (cursor-tracked change delivery) |
| `enableBulk` | `false` | Bulk mutations (insert, upsert, update, delete) |
| `enableBilling` | `false` | Billing activation gate — financial provider actions are refused while `false` |
| `enableIntrospection` | `true` | GraphQL introspection. Stored default is the permissive end; turning it **off** is the opt-in |

`enable_i18n` exists in the module definition but is not present in the current generated `DatabaseSetting` type — confirm with introspection before relying on it (see `constructive-i18n`).

### Request-protection bounds (nullable; `null` = inherit the platform default)

Every bound is a **lower-only cascade**: effective value = `clamp(LEAST(apiSetting override, databaseSetting) ?? platform default, floor, platform max)`. A scope may lower a bound, never raise it past the platform ceiling (code constants, not rows). The platform-side hard limits and the refusal behaviour when a bound is hit are described in `constructive-platform`.

| Field | Type | Purpose |
|-------|------|---------|
| `statementTimeoutMs` | bigint (string in TS) | GraphQL statement timeout; also clamped by the plan cap at read time |
| `idleInTransactionTimeoutMs` | bigint (string in TS) | Idle-in-transaction timeout |
| `lockTimeoutMs` | bigint (string in TS) | Lock acquisition timeout |
| `maxConcurrentRequests` | integer | Concurrently executing GraphQL requests |
| `maxQueueWaitMs` | integer | Max time a request waits for a concurrency slot |
| `rateLimitRpm` | integer | Request rate limit, requests per minute |
| `rateLimitBurst` | integer | Rate-limit burst allowance |
| `maxQueryDepth` | integer | Maximum GraphQL query depth |
| `maxQueryCost` | integer | Maximum GraphQL query cost |
| `maxPageSize` | integer | Maximum connection page size |
| `maxRequestBytes` | integer | Maximum request body size |

Other fields: `options` (jsonb), `annotations`, `labels` (jsonb), `createdAt`, `updatedAt`.

```ts
// The row is created at provisioning — read it, then update in place.
const { databaseSettings } = await db.databaseSetting
  .findMany({
    where: { databaseId: { equalTo: databaseId } },
    first: 1,
    select: { id: true, enableIntrospection: true, rateLimitRpm: true, statementTimeoutMs: true },
  })
  .unwrap();

await db.databaseSetting
  .update({
    where: { id: databaseSettings.nodes[0].id },
    data: {
      enableRealtime: true,
      enableBulk: true,
      enableIntrospection: false,      // opt in to hiding the schema
      rateLimitRpm: 600,               // lower than the platform default
      statementTimeoutMs: '5000',      // bigint travels as a string
    },
    select: { id: true, enableRealtime: true, rateLimitRpm: true },
  })
  .unwrap();
```

---

## api_settings — `db.apiSetting`

Per-API overrides. Same fields as `db.databaseSetting` (minus `enableBilling`, `annotations`, `labels`) plus `apiId`, all **nullable** — `null` means inherit from the database row; an explicit value overrides it, and for the request-protection bounds it may only lower the effective value.

```ts
await db.apiSetting
  .create({
    data: {
      databaseId,
      apiId: publicApiId,
      enableBulk: false,               // public API: no bulk mutations
      maxQueryDepth: 8,                // tighter than the database default
      maxPageSize: 50,
      // enableRealtime omitted -> inherits from databaseSetting
    },
    select: { id: true, apiId: true, enableBulk: true, maxQueryDepth: true },
  })
  .unwrap();
```

---

## rls_settings — `db.rlsSetting`

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

## pubkey_settings — `db.pubkeySetting`

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

## webauthn_settings — `db.webauthnSetting`

Per-database WebAuthn / passkey runtime configuration (one row per `databaseId`, created by the webauthn module at provisioning). Generated fields:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `rpId` | text | `''` | Relying Party ID (typically the site's registrable domain) |
| `rpName` | text | `''` | Relying Party display name |
| `originAllowlist` | text[] | `[]` | Origins allowed to run ceremonies |
| `attestationType` | text | `'none'` | `none`, `indirect`, `direct`, `enterprise` |
| `requireUserVerification` | boolean | `false` | Require UV on assertions |
| `residentKey` | text | `'required'` | `discouraged`, `preferred`, `required` |
| `challengeExpirySeconds` | bigint (string in TS) | `300` | Challenge TTL |
| `schemaId`, `credentialsSchemaId`, `credentialsTableId`, `sessionsSchemaId`, `sessionsTableId`, `sessionCredentialsTableId`, `sessionSecretsSchemaId`, `sessionSecretsTableId`, `userFieldId` | uuid FKs | — | Wiring to the generated tables; populated by the module, do not edit |

```ts
await db.webauthnSetting
  .update({
    where: { id: webauthnSettingId },
    data: {
      rpId: 'app.example.com',
      rpName: 'Example',
      originAllowlist: ['https://app.example.com'],
      requireUserVerification: true,
    },
    select: { id: true, rpId: true, originAllowlist: true },
  })
  .unwrap();
```

**Credentials** live in the auth target as `auth.webauthnCredential` (fields: `credentialId`, `publicKey`, `signCount`, `transports`, `credentialDeviceType`, `backupEligible`, `backupState`, `name`, `lastUsedAt`, `webauthnUserId`, `ownerId`). Listing/renaming/deleting a user's passkeys is plain ORM CRUD on that model. **SDK gap:** there is no generated `register*`/`signIn*Webauthn` ceremony operation in any target — the registration and assertion ceremonies are not callable from the ORM today; do not invent one.

---

## apps (removed)

The old `services_public.apps` table (`app_store_link`, `app_id_prefix`, …) no longer exists and there is no `app`/`apps` ORM model. Mobile app association is now `siteAppLink` + `siteDeepLink` — see the `constructive-sites` skill (`references/app-links.md`).
