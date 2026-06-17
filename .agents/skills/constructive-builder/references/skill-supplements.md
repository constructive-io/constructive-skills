# Skill Supplements

Supplements for unclear or missing parts in skills. Agents should read this when executing the corresponding phase.

---

## Phase 2.3: Blueprint Provision Template (Recommended)

> **Blueprint is Constructive's declarative schema provisioning system.** Define a complete domain schema (tables, fields, relations, RLS policies, indexes, search) in TypeScript using typed `BlueprintDefinition` objects from `node-type-registry`, and create everything in a single execution via `constructBlueprint`.

### Provision Package Structure

The provision package lives at `packages/provision/` and has **two separate scripts**:

```
packages/provision/
├── package.json
├── src/
│   ├── config.ts           ← Centralized env config
│   ├── helpers.ts           ← Retry logic, SDK client factories
│   ├── blueprint.ts         ← provisionBlueprint() engine
│   ├── create-db.ts         ← Step 1: Sign up + create database → writes .env
│   ├── provision.ts         ← Step 2: Multi-pass schema orchestrator
│   └── schemas/
│       ├── core.ts          ← Domain tables (one file per domain)
│       └── search.ts        ← Search configuration (separate pass)
```

**Two-step workflow:**
1. `pnpm run create-db` — Signs up, provisions database, writes credentials to `.env`
2. `pnpm run provision` — Reads `.env`, runs all schema modules sequentially

### package.json

```json
{
  "name": "@<app>/provision",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "create-db": "tsx src/create-db.ts",
    "provision": "tsx src/provision.ts",
    "build": "echo 'No build required'"
  },
  "dependencies": {
    "@constructive-io/sdk": "^0.23.3",
    "dotenv": "^16.5.0",
    "node-type-registry": "^0.43.1",
    "pg": "^8.16.0"
  },
  "devDependencies": {
    "@types/pg": "^8.15.4",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
```

> **Note:** Use `@constructive-io/sdk` for all SDK access. It supports both Node.js and browser environments.

### config.ts

```typescript
/**
 * config.ts — Centralized configuration for provisioning
 */
import dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root (cwd is packages/provision/ when run via pnpm)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export const config = {
  // Metaschema READS only (e.g. resolving a database) live on api.localhost.
  apiEndpoint: process.env.API_ENDPOINT || 'http://api.localhost:3000/graphql',
  // Provisioning + blueprint WRITES (databaseProvisionModule, createBlueprint,
  // constructBlueprint, secureTableProvision, field/relation provision) live ONLY
  // on modules.localhost — they 404 on api.localhost. See gotchas PROVISION-001 / F4.
  modulesEndpoint: process.env.MODULES_ENDPOINT || 'http://modules.localhost:3000/graphql',
  authEndpoint: process.env.AUTH_ENDPOINT || 'http://auth.localhost:3000/graphql',
  databaseName: process.env.DATABASE_NAME || 'myapp',
  databaseId: process.env.DATABASE_ID,
  // PHYSICAL hub Postgres DB that holds the metaschema AND every per-tenant schema.
  // ⚠️ `eval "$(pgpm env)"` sets PGDATABASE=postgres, which is the WRONG db for tenant SQL —
  // the metaschema and all per-app schemas live in the physical db `constructive`. So the
  // post-provision Pool steps MUST connect to this, NOT the ambient PGDATABASE (=postgres);
  // otherwise membership-approve / auto-verify-email / users self-update all SILENTLY no-op
  // (0 rows). Override via PG_HUB_DATABASE only if your hub db is named differently.
  pgDatabase: process.env.PG_HUB_DATABASE || 'constructive',
  // The signup userId persisted by create-db. In the single-actor provisioning flow the
  // signup user IS the org owner (users == orgs), so blueprint writes read ownerId from
  // here instead of querying database.findOne (F7).
  ownerId: process.env.OWNER_ID,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@myapp.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'Password123!',
  accessToken: process.env.ACCESS_TOKEN,
  get authHeaders(): Record<string, string> {
    return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
  },
};
```

### helpers.ts

```typescript
/**
 * helpers.ts — Shared utilities for provisioning
 *
 * Uses @constructive-io/sdk for GraphQL SDK access.
 */
import { public_, auth } from '@constructive-io/sdk';
import { config } from './config.js';

/** Retry helper — rethrows "already exists" immediately (idempotency). */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  delayMs = 2000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists') || msg.includes('exists')) throw err;
      if (attempt === maxRetries) throw err;
      console.log(`   Attempt ${attempt}/${maxRetries} failed: ${msg.slice(0, 120)}. Retrying in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

/**
 * Provisioning / blueprint client.
 *
 * databaseProvisionModule, createBlueprint, constructBlueprint, secureTableProvision,
 * and field/relation provision all live ONLY on modules.localhost — they 404 on
 * api.localhost (which is metaschema READS only). So this client targets
 * `config.modulesEndpoint`. See gotchas PROVISION-001 / F4.
 */
