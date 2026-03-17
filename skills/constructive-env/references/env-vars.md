# Environment Variables Reference

The canonical source of truth for all recognized environment variables lives in the source code. Do not maintain a separate list — always refer to these files directly.

## Source Files

### Core PGPM Env Vars

**File:** `pgpm/env/src/env.ts` in the `constructive` repo

This file defines `getEnvVars()` which maps `process.env` keys to the `PgpmOptions` type. Every env var the system recognizes is defined here via conditional spreads:

```typescript
// Pattern used throughout env.ts:
...(process.env.PGHOST && { host: process.env.PGHOST }),
...(process.env.PGPORT && { port: parseEnvNumber(process.env.PGPORT) }),
```

Covers: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DB_*`, `SERVER_*`, `PORT`, `BUCKET_*`, `AWS_*`, `MINIO_*`, `DEPLOYMENT_*`, `JOBS_*`, `SMTP_*`, `PGPM_ERROR_*`

### GraphQL-Specific Env Vars

**File:** `graphql/env/src/env.ts` in the `constructive` repo

This file defines `getGraphQLEnvVars()` which adds GraphQL/Constructive-specific env vars on top of the core PGPM set.

Covers: `GRAPHILE_SCHEMA`, `FEATURES_*`, `API_*`

## Type Definitions

The TypeScript interfaces that define the shape of these options:

- **`PgpmOptions`** — `pgpm/types/src/options.ts`
- **`ConstructiveOptions`** — `graphql/types/src/constructive.ts`
- **`GraphileOptions`** — `graphql/types/src/graphile.ts`
- **`PgConfig`** — `pgpm/types/src/pg.ts`

## Type Parsing

The env parsing uses three type-safe parsers (defined in `pgpm/env/src/env.ts`):

- **`parseEnvBoolean(val)`** — Accepts `'true'`, `'1'`, `'yes'` (case-insensitive) as `true`
- **`parseEnvNumber(val)`** — Uses `Number()`, returns `undefined` if `NaN`
- **`parseEnvStringArray(val)`** — Splits on comma, trims whitespace, filters empty strings

If an env var is not set, that key is omitted entirely from the options object — it does not get set to `undefined`. This allows the merge hierarchy to fall through to defaults or config file values.
