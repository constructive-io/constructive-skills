# Environment Variables Reference

Complete list of environment variables recognized by `@pgpmjs/env` and `@constructive-io/graphql-env`.

## PostgreSQL Connection (`opts.pg`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `PGHOST` | `pg.host` | string | PostgreSQL server hostname |
| `PGPORT` | `pg.port` | number | PostgreSQL server port |
| `PGUSER` | `pg.user` | string | PostgreSQL username |
| `PGPASSWORD` | `pg.password` | string | PostgreSQL password |
| `PGDATABASE` | `pg.database` | string | Default database name |

## Database Test/Connection Options (`opts.db`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `PGROOTDATABASE` | `db.rootDb` | string | Root database for admin operations |
| `PGTEMPLATE` | `db.template` | string | Template database for creating test DBs |
| `DB_PREFIX` | `db.prefix` | string | Prefix for generated database names |
| `DB_EXTENSIONS` | `db.extensions` | string[] | Comma-separated list of extensions to install |
| `DB_CWD` | `db.cwd` | string | Working directory for DB operations |
| `DB_CONNECTION_USER` | `db.connection.user` | string | Legacy connection user |
| `DB_CONNECTION_PASSWORD` | `db.connection.password` | string | Legacy connection password |
| `DB_CONNECTION_ROLE` | `db.connection.role` | string | Legacy connection role |
| `DB_CONNECTIONS_APP_USER` | `db.connections.app.user` | string | App-level connection user |
| `DB_CONNECTIONS_APP_PASSWORD` | `db.connections.app.password` | string | App-level connection password |
| `DB_CONNECTIONS_ADMIN_USER` | `db.connections.admin.user` | string | Admin connection user |
| `DB_CONNECTIONS_ADMIN_PASSWORD` | `db.connections.admin.password` | string | Admin connection password |

## Server Options (`opts.server`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `PORT` | `server.port` | number | HTTP server port |
| `SERVER_HOST` | `server.host` | string | HTTP server host |
| `SERVER_TRUST_PROXY` | `server.trustProxy` | boolean | Trust proxy headers |
| `SERVER_ORIGIN` | `server.origin` | string | Server origin URL |
| `SERVER_STRICT_AUTH` | `server.strictAuth` | boolean | Strict authentication mode |

## CDN / S3 Storage (`opts.cdn`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `BUCKET_PROVIDER` | `cdn.provider` | `'s3'` \| `'minio'` | Storage provider |
| `BUCKET_NAME` | `cdn.bucketName` | string | S3/MinIO bucket name |
| `AWS_REGION` | `cdn.awsRegion` | string | AWS region |
| `AWS_ACCESS_KEY` or `AWS_ACCESS_KEY_ID` | `cdn.awsAccessKey` | string | AWS access key |
| `AWS_SECRET_KEY` or `AWS_SECRET_ACCESS_KEY` | `cdn.awsSecretKey` | string | AWS secret key |
| `MINIO_ENDPOINT` | `cdn.minioEndpoint` | string | MinIO endpoint URL |

## Deployment Options (`opts.deployment`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `DEPLOYMENT_USE_TX` | `deployment.useTx` | boolean | Wrap deployment in transaction |
| `DEPLOYMENT_FAST` | `deployment.fast` | boolean | Skip verification after deploy |
| `DEPLOYMENT_USE_PLAN` | `deployment.usePlan` | boolean | Use plan-based deployment |
| `DEPLOYMENT_CACHE` | `deployment.cache` | boolean | Enable deployment caching |
| `DEPLOYMENT_TO_CHANGE` | `deployment.toChange` | string | Deploy up to specific change |

## Migration Options (`opts.migrations`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `MIGRATIONS_CODEGEN_USE_TX` | `migrations.codegen.useTx` | boolean | Wrap codegen migrations in transaction |

## Jobs Configuration (`opts.jobs`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `JOBS_SCHEMA` | `jobs.schema.schema` | string | PostgreSQL schema for job tables |
| `JOBS_SUPPORT_ANY` | `jobs.worker.supportAny` / `jobs.scheduler.supportAny` | boolean | Accept any job type |
| `JOBS_SUPPORTED` | `jobs.worker.supported` / `jobs.scheduler.supported` | string[] | Comma-separated supported job types |
| `INTERNAL_GATEWAY_URL` | `jobs.gateway.gatewayUrl` | string | Internal gateway URL for job dispatch |
| `INTERNAL_JOBS_CALLBACK_URL` | `jobs.gateway.callbackUrl` | string | Callback URL for job completion |
| `INTERNAL_JOBS_CALLBACK_PORT` | `jobs.gateway.callbackPort` | number | Callback server port |