export function createModulesClient(): ReturnType<typeof public_.createClient> {
  const token = config.accessToken;
  if (!token) throw new Error('ACCESS_TOKEN is required — run create-db first');
  return public_.createClient({
    endpoint: config.modulesEndpoint,
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Back-compat alias — older modules imported `createPlatformClient`. It now points at
// the modules endpoint (provisioning/blueprint writes), NOT api.localhost.
export const createPlatformClient = createModulesClient;

/** Auth client for sign-up / sign-in. */
export function createAuthClient(): ReturnType<typeof auth.createClient> {
  return auth.createClient({
    endpoint: config.authEndpoint,
  });
}

/** Get database ID from config, throw if missing. */
export function requireDatabaseId(): string {
  const id = config.databaseId;
  if (!id) { console.error('Missing DATABASE_ID. Run create-db first.'); process.exit(1); }
  return id;
}

/**
 * Get the owner_id (the signup userId) from config, throw if missing.
 *
 * create-db persists the signUp userId as OWNER_ID in .env; blueprint writes use it as
 * the owner instead of querying database.findOne (which 404s on the modules endpoint and
 * is unnecessary — users == orgs in this single-actor flow). See F7.
 */
export function requireOwnerId(): string {
  const id = config.ownerId;
  if (!id) { console.error('Missing OWNER_ID. Run create-db first (it persists the signup userId).'); process.exit(1); }
  return id;
}

export type PlatformClient = ReturnType<typeof createModulesClient>;
```

### blueprint.ts (Provision Engine)

```typescript
/**
 * blueprint.ts — Blueprint provision engine
 *
 * Types are imported from node-type-registry (generated from the node type
 * source of truth). The GraphQL API accepts plain JSONB; these types provide
 * client-side autocomplete and validation.
 *
 * Phases (server-side):
 *   1. Tables (with fields, nodes, policies, grants)
 *   2. Relations (HasMany, BelongsTo, ManyToMany)
 *   3. Indexes (HNSW, BM25, B-tree, GIN, GIST, trigram)
 *   4. Full-text search (TSVector weighted multi-field)
 */

import type {
  BlueprintDefinition,
  BlueprintTable,
  BlueprintNode,
  BlueprintRelation,
  BlueprintField,
  BlueprintPolicy,
  BlueprintIndex,
  BlueprintFullTextSearch,
} from 'node-type-registry';

import {
  createModulesClient,
  requireDatabaseId,
  requireOwnerId,
  withRetry,
  type PlatformClient,
} from './helpers.js';

// Re-export types for schema modules
export type {
  BlueprintDefinition, BlueprintTable, BlueprintNode,
  BlueprintRelation, BlueprintField, BlueprintPolicy,
  BlueprintIndex, BlueprintFullTextSearch,
};

const databaseId = requireDatabaseId();

/**
 * Provision a blueprint definition via the server-side constructBlueprint
 * mutation. All four phases run server-side in a single transaction.
 *
 * Returns a ref_map of { ref -> tableId } for cross-schema references.
 */
export async function provisionBlueprint(
  definition: BlueprintDefinition,
  label: string,
  client?: PlatformClient,
): Promise<Map<string, string>> {
  // Blueprint writes (createBlueprint / constructBlueprint) live on modules.localhost,
  // NOT api.localhost — see helpers.createModulesClient / gotchas PROVISION-001 (F4).
  const sdk = client ?? createModulesClient();

  console.log(`\n  ${label}\n`);

  // 1. Resolve the owner_id.
  //
  // Do NOT query `database.findOne` for ownerId (it is a metaschema read that 404s on
  // the modules endpoint, and is unnecessary here). The owner is the user that signed up
  // and provisioned the DB in create-db.ts. In this single-actor flow the signup user IS
  // the org owner (users == orgs), so create-db persists that id to .env as OWNER_ID
  // (the signUp userId). Read it back from the environment (F7).
  const ownerId = requireOwnerId();

  // 2. Create a draft blueprint record
  const blueprintName = `app_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
  const serverDef: Record<string, unknown> = {
    // Forward ONLY the object-form `grants` ([{ roles, privileges }]). Do NOT forward a
    // separate `grant_roles` field: the bare `grant_roles` + bare-[[priv,cols]]-tuple shape is
    // STALE — constructBlueprint silently applies NO `GRANT … TO authenticated`, so every
    // authenticated per-DB write returns `permission denied` and a "green build" has zero CRUD
    // (the #1 hand-grant workaround 10/11 agents paid). The object-form below is probe-proven to
    // apply all four GRANTs server-side. See gotchas F3 ("authenticated grants + RLS").
    tables: definition.tables.map((t) => ({
      ref: t.ref,
      table_name: t.table_name,
      nodes: t.nodes,
      fields: t.fields,
      grants: t.grants,
      policies: t.policies,
      ...(t.unique_constraints ? { unique_constraints: t.unique_constraints } : {}),
    })),
    relations: definition.relations,
    indexes: definition.indexes ?? [],
    full_text_searches: definition.full_text_searches ?? [],
  };

  const bpResult = await withRetry(() =>
    sdk.blueprint.create({
      data: { ownerId, databaseId, name: blueprintName, displayName: label, definition: serverDef },
      select: { id: true },
    }).unwrap()
  );
  const blueprintId = (bpResult as Record<string, Record<string, Record<string, string>>>)
    ?.createBlueprint?.blueprint?.id;
  if (!blueprintId) throw new Error('Failed to create blueprint record');

  console.log(`   Blueprint: ${blueprintId}`);

  // 3. Execute all 4 phases server-side
  const constructResult = await withRetry(() =>
    sdk.mutation.constructBlueprint(
      { input: { blueprintId } },
      { select: { result: true } },
    ).unwrap()
  );

  const refMapJson = (constructResult as Record<string, Record<string, unknown>>)
    ?.constructBlueprint?.result;
  if (!refMapJson) {
    const bpCheck = await sdk.blueprint.findOne({
      id: blueprintId,
      select: { blueprintConstructions: { select: { status: true, errorDetails: true } } },
    }).unwrap() as Record<string, Record<string, { nodes: Array<{ status: string; errorDetails: string | null }> }>>;
    const constructions = bpCheck?.blueprint?.blueprintConstructions?.nodes ?? [];
    const failed = constructions.find((c) => c.status === 'failed');
    throw new Error(`constructBlueprint failed: ${failed?.errorDetails ?? 'unknown error'}`);
  }

  // 4. Parse ref_map
  const refMap = new Map<string, string>();
  for (const [ref, tableId] of Object.entries(refMapJson as Record<string, string>)) {
    refMap.set(ref, tableId);
  }

  const tableCount = definition.tables.length;
  const relCount = definition.relations?.length ?? 0;
  const idxCount = definition.indexes?.length ?? 0;
  const ftsCount = definition.full_text_searches?.length ?? 0;
  console.log(`   Done: ${tableCount} tables, ${relCount} relations, ${idxCount} indexes, ${ftsCount} FTS configs`);
  console.log(`   ref_map: ${refMap.size} entries\n`);

  return refMap;
}
```

### create-db.ts

```typescript
/**
 * create-db.ts — Create a new database
 *
 * Signs up, provisions a database, and writes credentials to .env.
 * Run this ONCE before provisioning schemas.
 *
 * Usage: pnpm run create-db
 */
import { auth, public_ } from '@constructive-io/sdk';
import { config } from './config.js';
import { withRetry } from './helpers.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicit module list — NEVER use ['all'] (it is not a sentinel; it installs
// ZERO modules and silently breaks auth + RLS — see gotchas.md PROVISION-001).
// This is the `email-password` flow's `auth:email` module set: email/password
// auth + app-level RLS, the verified default for a basic auth app.
//
// AUTHORITY: references/flows.json → flows[id="email-password"].backend.modules
//   (the bundled, generated catalog; machine-checked by `node scripts/check-flows.mjs`).
//   This literal is a convenience copy so create-db has no read-a-file dependency; keep it
//   byte-for-byte in sync with that flow. If you change it, regenerate flows.json
//   or check-flows will (correctly) flag the drift.
//
// Scoped entries are NATIVE ['name', { scope }] tuples (as below) — never colon
// strings like 'memberships_module:app' (the proc reads those as a bare name and
// throws NOT_FOUND). See gotchas PROVISION-001.
//
// For a fuller app, provision the richer flow's modules instead (again from
// flows.json): any `social-oauth`/`connected-accounts` flow → `auth:sso`; any
// `org-*` flow → `b2b`; or use `full` for everything.
const MODULES_AUTH_EMAIL = [
  'users_module',
  'membership_types_module',
  ['permissions_module', { scope: 'app' }],
  ['limits_module', { scope: 'app' }],
  ['levels_module', { scope: 'app' }],
  ['memberships_module', { scope: 'app' }],
  'sessions_module',
  'user_state_module',
  'user_credentials_module',
  'config_secrets_module',
  'emails_module',
  'rls_module',
  'user_auth_module',
];

async function main() {
  const ts = Date.now();
  const databaseName = config.databaseName;
  const uniqueEmail = config.adminEmail.replace('@', `+${ts}@`);

  console.log('\n  Create Database\n');
  console.log(`   Database:  ${databaseName}`);
  console.log(`   Admin:     ${uniqueEmail}`);

  // --- Step 1: Sign up ---
  const authClient = auth.createClient({
    endpoint: config.authEndpoint,
  });

  const signUpData = await authClient.mutation
    .signUp(
      { input: { email: uniqueEmail, password: config.adminPassword } },
      { select: { result: { select: { userId: true, accessToken: true } } } },
    )
    .unwrap();

  const userId = (signUpData as Record<string, Record<string, Record<string, string>>>)
    ?.signUp?.result?.userId;
  const accessToken = (signUpData as Record<string, Record<string, Record<string, string>>>)
    ?.signUp?.result?.accessToken;

  if (!accessToken || !userId) {
    console.error('No token/userId returned from signUp');
    process.exit(1);
  }
  console.log(`   Signed up (ID: ${userId})`);

  // --- Step 2: Provision database ---
  // databaseProvisionModule lives ONLY on modules.localhost — it 404s on api.localhost
  // (api is metaschema reads only). Target config.modulesEndpoint. See gotchas
  // PROVISION-001 / F4.
  console.log('\n   Provisioning database...');
  const modulesClient = public_.createClient({
    endpoint: config.modulesEndpoint,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const provData = await withRetry(() =>
    modulesClient.databaseProvisionModule
      .create({
        data: {
          databaseName,
          ownerId: userId,
          subdomain: databaseName,
          domain: 'localhost',
          modules: MODULES_AUTH_EMAIL,
          bootstrapUser: true,
          options: {},
        },
        select: { id: true, databaseId: true, errorMessage: true },
      })
      .unwrap()
  );

  const dbProv = (provData as Record<string, Record<string, Record<string, string | null>>>)
    ?.createDatabaseProvisionModule?.databaseProvisionModule;

  if (!dbProv || !dbProv.databaseId) {
    console.error(`DB Provision failed: ${dbProv?.errorMessage || 'unknown'}`);
    process.exit(1);
  }

  const databaseId = dbProv.databaseId;
  console.log(`   Database ready (ID: ${databaseId})`);

  // --- Step 3: Write .env ---
  const envPath = path.resolve(__dirname, '../../../.env');
  console.log(`\n   Writing credentials to ${envPath}`);

  let envContent = '';
  try { if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8'); } catch { /* ok */ }

  const newVars: Record<string, string> = {
    DATABASE_ID: databaseId,
    DATABASE_NAME: databaseName,
    ACCESS_TOKEN: accessToken,
    // Persist the signup userId as OWNER_ID. The signup user IS the org owner here
    // (users == orgs), so provision/blueprint reads it back instead of querying
    // database.findOne for ownerId (F7).
    OWNER_ID: userId,
    // NOTE: do NOT set PGDATABASE to databaseName. On a shared schemas-in-one-DB hub the
    // app "database" is a set of schemas inside the single physical Postgres DB
    // (`constructive`), NOT a physical DB named after the app.
    // ⚠️ AND do NOT rely on the ambient PGDATABASE for the post-provision SQL either:
    // `eval "$(pgpm env)"` sets PGDATABASE=postgres, but the metaschema AND every per-tenant
    // schema live in the physical db `constructive`. A bare `new Pool()` (which inherits
    // PGDATABASE=postgres) connects to the WRONG db, so membership-approve / auto-verify-email /
    // users self-update all SILENTLY no-op (0 rows). provision.ts therefore connects its Pools
    // with `database: config.pgDatabase` (default 'constructive') — see the topology note in
    // provision.ts main(). Leave PGDATABASE alone here; the SQL steps target the hub db explicitly.
  };

  let content = envContent;
  for (const [key, val] of Object.entries(newVars)) {
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }

  fs.writeFileSync(envPath, content.trim() + '\n');
  console.log('   .env updated');

  console.log('\n  Database created. Run `pnpm run provision` to apply schemas.\n');
}

main().catch((err) => {
  console.error('create-db failed:', err.message ?? err);
  process.exit(1);
});
```

### provision.ts (Multi-Pass Orchestrator)

```typescript
/**
 * provision.ts — Orchestrator for schema provisioning
 *
 * Reads DATABASE_ID, ACCESS_TOKEN, DATABASE_NAME from .env (set by create-db)
 * and runs all schema modules sequentially.
 *
 * Usage: pnpm run provision
 */
import { config } from './config.js';
import { Pool } from 'pg';

async function run(label: string, mod: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
  const m = await import(mod);
  if (typeof m.default === 'function') await m.default();
  else throw new Error(`Module ${mod} does not export a default function`);
}

async function main() {
  console.log('\n  Schema Provisioning\n');
  console.log(`   Database:  ${config.databaseName}`);
  console.log(`   DB ID:     ${config.databaseId}`);

  if (!config.databaseId || !config.accessToken) {
    console.error('\n  Missing DATABASE_ID or ACCESS_TOKEN in .env');
    console.error('   Run: pnpm run create-db\n');
    process.exit(1);
  }

  // =========================================================================
  // SQL access (optional) — skip this whole block if only the GraphQL API is available.
  //
  // SHARED HUB = SCHEMAS-IN-ONE-DB. A provisioned "database" is a set of SCHEMAS inside the
  // single physical Postgres database `constructive`; there is NO physical per-app database.
  // 🚨 CONNECT TO THE HUB DB EXPLICITLY: use `new Pool({ database: config.pgDatabase })` (default
  // 'constructive'), NOT a bare `new Pool()`. A bare Pool inherits the ambient PGDATABASE, and
  // `eval "$(pgpm env)"` sets PGDATABASE=postgres — but the metaschema AND every per-tenant
  // schema live in `constructive`, so a bare Pool connects to the WRONG db and all three SQL
  // steps below (membership-approve, auto-verify-email, users self-update) SILENTLY no-op (0
  // rows). Equally do NOT use `new Pool({ database: config.databaseName })` — the app name is not
  // a physical DB. For the same reason there are NO `ALTER DATABASE "<appname>"` calls here: you
  // cannot ALTER a database that does not exist. deterministic_ids / uuid_seed /
  // simple_schema_names are hub-level concerns — set them once at the hub (or via the platform),
  // or omit them (provisioning + CRUD work without them). The post-provision UPDATEs below match
  // the app's schemas by an ANCHORED tenant-prefix pattern inside the hub db `constructive`.
  // =========================================================================
  const pgAvailable = !!process.env.PGHOST;

  // =========================================================================
  // GraphQL API — these steps work with API access only
  // =========================================================================

  // --- Pass 1: Core domain schemas (tables, fields, relations) ---
  const schemas = [
    ['App Core', './schemas/core.js'],
    // Add more domain modules here as your app grows:
    // ['Chat',     './schemas/chat.js'],
    // ['Projects', './schemas/projects.js'],
  ];

  for (const [label, mod] of schemas) {
    await run(label, mod);
  }

  // --- Pass 2: Search configuration (requires tables from Pass 1) ---
  // Uncomment when you add search:
  // const searchSchemas = [
  //   ['Search Config', './schemas/search.js'],
  // ];
  // for (const [label, mod] of searchSchemas) {
  //   await run(label, mod);
  // }

  // =========================================================================
  // SQL access required — skip these blocks if only GraphQL API is available
  // =========================================================================

  // --- Fix membership defaults + verify email (required for per-DB sign-in) ---
  //
  // F3 has TWO independent halves for working authenticated per-DB CRUD:
  //   1. GRANT — already handled, NO SQL needed. Each table above declares the OBJECT-FORM
  //      grants: [{ roles: ['authenticated'], privileges: [...] }], which constructBlueprint
  //      applies server-side (GRANT … TO authenticated) and pairs with role-scoped RLS. This is
  //      the canonical grant path — never hand-write a `GRANT … TO authenticated`. See gotchas F3.
  //      (VERIFY it landed — see the post-provision grant check in SKILL.md's speedrun: if the live
  //      hub did NOT apply the grant, fall back to the manual GRANT once.)
  //   2. APPROVAL + EMAIL-VERIFY — handled HERE.
  // Verify both: a signed-in authenticated user can insert AND read back a row after reload.
  //
  // 🔑 RESOLVE THE EXACT TENANT SCHEMA PREFIX — do NOT use a floating `LIKE '%<dbName>%'`.
  // Per-DB schema names are DASH-collapsed (db `spd_email_password_a` → prefix
  // `spd-email-passworda-<hash>-…`). A floating `'%spd%email%password%a%'` is doubly wrong:
  //   (1) the OLD bug — a literal `LIKE '%spd_email_password_a%'` matches ZERO rows (underscores
  //       don't survive the collapse, and `_` is itself a SQL wildcard); AND
  //   (2) CROSS-TENANT BLEED — a floating `%…%` whose db name contains a substring of another
  //       schema family (e.g. db `…members…` → pattern `%…members…%`) ALSO matches a SIBLING
  //       tenant's `…memberships-public` (because 'memberships' CONTAINS 'members'). During a
  //       concurrent run this applies your membership defaults to the WRONG tenant.
  // Fix: anchor on THIS tenant's real, dash-collapsed schema prefix — resolved deterministically
  // from `pg_namespace` by the captured <sub>+<hash> — and match `LIKE '<prefix>%'` (anchored at
  // the START, no leading `%`), so a sibling tenant can never match. We derive the prefix once from
  // any of this tenant's own schemas, then reuse it for both the memberships and emails UPDATEs.
  if (pgAvailable) {
    console.log('\n  Enabling app membership defaults + verifying emails...');
    // Connect to the HUB db `constructive` explicitly — NOT a bare Pool (which would inherit
    // PGDATABASE=postgres from `pgpm env` and silently no-op every UPDATE below). See topology note.
    const defaultsPool = new Pool({ database: config.pgDatabase });

    // Resolve the exact tenant prefix `<sub>-<hash>-` from THIS tenant's collapsed schema names.
    // Anchor the db-name portion as a PREFIX (collapse-tolerant: each `_` → `%`, but anchored at the
    // start, not floating), and require the memberships-public suffix to pin a single tenant. Then
    // strip the suffix to recover the shared `<sub>-<hash>-` prefix all of this tenant's schemas share.
    const tenantPrefixLike = config.databaseName.replace(/_/g, '%') + '%'; // anchored: NO leading `%`
    const prefixRes = await defaultsPool.query(
      `SELECT nspname FROM pg_namespace
       WHERE nspname LIKE $1
             AND (nspname LIKE '%memberships-public' OR nspname LIKE '%memberships_public')
       ORDER BY nspname DESC LIMIT 1`,
      [tenantPrefixLike]
    );

    if (prefixRes.rows.length === 0) {
      console.warn(`   ⚠️  Could NOT resolve this tenant's schema prefix (anchored '${tenantPrefixLike}'). ` +
        `Approval + email-verify NOT applied; new signups stay unapproved (gotchas F3 / fix-membership-defaults).`);
    } else {
      const membershipsSchema: string = prefixRes.rows[0].nspname;
      // Recover the shared `<sub>-<hash>-` prefix by trimming the memberships suffix from the matched name.
      const tenantPrefix = membershipsSchema.replace(/(-|_)memberships(-|_)public$/, '');

      // (a) Membership approval — exact schema we just matched (no further LIKE needed).
      await defaultsPool.query(
        `UPDATE "${membershipsSchema}".app_membership_defaults
         SET is_approved = TRUE, is_verified = TRUE`
      );
      console.log(`   membership defaults updated: ${membershipsSchema}`);

      // (b) Auto-verify email — emails.is_verified defaults to false, which blocks sign-in. Match the
      //     user-identifiers schema ANCHORED on this tenant's recovered prefix (never a floating `%…%`).
      const emailRes = await defaultsPool.query(
        `SELECT nspname AS schema_name FROM pg_namespace
         WHERE nspname LIKE $1
               AND (nspname LIKE '%user-identifiers-public' OR nspname LIKE '%user_identifiers_public')
         ORDER BY nspname DESC LIMIT 1`,
        [tenantPrefix + '%']
      );
      if (emailRes.rows.length > 0) {
        const emailsSchema: string = emailRes.rows[0].schema_name;
        await defaultsPool.query(`ALTER TABLE "${emailsSchema}".emails ALTER COLUMN is_verified SET DEFAULT true`);
        await defaultsPool.query(`UPDATE "${emailsSchema}".emails SET is_verified = true WHERE is_verified = false`);
        console.log(`   emails verified: ${emailsSchema}`);
      } else {
        console.warn(`   ⚠️  NO emails schema matched prefix '${tenantPrefix}' — auto-verify-email NOT applied (gotchas auto-verify-email).`);
      }
    }

    await defaultsPool.end();
  }

  // --- users-table self-UPDATE policy (REQUIRED for updateUser / profile / account-settings) ---
  //
  // The per-tenant `users` table is MODULE-owned (provisioned by the auth modules, not by your
  // blueprint), so you can't declare its policy in schemas/core.ts. The platform emits the
  // `users` SELECT policy `auth_sel_self_update` AND, natively for an auth preset, the matching
  // UPDATE policy `auth_upd_self_update` (verb + policy-name, no hash suffix). Historically the
  // dynamic provisioner emitted only the SELECT policy and NO UPDATE policy, so every `updateUser`
  // returned 200 but changed 0 rows — a SILENT no-op (gotchas RLS-USERS-UPDATE-001). On a platform
  // predating that fix, the control-plane step below re-adds the UPDATE policy.
  //
  // Fix = a CONTROL-PLANE step: AFTER create-db + constructBlueprint, add the self-update policy
  // via `createSecureTableProvision` on the MODULES endpoint, with the SAME sudo/admin token used
  // for provisioning. It emits `auth_upd_self_update`
  // (FOR UPDATE TO authenticated USING id = jwt_public.current_user_id()) and updateUser then
  // persists end-to-end. Skip this only if your app never writes the users table.
  //
  // NOTE (platform gap, flagged upstream): the per-tenant provisioner SHOULD emit this UPDATE
  // policy itself (the static seed schema has auth_upd/auth_upd_admin_updates; the dynamic path
  // omits them). Until the platform fixes it, this control-plane step is the app-side reconciliation.
  //
  // Needs SQL (to resolve the schema/table ids from the metaschema) AND the modules GraphQL
  // endpoint. If you only have GraphQL access, resolve schemaId/tableId via the metaschema READ
  // API (api.localhost) instead of the Pool below — the createSecureTableProvision call is identical.
  if (pgAvailable) {
    console.log('\n  Applying users-table self-update policy (updateUser persistence)...');
    // Same hub db (`constructive`) — the metaschema lives there, not in PGDATABASE=postgres.
    const idPool = new Pool({ database: config.pgDatabase });
    try {
      // users_public schema id for THIS tenant database.
      const schemaRes = await idPool.query(
        `SELECT id FROM metaschema_public.schema
         WHERE database_id = $1 AND name = 'users_public' LIMIT 1`,
        [config.databaseId]
      );
      const schemaId = schemaRes.rows[0]?.id;
      // users table id within that schema.
      const tableRes = schemaId
        ? await idPool.query(
            `SELECT id FROM metaschema_public.table
             WHERE schema_id = $1 AND name = 'users' LIMIT 1`,
            [schemaId]
          )
        : { rows: [] as Array<{ id: string }> };
      const tableId = tableRes.rows[0]?.id;

      if (!schemaId || !tableId) {
        console.warn('   ⚠️  Could not resolve users_public.schema/users.table id — self-update ' +
          'policy NOT applied. updateUser will silently no-op (gotchas RLS-USERS-UPDATE-001).');
      } else {
        // Same modules endpoint + sudo token as create-db's provisioning client.
        const { public_ } = await import('@constructive-io/sdk');
        const modulesClient = public_.createClient({
          endpoint: config.modulesEndpoint,
          headers: { Authorization: `Bearer ${config.accessToken}` },
        });
        await modulesClient.secureTableProvision.create({
          data: {
            databaseId: config.databaseId,
            schemaId,
            tableId,
            tableName: 'users',
            useRls: true,
            // Self-update: a user may UPDATE their own users row (id = current_user_id()).
            policies: [{
              $type: 'AuthzDirectOwner',
              permissive: true,
              privileges: ['update'],
              policy_name: 'self_update',
              data: { entity_field: 'id' },
            }] as unknown as Record<string, unknown>,
          },
          select: { id: true },
        }).unwrap();
        console.log('   users self-update policy applied (auth_upd_self_update)');
      }
    } catch (err) {
      console.warn(`   ⚠️  users self-update policy step failed: ${(err as Error).message?.slice(0, 160)}. ` +
        `updateUser may silently no-op (gotchas RLS-USERS-UPDATE-001).`);
    } finally {
      await idPool.end();
    }
  }

  // (No `ALTER DATABASE … RESET` step: on a shared schemas-in-one-DB hub there is no per-app
  // database to set or reset. See the topology note at the top of main().)

  console.log('\n  All schemas provisioned successfully!\n');
}

