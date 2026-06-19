/**
 * config.ts — Centralized configuration for provisioning
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-provision.mjs. Placeholders below are
 * substituted from the app brief (build/app-brief.yaml) + constructive.config.json:
 *   __DB_NAME__         ← naming.db_name        (plain lowercase, no hyphens)
 *   __ADMIN_EMAIL__     ← auth.admin_email
 *   __ADMIN_PASSWORD__  ← auth.admin_password
 *   __API_ENDPOINT__    ← hub platform `api`     endpoint (constructive.config.json)
 *   __MODULES_ENDPOINT__← hub platform `modules` endpoint (constructive.config.json)
 *   __AUTH_ENDPOINT__   ← hub platform `auth`    endpoint (constructive.config.json)
 *   __PG_HUB_DATABASE__ ← physical hub Postgres database (constructive.config.json)
 * Everything else is generic and identical for every app. The `process.env.* ||`
 * fallback chain is preserved so a .env still overrides at runtime — these
 * placeholders only set the DEFAULT (what the env var falls back to).
 * ──────────────────────────────────────────────────────────────────────────
 */
import dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root (cwd is packages/provision/ when run via pnpm)
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

export const config = {
  // Metaschema READS only (e.g. resolving a database) live on api.localhost.
  apiEndpoint: process.env.API_ENDPOINT || '__API_ENDPOINT__',
  // Provisioning + blueprint WRITES (databaseProvisionModule, createBlueprint,
  // constructBlueprint, secureTableProvision, field/relation provision) live ONLY
  // on modules.localhost — they 404 on api.localhost. See gotchas PROVISION-001 / F4.
  modulesEndpoint: process.env.MODULES_ENDPOINT || '__MODULES_ENDPOINT__',
  authEndpoint: process.env.AUTH_ENDPOINT || '__AUTH_ENDPOINT__',
  databaseName: process.env.DATABASE_NAME || '__DB_NAME__',
  databaseId: process.env.DATABASE_ID,
  // PHYSICAL hub Postgres DB that holds the metaschema AND every per-tenant schema.
  pgDatabase: process.env.PG_HUB_DATABASE || '__PG_HUB_DATABASE__',
  ownerId: process.env.OWNER_ID,
  adminEmail: process.env.ADMIN_EMAIL || '__ADMIN_EMAIL__',
  adminPassword: process.env.ADMIN_PASSWORD || '__ADMIN_PASSWORD__',
  accessToken: process.env.ACCESS_TOKEN,
  get authHeaders(): Record<string, string> {
    return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
  },
};