## Error Output Options (`opts.errorOutput`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `PGPM_ERROR_QUERY_HISTORY_LIMIT` | `errorOutput.queryHistoryLimit` | number | Max query history in errors |
| `PGPM_ERROR_MAX_LENGTH` | `errorOutput.maxLength` | number | Max error message length |
| `PGPM_ERROR_VERBOSE` | `errorOutput.verbose` | boolean | Verbose error output |

## SMTP Configuration (`opts.smtp`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `SMTP_HOST` | `smtp.host` | string | SMTP server hostname |
| `SMTP_PORT` | `smtp.port` | number | SMTP server port |
| `SMTP_SECURE` | `smtp.secure` | boolean | Use TLS |
| `SMTP_USER` | `smtp.user` | string | SMTP username |
| `SMTP_PASS` | `smtp.pass` | string | SMTP password |
| `SMTP_FROM` | `smtp.from` | string | Default from address |
| `SMTP_REPLY_TO` | `smtp.replyTo` | string | Default reply-to address |
| `SMTP_REQUIRE_TLS` | `smtp.requireTLS` | boolean | Require TLS connection |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `smtp.tlsRejectUnauthorized` | boolean | Reject unauthorized TLS certs |
| `SMTP_POOL` | `smtp.pool` | boolean | Use connection pooling |
| `SMTP_MAX_CONNECTIONS` | `smtp.maxConnections` | number | Max pooled connections |
| `SMTP_MAX_MESSAGES` | `smtp.maxMessages` | number | Max messages per connection |
| `SMTP_NAME` | `smtp.name` | string | SMTP client name |
| `SMTP_LOGGER` | `smtp.logger` | boolean | Enable SMTP logging |
| `SMTP_DEBUG` | `smtp.debug` | boolean | Enable SMTP debug output |

## GraphQL-Specific Env Vars (from `@constructive-io/graphql-env`)

These are only available when using `@constructive-io/graphql-env`.

### Graphile Options (`opts.graphile`)

| Env Var | Config Key | Type | Description |
|---------|-----------|------|-------------|
| `GRAPHILE_SCHEMA` | `graphile.schema` | string \| string[] | Comma-separated schema names to expose |

### Feature Flags (`opts.features`)

| Env Var | Config Key | Type | Default | Description |
|---------|-----------|------|---------|-------------|
| `FEATURES_SIMPLE_INFLECTION` | `features.simpleInflection` | boolean | `true` | Use simple inflection |
| `FEATURES_OPPOSITE_BASE_NAMES` | `features.oppositeBaseNames` | boolean | `true` | Use opposite base names |
| `FEATURES_POSTGIS` | `features.postgis` | boolean | `true` | Enable PostGIS support |

### API Options (`opts.api`)

| Env Var | Config Key | Type | Default | Description |
|---------|-----------|------|---------|-------------|
| `API_ENABLE_SERVICES` | `api.enableServicesApi` | boolean | `true` | Enable services API routing |
| `API_IS_PUBLIC` | `api.isPublic` | boolean | `true` | Public API mode (domain routing) |
| `API_EXPOSED_SCHEMAS` | `api.exposedSchemas` | string[] | `[]` | Comma-separated schemas to expose |
| `API_META_SCHEMAS` | `api.metaSchemas` | string[] | `['services_public', ...]` | Comma-separated metadata schemas |
| `API_ANON_ROLE` | `api.anonRole` | string | `'administrator'` | Anonymous role name |
| `API_ROLE_NAME` | `api.roleName` | string | `'administrator'` | Default role name |
| `API_DEFAULT_DATABASE_ID` | `api.defaultDatabaseId` | string | `'hard-coded'` | Default database identifier |

## Type Parsing Rules

- **Boolean**: Accepts `'true'`, `'1'`, `'yes'` (case-insensitive) as `true`; everything else is `false`
- **Number**: Uses `Number()` — returns `undefined` if `NaN`
- **String Array**: Splits on comma, trims whitespace, filters empty strings
- **Undefined**: If an env var is not set, that key is omitted from the options object (not set to `undefined`)