main().catch((err) => {
  console.error('Provision failed:', err.message ?? err);
  process.exit(1);
});
```

#### Org-flow extension (the org counterpart to the users self-update step)

> **If the flow provisions org/b2b modules (`organization` / `org-members` / `org-roles` /
> `org-invites` / `app-memberships`), the reconciled recipe above is NOT enough.** The users
> self-update control-plane step (RLS-USERS-UPDATE-001) + the `app_public` blueprint grants cover the
> basic `auth:email` flows, but the **org-\*** flows write **module-owned** org tables and gate org
> creation on an **app-permission bit** that the basic recipe never sets. After provisioning a b2b
> flow, ALSO apply the following — this is the org analogue of the users self-update reconciliation:
>
> 1. **Grant the `create_entity` app-permission bit to the test actor (else org create is RLS-denied).**
>    Org creation requires the actor to hold the **`create_entity`** permission bit — **bit 5 = `0x20`
>    = decimal `32`** — OR be created as `createUser(type=2)`. Without it, `OrgCreateCard` /
>    `createUser(type=2)` fails RLS even though auth works. Grant that bit to the actor's app membership
>    after provisioning. ⚠️ **Verify the exact permission-grant mutation/field and the bit value against
>    the `constructive-security` skill** before wiring it — do not hand-roll a permissions UPDATE from
>    memory; the bit is `0x20` but the mutation surface is platform-owned.
> 2. **INSERT (and UPDATE) grant to `authenticated` on the module-owned tenant `users` table.** Org flows
>    create org rows in the unified user model (`users` with `type=2`), so `authenticated` needs INSERT
>    (and UPDATE) on the per-tenant `users` table — the dynamic provisioner does not emit it (same class
>    as the missing self-update policy). Add it via the SAME `createSecureTableProvision` control-plane
>    path used for the self-update policy above (resolve `users_public` schema/table id by
>    `config.databaseId`), carrying an INSERT/UPDATE grant to `authenticated`.
> 3. **Reconcile the module-owned org tables the org blocks write:** `org_memberships` needs INSERT +
>    UPDATE, and `org_member_profiles` needs SELECT, for `authenticated`/org members. Add the
>    grants/policies for these via `createSecureTableProvision` (resolve each table's schema/table id the
>    same way) so members-list / role-change / invite-accept round-trip.
>
> The `organization` / `org-members` / `org-roles` flows PASSED the fan-out only because the agents
> discovered (1)–(3) **app-side**; bake them into the provision step for b2b flows so the next agent
> doesn't re-derive them. **Where the precise mutation/SQL is not certain (esp. the `create_entity`
> grant and the org-table policy shapes), document the REQUIREMENT + the bit value here and verify the
> exact call against the `constructive-security` skill — do NOT invent a snippet that might be wrong.**
> Frame this as the org counterpart to RLS-USERS-UPDATE-001 (see gotchas.md).
>
> **NOW PLATFORM-NATIVE (no reconcile step):** the platform provisions (a) the `create_entity` bit
> (bit 5 = `0x20`), (b) the `org_memberships` INSERT/UPDATE + `org_member_profiles` SELECT grants, and
> (c) the personal-org row in `<db>-memberships-private.org_memberships_sprt` (actor_id = entity_id =
> user_id) — the row the `AuthzEntityMembership` RLS actually reads — automatically on signup
> (platform-gaps.md GAP-1b/1c, CLOSED 2026-06-15). A fresh signup's `createCompany(entityId = their user
> id)` therefore persists immediately; there is no provision-time appendix or standalone reconcile script
> anymore. The recipe above is retained only as the historical control-plane form for a deployment that
> predates the platform fix. Note (c) was the **direct cause** of the old create-rejection (the
> AFTER-INSERT trigger on `org_memberships` only populates the sprt when an `app_memberships_sprt` parent
> exists, which a bare signup lacked — the platform now seeds it).

### Schema Module Example: schemas/core.ts

```typescript
/**
 * schemas/core.ts — Core domain tables
 *
 * Each schema module exports a default async function that calls
 * provisionBlueprint() with a typed BlueprintDefinition.
 *
 * ⚠️ DEFAULT POLICY = OWNER-SCOPED `AuthzDirectOwner` (NOT `AuthzEntityMembership`). A basic
 *    org-less app (the `auth:email` preset) has NO org/b2b/memberships modules, so an
 *    `AuthzEntityMembership` policy with `membership_type: 2` does NOT silently 0-row — it
 *    FAILS HARD at constructBlueprint time with `status: failed,
 *    errorDetails: "NOT_FOUND (memberships_module)"` (the org-scoped SPRT does not exist on
 *    `auth:email`) and the table is NEVER created. Only use `AuthzEntityMembership` +
 *    `membership_type: 2` when you provisioned the org entity modules (the `b2b` preset).
 *    See gotchas RLS-POLICY-001.
 *
 *    Pick per table:
 *      • Each user owns their rows  → `DataDirectOwner` + `AuthzDirectOwner` (below; default).
 *      • All authenticated share one pool (no ownership) → `DataId`/`DataTimestamps` +
 *        `AuthzAllowAll` (see the SHARED-DATA variant comment at the bottom).
 *      • Org/b2b tenancy → `DataEntityMembership` + `AuthzEntityMembership` (requires the `b2b`
 *        module preset; provision those modules first).
 *
 * 🔑 CLIENT CONTRACT for `AuthzDirectOwner`: `DataDirectOwner` exposes `ownerId` on the GraphQL
 *    create input, and the policy compiles to `owner_id = jwt_public.current_user_id()` — USING
 *    for select/update/delete and WITH CHECK for insert. The client MUST set `ownerId` to the
 *    authenticated user's id on create; WITH CHECK rejects any other value (anti-spoof). To force
 *    it server-side so the client need not pass it, add the node
 *    `{ $type: 'DataForceCurrentUser', data: { field_name: 'owner_id' } }`.
 *
 * 🔑 FK PREREQ: `owner_id` FKs to the per-TENANT users table, so the authed user must exist
 *    in-tenant — provision them through the tenant auth endpoint (`auth-<sub>.localhost` signUp),
 *    NOT base `auth.localhost`. A base user is absent in-tenant and FK-violates on insert.
 */
