/**
 * helpers.ts — Shared utilities for provisioning
 *
 * Uses @constructive-io/sdk for GraphQL SDK access.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: copied VERBATIM by scripts/scaffold-provision.mjs. No placeholders.
 * Generic across any app — do not edit per-app. (Source of truth: this template.)
 * ──────────────────────────────────────────────────────────────────────────
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
 * Provisioning / blueprint client. Targets modules.localhost (writes 404 on api.localhost).
 */
export function createModulesClient(): ReturnType<typeof public_.createClient> {
  const token = config.accessToken;
  if (!token) throw new Error('ACCESS_TOKEN is required — run create-db first');
  return public_.createClient({
    endpoint: config.modulesEndpoint,
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Back-compat alias.
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

/** Get the owner_id (the signup userId) from config, throw if missing. */
export function requireOwnerId(): string {
  const id = config.ownerId;
  if (!id) { console.error('Missing OWNER_ID. Run create-db first (it persists the signup userId).'); process.exit(1); }
  return id;
}

export type PlatformClient = ReturnType<typeof createModulesClient>;