import type { BlueprintDefinition } from 'node-type-registry';
import { provisionBlueprint } from '../blueprint.js';

const definition: BlueprintDefinition = {
  tables: [
    // -- Boards ---------------------------------------------------------------
    {
      ref: 'boards',
      table_name: 'boards',
      // DataId gives the `id` PK the API needs for update/delete; DataDirectOwner adds
      // `owner_id uuid NOT NULL` + FK to the tenant users table + index (NO `id` of its own —
      // F18). Prepend DataId for full CRUD.
      nodes: [
        'DataId',
        'DataDirectOwner',
        { $type: 'DataTimestamps', data: { include_id: false } },
      ],
      fields: [
        // FieldType + FieldDefault are OBJECTS, never bare strings (F5):
        //   type:    { name: 'text' } | { name: 'boolean' } | { name: 'int4' } | …
        //   default: { value: 0 } | { value: false } | { value: 'todo' }
        { name: 'name', type: { name: 'text' }, is_required: true },
        { name: 'description', type: { name: 'text' } },
        { name: 'is_archived', type: { name: 'boolean' }, default: { value: false } },
      ],
      // OBJECT-FORM grants ([{ roles, privileges }]) — probe-proven that constructBlueprint
      // applies these as GRANT … TO authenticated server-side. Do NOT use the stale
      // `grant_roles: [...]` + bare `grants: [['select','*'],…]` shape: it lands NO grant and
      // every authenticated write 403s (gotchas F3). The blueprint.ts mapper forwards only this.
      grants: [{ roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] }],
      use_rls: true,
      // Owner-scoped: proven 1/1/1/1 CRUD e2e. Config key is `entity_field` (value = the owner
      // column), NEVER `owner_field` (that belongs to AuthzMemberOwner et al.).
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: ['select', 'insert', 'update', 'delete'],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    },

    // -- Lists ----------------------------------------------------------------
    {
      ref: 'lists',
      table_name: 'lists',
      nodes: [
        'DataId',
        'DataDirectOwner',
        { $type: 'DataTimestamps', data: { include_id: false } },
      ],
      fields: [
        { name: 'name', type: { name: 'text' }, is_required: true },
        { name: 'position', type: { name: 'int4' }, is_required: true, default: { value: 0 } },
      ],
      // OBJECT-FORM grants ([{ roles, privileges }]) — probe-proven that constructBlueprint
      // applies these as GRANT … TO authenticated server-side. Do NOT use the stale
      // `grant_roles: [...]` + bare `grants: [['select','*'],…]` shape: it lands NO grant and
      // every authenticated write 403s (gotchas F3). The blueprint.ts mapper forwards only this.
      grants: [{ roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] }],
      use_rls: true,
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: ['select', 'insert', 'update', 'delete'],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    },

    // -- Cards ----------------------------------------------------------------
    {
      ref: 'cards',
      table_name: 'cards',
      nodes: [
        'DataId',
        'DataDirectOwner',
        { $type: 'DataTimestamps', data: { include_id: false } },
      ],
      fields: [
        { name: 'title', type: { name: 'text' }, is_required: true },
        { name: 'description', type: { name: 'text' } },
        { name: 'position', type: { name: 'int4' }, is_required: true, default: { value: 0 } },
      ],
      // OBJECT-FORM grants ([{ roles, privileges }]) — probe-proven that constructBlueprint
      // applies these as GRANT … TO authenticated server-side. Do NOT use the stale
      // `grant_roles: [...]` + bare `grants: [['select','*'],…]` shape: it lands NO grant and
      // every authenticated write 403s (gotchas F3). The blueprint.ts mapper forwards only this.
      grants: [{ roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] }],
      use_rls: true,
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: ['select', 'insert', 'update', 'delete'],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    },

    // -- SHARED-DATA VARIANT (app-wide pool — every authenticated user reads/writes, no
    //    ownership). Swap the three tables above for this shape when the brief has no per-user
    //    ownership. nodes drop DataDirectOwner; policy is AuthzAllowAll (no entity_field):
    //
    // {
    //   ref: 'announcements',
    //   table_name: 'announcements',
    //   nodes: ['DataId', { $type: 'DataTimestamps', data: { include_id: false } }],
    //   fields: [{ name: 'body', type: { name: 'text' }, is_required: true }],
    //   grants: [{ roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] }],
    //   use_rls: true,
    //   policies: [{ $type: 'AuthzAllowAll', privileges: ['select', 'insert', 'update', 'delete'], permissive: true }],
    // },
  ],

  relations: [
    // lists -> boards (CASCADE delete)
    { $type: 'RelationBelongsTo', source_table: 'lists', target_table: 'boards', delete_action: 'c', is_required: true },
    // cards -> lists (CASCADE delete)
    { $type: 'RelationBelongsTo', source_table: 'cards', target_table: 'lists', delete_action: 'c', is_required: true },
  ],
};

export default async function main() {
  await provisionBlueprint(definition, 'App Core');
}
```

### Schema Module Example: schemas/search.ts (Optional, Pass 2)

```typescript
/**
 * schemas/search.ts — Search configuration (runs AFTER core tables exist)
 *
 * Uses SearchUnified to add tsvector, BM25, trigram, and embedding
 * search to existing tables. Must run in Pass 2 since it references
 * tables created in Pass 1.
 */
import type { BlueprintDefinition } from 'node-type-registry';
import { provisionBlueprint } from '../blueprint.js';

const definition: BlueprintDefinition = {
  tables: [
    {
      ref: 'boards',
      table_name: 'boards',
      nodes: [
        {
          $type: 'SearchUnified',
          data: {
            source_fields: ['name', 'description'],
            full_text_search: {
              field_name: 'search_tsv',
              source_fields: [
                { field: 'name', weight: 'A' },
                { field: 'description', weight: 'B' },
              ],
            },
            trgm_fields: ['name'],
          },
        },
      ],
      fields: [],
      // OBJECT-FORM grants ([{ roles, privileges }]) — probe-proven that constructBlueprint
      // applies these as GRANT … TO authenticated server-side. Do NOT use the stale
      // `grant_roles: [...]` + bare `grants: [['select','*'],…]` shape: it lands NO grant and
      // every authenticated write 403s (gotchas F3). The blueprint.ts mapper forwards only this.
      grants: [{ roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] }],
      use_rls: true,
      // Re-state the SAME policy the table was created with in core.ts (owner-scoped here).
      // Do NOT use AuthzEntityMembership + membership_type: 2 on an org-less app — it aborts
      // constructBlueprint with NOT_FOUND (memberships_module). See gotchas RLS-POLICY-001.
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: ['select', 'insert', 'update', 'delete'],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    },
  ],
  relations: [],
};

export default async function main() {
  await provisionBlueprint(definition, 'Search Config');
}
```

### Common Node Types

The full node-type catalog is in [`constructive-blueprints` → references/node-type-registry.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-blueprints) (source of truth) — consult it rather than relying on this excerpt. The few rows below are the ones used most in a basic app, plus the build-flow-specific DataId prereq.

| Node Type | Purpose | Added Fields |
|-----------|---------|--------------|
| `DataEntityMembership` | Entity-level membership + id (pairs with `AuthzEntityMembership`) | `id`, `entity_id` |
| `DataOwnershipInEntity` | Entity ownership + owner tracking | `id`, `entity_id`, `owner_id` |
| `DataDirectOwner` | Direct per-user ownership (pairs with `AuthzDirectOwner`) | `owner_id` **only — no `id`/PK** |
| `DataTimestamps` | Timestamps (use `include_id: false` when composing) | `created_at`, `updated_at` |
| `DataId` | Just adds `id` (UUID primary key) | `id` |
| `SearchUnified` | Multi-strategy search (tsvector, BM25, trgm, pgvector) | Depends on config |
| `DataSoftDelete` | Soft delete | `deleted_at` |
| `DataTags` | Tag array | `tags citext[]` + GIN index |
| `DataEmbedding` | Vector embedding | embedding + HNSW index |

> **DataId prereq for full CRUD (build-flow-specific, F18):** a row needs an `id` primary key for the API
> to expose update/delete. `DataEntityMembership` / `DataOwnershipInEntity` carry `id` already, but
> `DataDirectOwner` adds **only `owner_id`** (no PK) — so for an owner-scoped table that needs full CRUD,
> **prepend `DataId`**: `nodes: ['DataId', 'DataDirectOwner', …]`. Without it the API exposes only
> create + list.

### Common Policy Types

See [`constructive-security` → references/authz-types.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-security) for all 18 Authz* types and their config keys. Most-used in a basic app:

| Policy Type | Purpose | Config key |
|-------------|---------|------------|
| `AuthzDirectOwner` | Users can only access rows they own — **the default for a basic (org-less) app** | `entity_field` (`'owner_id'`) |
| `AuthzAllowAll` | All authenticated users share one pool (no ownership) | — |
| `AuthzEntityMembership` | Org/b2b tenancy — **requires the `b2b` org modules; aborts constructBlueprint on `auth:email`** | `entity_field` (`'entity_id'`), `membership_type` |
| `AuthzAppMembership` | App-level membership gate (hardcoded `membership_type=1`) — silently denies all CRUD until the actor's app_membership is approved+active | optional `permission`/`is_admin` |

> 🚨 **Do NOT default to `AuthzEntityMembership` + `membership_type: 2` on a basic app.** With no
> org/b2b/memberships modules provisioned, `constructBlueprint` FAILS HARD with
> `NOT_FOUND (memberships_module)` and the table is never created — not a silent 0-row. Use
> `AuthzDirectOwner` (owner-scoped) or `AuthzAllowAll` (shared); reserve `AuthzEntityMembership` for the
> `b2b` preset. See gotchas RLS-POLICY-001.

> **`AuthzDirectOwner` config key is `entity_field`, not `owner_field`** (its value is the owner column,
> `'owner_id'`). `owner_field` belongs to `AuthzMemberOwner` / `AuthzPeerOwnership` /
> `AuthzRelatedPeerOwnership` / `AuthzOrgHierarchy` — see `constructive-security` authz-types.md. Using
> `owner_field` with `AuthzDirectOwner` triggers `MISSING_REQUIRED_FIELD`.

### Common Relation Types

| Relation Type | Key Fields | Purpose |
|---------------|------------|---------|
| `RelationBelongsTo` | `source_table`, `target_table`, `delete_action`, `is_required` | Many-to-one (FK in source table) |
| `RelationHasMany` | `source_table`, `target_table`, `delete_action` | One-to-many (FK in target) |
| `RelationHasOne` | `source_table`, `target_table`, `delete_action` | One-to-one (FK + unique) |
| `RelationManyToMany` | `source_table`, `target_table` + junction config | Many-to-many (junction table) |

Relations reference tables by name using `source_table` / `target_table`.

> **`deleteAction` and `isRequired` pairing:**
>
> | `delete_action` | `is_required` | Notes |
> |----------------|--------------|-------|
> | `'n'` (SET NULL) | **Must be** `false` | Otherwise FK field is NOT NULL, SET NULL fails |
> | `'c'` (CASCADE) | `true` or `false` | Based on business requirements |
> | `'r'` (RESTRICT) | Usually `true` | Must remove association before delete |

### .env.example (put in workspace root)

```bash
# Set by create-db (do not edit manually)
DATABASE_ID=
DATABASE_NAME=myapp
ACCESS_TOKEN=
OWNER_ID=          # signup userId — used as the blueprint owner (users == orgs); F7

# Postgres (set via: eval "$(pgpm env)")
PGUSER=
PGHOST=
PGPASSWORD=
PGDATABASE=        # `pgpm env` sets this to `postgres` — but tenant/metaschema SQL must hit the hub db
                   # `constructive` (app schemas live inside it). provision.ts uses config.pgDatabase
                   # (default 'constructive') for its Pools; PGDATABASE=postgres is the WRONG db for them.
PGPORT=
# PG_HUB_DATABASE=constructive   # override only if your physical hub db is named differently

# Override API endpoints (optional)
# API_ENDPOINT=http://api.localhost:3000/graphql       # metaschema READS only
# MODULES_ENDPOINT=http://modules.localhost:3000/graphql # provisioning + blueprint WRITES (F4)
# AUTH_ENDPOINT=http://auth.localhost:3000/graphql

# Admin credentials
ADMIN_EMAIL=admin@myapp.local
ADMIN_PASSWORD=Password123!
```

---

## Phase 2.3: Provision Script Template (Imperative via secureTableProvision — Fallback)

> **Use this approach ONLY when blueprints don't work for your use case** (e.g., fine-grained control over individual tables). The blueprint approach above is strongly preferred.

The `secureTableProvision` approach creates a table with RLS, grants, and policies in a single call. The input is the **Blueprint shape** — four independent, optional arrays (`nodes[]` / `fields[]` / `grants[]` / `policies[]`) plus `useRls`, mirroring the blueprint table definition. **The flat `nodeType` / `grantRoles` / `grantPrivileges` / `policyType` / `policyPermissive` / `policyData` / `nodeData` shape is stale** and no longer matches the live platform — the generated `CreateSecureTableProvisionInput` exposes only `nodes` / `fields` / `grants` / `policies` / `useRls`. Do not duplicate the API here — the canonical reference (input shape, casting rules, paired Data/Authz nodes) is [`constructive-security` → SKILL.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-security) (`secureTableProvision (Recommended)`) and [`constructive-data-modeling` → SKILL.md](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-data-modeling) (`Tables`).

> **Build-flow-specific (not in the skill):** the write endpoint is `modules.localhost:3000/graphql`. `secureTableProvision` / `field` / `relationProvision` live ONLY on `modules.localhost` — they 404 on `api.localhost` (api is metaschema **reads only**). See gotchas PROVISION-001 / F4.

```typescript
import { public_ } from '@constructive-io/sdk';

// Create SDK client (reuse createModulesClient from helpers.ts in the blueprint approach).
const sdk = public_.createClient({
  endpoint: 'http://modules.localhost:3000/graphql',
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

// Create a table with RLS + grants + policy in one call (Blueprint shape — see constructive-security).
// nodes/grants/policies are typed as a single Record<string, unknown>, so each array literal needs
// `as unknown as Record<string, unknown>`. fields[] is already an array type — no cast.
const result = await sdk.secureTableProvision.create({
  data: {
    databaseId,
    tableName: 'boards',
    useRls: true,
    // nodes[]: one entry per Data* field module. DataId adds the `id` PK; DataDirectOwner adds
    // `owner_id` + FK to the tenant users table (owner-scoped default — see RLS-POLICY-001).
    nodes: [
      { $type: 'DataId' },
      { $type: 'DataDirectOwner' },
      { $type: 'DataTimestamps', data: { include_id: false } },
    ] as unknown as Record<string, unknown>,
    // grants[]: each entry = roles + a list of [privilege, columns] tuples ('*' = all columns).
    grants: [
      { roles: ['authenticated'], privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']] },
    ] as unknown as Record<string, unknown>,
    // policies[]: one entry per Authz* policy, discriminated by $type. Owner-scoped default.
    // Do NOT default to AuthzEntityMembership + membership_type: 2: on an org-less app it
    // aborts with NOT_FOUND (memberships_module) and the table is never created. Use that only
    // when the `b2b` org modules are provisioned. See gotchas RLS-POLICY-001.
    policies: [
      {
        $type: 'AuthzDirectOwner',
        permissive: true,
        privileges: ['select', 'insert', 'update', 'delete'],
        data: { entity_field: 'owner_id' },
      },
    ] as unknown as Record<string, unknown>,
    // fields[]: explicit columns (snake_case). type accepts a FieldType object or a legacy bare string.
    fields: [
      { name: 'name', type: { name: 'text' }, is_required: true },
    ],
  },
  select: { id: true, tableId: true, outFields: true },
}).unwrap();

const tableId = result?.createSecureTableProvision?.secureTableProvision?.tableId;

// Add relations
await sdk.relationProvision.create({
  data: {
    databaseId,
    relationType: 'RelationBelongsTo',
    sourceTableId: listsTableId,
    targetTableId: boardsTableId,
    deleteAction: 'c',  // CASCADE
  },
  select: { id: true },
}).unwrap();
```

### Common Field Types

> 🚨 **Blueprint field shapes are OBJECTS, not bare strings (F5 — see VERIFICATION-FINDINGS.md).**
> In a `BlueprintField` (the `fields:[]` of a `createBlueprint`/`constructBlueprint` definition),
> `type` is a **FieldType object** `{ name: '<type>' }` and any default is a **FieldDefault object**
> `{ value: <literal> }`. Bare strings like `type: 'text'`, `type: 'bool'`, or `default_value: 'false'`
> are **rejected**. Also note the boolean type name is **`boolean`**, not `bool`.
>
> ```typescript
> // ✅ correct (blueprint field)
> { name: 'title',     type: { name: 'text' },    is_required: true }
> { name: 'done',      type: { name: 'boolean' }, default: { value: false } }
> { name: 'priority',  type: { name: 'int4' },    default: { value: 0 } }
> // ❌ wrong — bare strings / wrong type name / wrong default key
> { name: 'title', type: 'text' }
> { name: 'done',  type: 'bool', default_value: 'false' }
> ```
>
> (The imperative `sdk.field.create({ data: { type, isRequired } })` fallback below is a *different*
> API surface — the flat SDK mutation — and is not the blueprint shape. Prefer blueprints.)

The `name` for the FieldType object (`type: { name: '<below>' }`):

| `type.name` | Description | Example default (`default: { value: … }`) |
|-------------|-------------|--------------------------------------------|
| `text` | Text | `{ value: 'todo' }` |
| `int4` | Integer | `{ value: 0 }` |
| `boolean` | Boolean (NOT `bool`) | `{ value: false }` |
| `uuid` | UUID | — |
| `timestamptz` | Timestamp | — |
| `jsonb` | JSON | `{ value: {} }` |

### Common Relation Types

| Type | Description | deleteAction |
|------|-------------|--------------|
| `RelationBelongsTo` | Many-to-one (FK in source) | `'c'` CASCADE / `'r'` RESTRICT / `'n'` SET NULL |
| `RelationHasMany` | One-to-many (FK in target) | Same as above |
| `RelationHasOne` | One-to-one (FK + unique) | Same as above |
| `RelationManyToMany` | Many-to-many (junction table) | Not required |

> ⚠️ **Must Read: `deleteAction` and `isRequired` Pairing Rules**
>
> | `deleteAction` | `isRequired` | Description |
> |----------------|--------------|-------------|
> | `'n'` (SET NULL) | **Must be** `false` | Otherwise SDK generates required field, passing null throws `Invalid UUID` |
> | `'c'` (CASCADE) | `true` or `false` | Based on business requirements |
> | `'r'` (RESTRICT) | Usually `true` | Must remove association before delete |
>
> **Wrong Example:**
> ```typescript
> // ❌ Missing isRequired: false
> await publicDb.relationProvision.create({
>   data: { deleteAction: 'n' },  // SET NULL but field is NOT NULL!
>   ...
> })
> ```
>
> **Correct Example:**
> ```typescript
> // ✅ SET NULL must be paired with isRequired: false
> await publicDb.relationProvision.create({
>   data: {
>     deleteAction: 'n',
>     isRequired: false,  // <- Must add!
>   },
>   ...
> })
> ```

---

## Phase 3: constructive-frontend (CRUD Stack) Supplement

The original skill provides Edit card and Delete confirm templates, but lacks Create card and List page templates.

### Create Card Template

```tsx
'use client';

import { useState } from 'react';
import type { CardComponent } from '@/components/ui/stack';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateBoardMutation } from '@sdk/app';  // <- Change to your entity

export type CreateBoardCardProps = {
  entityId: string;      // User's personal org ID (usually user.id)
  onSuccess?: () => void;
};

export const CreateBoardCard: CardComponent<CreateBoardCardProps> = ({
  entityId,
  onSuccess,
  card,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useCreateBoardMutation({
    selection: { fields: { id: true } },
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    await createMutation.mutateAsync({
      entityId,
      name: name.trim(),
      description: description.trim() || undefined,
    });
    onSuccess?.();
    card.close();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Form Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter name"
            autoFocus
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
          />
        </Field>
      </div>

      {/* Sticky Footer */}
      <div className="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" onClick={() => card.close()}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!name.trim() || createMutation.isPending}>
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </div>
  );
};
```

### Edit Card Template (SDK Integration Version)

The original skill example uses `await updateContact({ id, name })`, but actual SDK usage is different:

```tsx
'use client';

import { useState, useEffect } from 'react';
import type { CardComponent } from '@/components/ui/stack';
import { useCardReady } from '@/components/ui/stack';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useBoardQuery, useUpdateBoardMutation, useDeleteBoardMutation } from '@sdk/app';

export type EditBoardCardProps = {
  boardId: string;
  onSuccess?: () => void;
  onDelete?: () => void;
};

export const EditBoardCard: CardComponent<EditBoardCardProps> = ({
  boardId,
  onSuccess,
  onDelete,
  card,
}) => {
  const { isReady } = useCardReady();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Fetch existing data
  // Note: Don't use options: { enabled }, use enabled directly
  const { data, isLoading } = useBoardQuery({
    id: boardId,
    selection: { fields: { id: true, name: true, description: true } },
    enabled: isReady,
  });

  // Populate form when data loads
  useEffect(() => {
    if (data?.board) {
      setName(data.board.name ?? '');
      setDescription(data.board.description ?? '');
    }
  }, [data]);

  const updateMutation = useUpdateBoardMutation({
    selection: { fields: { id: true } },
  });

  const deleteMutation = useDeleteBoardMutation({
    selection: { fields: { id: true } },
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    await updateMutation.mutateAsync({
      id: boardId,
      boardPatch: {  // <- Note: patch name is entityPatch (e.g., boardPatch, listPatch, cardPatch)
        name: name.trim(),
        description: description.trim() || null,
      },
    });
    onSuccess?.();
    card.close();
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync({ id: boardId });
    onDelete?.();
    card.close();
  };

  if (!isReady || isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Form Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </Field>
      </div>

      {/* Sticky Footer with Delete */}
      <div className="flex items-center justify-between border-t px-4 py-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">Delete</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Board?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => card.close()}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};
```

### List Page Template

Complete list page, including query + create/edit triggers:

```tsx
'use client';

import { Plus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCardStack } from '@/components/ui/stack';
import { useBoardsQuery } from '@sdk/app';
import { useAuth } from '@/store/app-store';  // <- Correct import
import { CreateBoardCard } from './components/create-board-card';
import { EditBoardCard } from './components/edit-board-card';

export default function BoardsPage() {
  const stack = useCardStack();
  const auth = useAuth();
  const entityId = auth.user?.id ?? '';

  // Note selection structure: fields + where + orderBy at the same level
  const { data, isLoading, refetch } = useBoardsQuery({
    selection: {
      fields: { id: true, name: true, description: true, createdAt: true },
      where: entityId ? { entityId: { equalTo: entityId } } : undefined,
      orderBy: ['ID_ASC'],  // <- Only use indexed fields!
    },
    enabled: !!entityId,  // <- Use enabled directly, don't use options: { enabled }
  });

  const boards = data?.boards?.nodes ?? [];

  const handleCreate = () => {
    stack.push({
      id: 'create-board',
      title: 'Create Board',
      Component: CreateBoardCard,
      props: { entityId, onSuccess: () => refetch() },
      width: 480,
    });
  };

  const handleEdit = (boardId: string) => {
    stack.push({
      id: `edit-board-${boardId}`,
      title: 'Edit Board',
      Component: EditBoardCard,
      props: {
        boardId,
        onSuccess: () => refetch(),
        onDelete: () => refetch(),
      },
      width: 480,
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Boards</h1>
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Board
          </Button>
        </div>

        {/* Empty State */}
        {boards.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground mb-4">No boards yet</p>
            <Button onClick={handleCreate}>Create your first board</Button>
          </div>
        ) : (
          /* List */
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <div
                key={board.id}
                className="group relative rounded-lg border p-4 hover:border-primary/50 cursor-pointer"
                onClick={() => handleEdit(board.id)}
              >
                <h3 className="font-medium">{board.name}</h3>
                {board.description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {board.description}
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(board.id);
                  }}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```

---

## Relation Fields UI (Principles)

> **Must check relation definitions in provision script before starting Phase 3.**

### Inspection Steps

1. **Read provision script** -> Find all `relationProvision.create()` calls
2. **List relations** -> e.g., `notes -> folders`, `cards -> lists`
3. **Think about UI** -> What interaction does each relation need?

### Relation Types -> UI Approach

| Relation Type | Considerations |
|---------------|----------------|
| `RelationBelongsTo` (many-to-one) | Create/Edit needs parent entity selection (dropdown?) |
| `RelationHasMany` (one-to-many) | Show child list on parent detail page? |
| `RelationManyToMany` | Multi-select? Tags? |

### Don'ts

- ❌ Copy template code directly
- ❌ Ignore relation definitions in provision
- ❌ Only do basic fields, miss relation fields

### Dos

- ✅ Analyze table structure and relations in provision script first
- ✅ Design UI interactions for each relation
- ✅ Include relation fields in queries (e.g., `folderId`)
- ✅ Consider whether to show related info on list pages

---

## constructive-data-modeling Supplement

### orderBy Only Supports Indexed Fields

The generated `XxxOrderBy` enum **only includes indexed fields**. Defaults are:

```typescript
'NATURAL' | 'PRIMARY_KEY_ASC' | 'PRIMARY_KEY_DESC' | 'ID_ASC' | 'ID_DESC'
```

**Wrong Examples:**
```typescript
// ❌ POSITION_ASC doesn't exist (unless position field is indexed)
orderBy: ['POSITION_ASC', 'ID_ASC']

// ❌ CREATED_AT_DESC doesn't exist (unless created_at is indexed)
orderBy: ['CREATED_AT_DESC']
```

**Correct Approach:**
```typescript
// ✅ ID_ASC is always available, and UUID is time-ordered
orderBy: ['ID_ASC']
```

**If other sorting is needed:** Add index in provision, then re-run codegen.

### SDK Nullable Field Handling

SDK returned fields are usually `string | null | undefined`. Handle when passing to state:

```typescript
// ❌ May throw error
const [name, setName] = useState(data.board.name);

// ✅ Handle with ?? ''
const [name, setName] = useState(data.board.name ?? '');
```

### Update Mutation Patch Naming

Update mutation's patch parameter name is `${entity}Patch`:

```typescript
// Board → boardPatch
await updateMutation.mutateAsync({
  id: boardId,
  boardPatch: { name, description },
});

// List → listPatch
await updateMutation.mutateAsync({
  id: listId,
  listPatch: { name, position },
});

// Card → cardPatch
await updateMutation.mutateAsync({
  id: cardId,
  cardPatch: { title, description },
});
```

### Query Hook Parameter Format

Generated query hooks have specific parameter structures:

**List query (useBoardsQuery):**
```typescript
// ✅ Correct - selection contains fields + where + orderBy
useBoardsQuery({
  selection: {
    fields: { id: true, name: true },
    where: { entityId: { equalTo: entityId } },
    orderBy: ['ID_ASC'],
  },
  enabled: !!entityId,  // <- At top level, not options: { enabled }
});
```

**Single query (useBoardQuery):**
```typescript
// ✅ Correct - id at top level, selection only has fields
useBoardQuery({
  id: boardId,
  selection: { fields: { id: true, name: true } },
  enabled: isReady,  // <- At top level
});
```

---

## Next.js app Supplement (boilerplates moved out — see the constructive-io/constructive repo)

### Getting Current User

The template provides two ways to get user information:

**Method 1: useAuth (local store, recommended for getting entityId)**
```typescript
import { useAuth } from '@/store/app-store';

const auth = useAuth();
const entityId = auth.user?.id ?? '';
const isAuthenticated = auth.isAuthenticated;
```

**Method 2: useCurrentUser (GraphQL API, for detailed info)**
```typescript
import { useCurrentUser } from '@/lib/gql/hooks/admin/app';

const { user, isLoading } = useCurrentUser({});
```

> **Note**: `useAuthStore` doesn't exist! Don't import from `@/store/auth-slice`.

### Homepage Replacement

Use `Write` to overwrite `src/app/page.tsx` directly, no need to read existing file:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/lib/auth/auth-context';
import { LoginScreen } from '@/components/auth/screens/login-screen';

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { isAuthenticated, isLoading, login } = useAuthContext();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isLoading && isAuthenticated) {
      router.push('/boards');  // <- Change to your main route
    }
  }, [mounted, isLoading, isAuthenticated, router]);

  if (!mounted || isLoading || isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/20 border-t-transparent" />
      </div>
    );
  }

  return <LoginScreen onLogin={login} />;
}
```

### Adding New Route Checklist

When adding a new feature route, update 3 places:

1. **Create page file**: `src/app/<feature>/page.tsx`
2. **Register route**: `src/app-routes.ts` add route configuration
3. **Add navigation**: `src/lib/navigation/sidebar-config.ts` add sidebar link

```typescript
// app-routes.ts
export const APP_ROUTES = {
  // ... existing routes
  BOARDS: {
    path: '/boards' as Route,
    searchParams: {},
    access: 'protected' as RouteAccessType,
    context: 'app' as SchemaContext,
  },
};

// sidebar-config.ts - Add in mainItems of getRootNavigation
const mainItems: NavItem[] = [
  {
    id: 'boards',
    label: 'Boards',
    icon: RiLayoutGridLine,  // Import from @remixicon/react
    href: '/boards',
    isActive: isRouteActive?.('BOARDS'),
  },
  // ... existing items
];
```

---

## Common Imports Quick Reference

```typescript
// UI Components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// Stack
import { useCardStack, useCardReady } from '@/components/ui/stack';
import type { CardComponent } from '@/components/ui/stack';

// Auth (correct import methods)
import { useAuth } from '@/store/app-store';           // <- Get auth state
import { useAuthContext } from '@/lib/auth/auth-context'; // <- Get login/logout methods
import { useCurrentUser } from '@/lib/gql/hooks/admin/app'; // <- Get detailed user info

// SDK (change to your entity)
import {
  useBoardsQuery,
  useBoardQuery,
  useCreateBoardMutation,
  useUpdateBoardMutation,
  useDeleteBoardMutation,
} from '@sdk/app';

// Icons (remixicon)
import { RiLayoutGridLine, RiSettings3Line, RiAddLine } from '@remixicon/react';

// Icons (lucide-react) - also available
import { Plus, Settings, Trash2, Edit, Layout } from 'lucide-react';
```

---

## Phase 3: Adding Route Templates (Direct Edit, No Read Required)

> **No need to read `app-routes.ts` and `sidebar-config.ts`**, just use the templates below to Edit directly.

### 1. Add Routes to app-routes.ts

Add after the `ROOT:` configuration block (search for `ROOT:` then add after it):

```typescript
// In app-routes.ts, find ROOT: { ... }, add after it:

	// ==========================================================================
	// YOUR APP ROUTES - Business Routes
	// ==========================================================================
	BOARDS: {
		path: '/boards' as Route,
		searchParams: {},
		access: 'protected' as RouteAccessType,
		context: 'app' as SchemaContext,
	},

	BOARD_DETAIL: {
		path: '/boards/[boardId]' as Route,
		searchParams: {},
		access: 'protected' as RouteAccessType,
		context: 'app' as SchemaContext,
	},
```

**Edit Example:**
```
oldText: "ROOT: {\n\t\tpath: '/' as Route,"
newText: "ROOT: {\n\t\tpath: '/' as Route,\n\t\t... // original content\n\t},\n\n\tBOARDS: {\n\t\tpath: '/boards' as Route,\n\t\t..."
```

### 2. Add Sidebar Link to sidebar-config.ts

**Step 1:** Add icon import (in the import block at top of file):

```typescript
// Find import { ... } from '@remixicon/react';
// Add the icons you need, for example:
import {
	RiCheckboxCircleLine,  // <- Add
	// ... other existing icons
} from '@remixicon/react';
```

**Step 2:** Add link in `mainItems` array:

```typescript
// Find const mainItems: NavItem[] = [
// Add at the beginning or appropriate position:

	const mainItems: NavItem[] = [
		{
			id: 'boards',
			label: 'Boards',
			icon: RiCheckboxCircleLine,
			href: '/boards',
			isActive: isRouteActive?.('BOARDS') || isRouteActive?.('BOARD_DETAIL'),
		},
		// ... other existing items
	];
```

### 3. Common Remixicon Icons

| Icon | Use Case |
|------|----------|
| `RiCheckboxCircleLine` | Todo / Tasks |
| `RiLayoutGridLine` | Boards / Grid |
| `RiFolder3Line` | Projects / Folders |
| `RiContactsLine` | Contacts / CRM |
| `RiBuilding2Line` | Companies |
| `RiMoneyDollarCircleLine` | Deals / Finance |
| `RiCalendarLine` | Calendar / Events |
| `RiFileTextLine` | Documents |
| `RiDashboardLine` | Dashboard |

### 4. Complete Edit Command Examples

**Add PROJECTS Route:**

```
Edit app-routes.ts:
oldText: "context: 'admin' as SchemaContext,\n\t},"  (End of ROOT block)
newText: "context: 'admin' as SchemaContext,\n\t},\n\n\t// ==========================================================================\n\t// TODO APP ROUTES\n\t// ==========================================================================\n\tPROJECTS: {\n\t\tpath: '/projects' as Route,\n\t\tsearchParams: {},\n\t\taccess: 'protected' as RouteAccessType,\n\t\tcontext: 'app' as SchemaContext,\n\t},"
```

**Add Sidebar Icon Import:**

```
Edit sidebar-config.ts:
oldText: "RiHome4Line,"
newText: "RiCheckboxCircleLine,\n\tRiHome4Line,"
```

**Add Sidebar Link:**

```
Edit sidebar-config.ts:
oldText: "const mainItems: NavItem[] = [\n\t\t{\n\t\t\tid: 'home',"
newText: "const mainItems: NavItem[] = [\n\t\t{\n\t\t\tid: 'projects',\n\t\t\tlabel: 'Projects',\n\t\t\ticon: RiCheckboxCircleLine,\n\t\t\thref: '/projects',\n\t\t\tisActive: isRouteActive?.('PROJECTS'),\n\t\t},\n\t\t{\n\t\t\tid: 'home',"
```
