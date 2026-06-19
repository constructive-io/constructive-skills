/**
 * blueprint.ts — Blueprint provision engine
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: copied VERBATIM by scripts/scaffold-provision.mjs. No placeholders.
 * Generic across any app — the engine that constructs ANY BlueprintDefinition.
 * Do not edit per-app. (Source of truth: this template.)
 * ──────────────────────────────────────────────────────────────────────────
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
import { config } from './config.js';
import { Pool } from 'pg';

// Re-export types for schema modules
export type {
  BlueprintDefinition, BlueprintTable, BlueprintNode,
  BlueprintRelation, BlueprintField, BlueprintPolicy,
  BlueprintIndex, BlueprintFullTextSearch,
};

const databaseId = requireDatabaseId();

// The platform's reserved LOGICAL name for an app's per-tenant domain schema. The
// related-membership policy emitter (scripts/lib/brief.mjs POLICY_INTENTS) writes this as the
// AuthzRelatedEntityMembership `obj_schema` because the PHYSICAL schema name carries a runtime
// hash unknowable at emit time. resolveDomainSchema()/rewriteRelatedMembershipSchema() below
// swap it for the resolved physical schema_name immediately before construct. Kept byte-identical
// to brief.mjs APP_DOMAIN_SCHEMA_SENTINEL (the generator emits it; this engine consumes it).
const APP_DOMAIN_SCHEMA_SENTINEL = 'app_public';

/**
 * Resolve THIS tenant's PHYSICAL domain (`app_public`) schema name (e.g.
 * `myapp-a1b2c3d4-app-public`). Mirrors the resolver provision.ts already uses for the
 * public-read reconcile: prefer an exact DATABASE_ID lookup against metaschema_public.schema
 * (the authoritative logical→physical map), then fall back to an anchored, separator-tolerant
 * information_schema match. Returns undefined when nothing resolves (no PG env, or pre-provision).
 * GENERIC: no table/app/hash literal — only the universal logical name 'app_public'.
 */
async function resolveDomainSchema(pool: Pool): Promise<string | undefined> {
  const byId = await pool.query(
    `SELECT schema_name FROM metaschema_public.schema
     WHERE database_id = $1 AND name = $2 LIMIT 1`,
    [databaseId, APP_DOMAIN_SCHEMA_SENTINEL],
  );
  let schema = byId.rows[0]?.schema_name as string | undefined;
  if (!schema) {
    const dbLike = config.databaseName.replace(/_/g, '%').replace(/-/g, '%') + '%app%public';
    const byName = await pool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name LIKE $1
       ORDER BY length(schema_name), schema_name LIMIT 1`,
      [dbLike],
    );
    schema = byName.rows[0]?.schema_name as string | undefined;
  }
  return schema;
}

/**
 * Rewrite every AuthzRelatedEntityMembership policy whose `obj_schema` is the logical
 * APP_DOMAIN_SCHEMA_SENTINEL to the resolved PHYSICAL domain schema, IN PLACE on the
 * server-bound table list, BEFORE the (atomic) constructBlueprint call. Without this the
 * generated range_var references an unqualified relation and construct aborts with
 * 'relation "<parent>" does not exist'. A policy that already pins a real (non-sentinel)
 * obj_schema — author override via policy_params.join_schema — is left untouched. Returns the
 * count rewritten. GENERIC + IDEMPOTENT: a blueprint with no related-membership policy (the
 * overwhelming majority) is a clean no-op; nothing here is app-specific.
 */
function rewriteRelatedMembershipSchema(
  tables: Array<{ table_name?: string; policies?: unknown }>,
  physicalSchema: string,
): number {
  let n = 0;
  for (const t of tables) {
    const policies = Array.isArray(t.policies) ? (t.policies as Array<Record<string, unknown>>) : [];
    for (const p of policies) {
      if (p?.$type !== 'AuthzRelatedEntityMembership') continue;
      const data = (p.data ?? {}) as Record<string, unknown>;
      if (data.obj_schema === APP_DOMAIN_SCHEMA_SENTINEL) {
        data.obj_schema = physicalSchema;
        p.data = data;
        n += 1;
      }
    }
  }
  return n;
}

/**
 * Provision a blueprint definition via the server-side constructBlueprint mutation.
 * Returns a ref_map of { ref -> tableId } for cross-schema references.
 */
export async function provisionBlueprint(
  definition: BlueprintDefinition,
  label: string,
  client?: PlatformClient,
): Promise<Map<string, string>> {
  const sdk = client ?? createModulesClient();

  console.log(`\n  ${label}\n`);

  const ownerId = requireOwnerId();

  const blueprintName = `app_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
  const serverDef: Record<string, unknown> = {
    // Forward ONLY the object-form `grants`. The stale grant_roles + bare-tuple shape lands NO GRANT.
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

  // --- RELATED-MEMBERSHIP obj_schema rewrite (BEFORE the atomic construct) -----------------
  // The related-membership policy intent emits AuthzRelatedEntityMembership with obj_schema set
  // to the LOGICAL 'app_public' sentinel (the parent table's PHYSICAL schema name carries a
  // runtime hash unknowable when the blueprint is generated). Resolve THIS tenant's physical
  // domain schema and swap the sentinel in place — else constructBlueprint aborts the whole
  // provision with 'relation "<parent>" does not exist' (parse.sql does NOT auto-resolve a bare
  // obj_table name to a schema). Generic + idempotent: only fires when a sentinel-bearing
  // related-membership policy is present (rare), and leaves any author-pinned schema untouched.
  const serverTables = serverDef.tables as Array<{ table_name?: string; policies?: unknown }>;
  const hasSentinelRelMembership = serverTables.some((t) =>
    (Array.isArray(t.policies) ? (t.policies as Array<Record<string, unknown>>) : []).some(
      (p) => p?.$type === 'AuthzRelatedEntityMembership'
        && ((p.data ?? {}) as Record<string, unknown>).obj_schema === APP_DOMAIN_SCHEMA_SENTINEL,
    ),
  );
  if (hasSentinelRelMembership) {
    if (!process.env.PGHOST) {
      // The rewrite needs a PG connection to resolve the physical schema. Without PGHOST we
      // CANNOT make this policy construct-valid — fail LOUD rather than emit a sentinel that
      // aborts construct deep in the platform with an opaque 'relation does not exist'.
      throw new Error(
        'related-membership policy needs the physical domain schema resolved, but PGHOST is unset. ' +
        'Export PG env (eval "$(pgpm env)") and re-run provision — the blueprint engine resolves ' +
        'the app_public schema to rewrite AuthzRelatedEntityMembership.obj_schema before construct.',
      );
    }
    const schemaPool = new Pool({ database: config.pgDatabase });
    try {
      const physicalSchema = await resolveDomainSchema(schemaPool);
      if (!physicalSchema) {
        throw new Error(
          `Could not resolve this tenant's physical app_public schema (database_id=${databaseId}). ` +
          'The domain schema must exist before its tables are constructed — ensure create-db ran ' +
          'and the hub is up, then re-run provision.',
        );
      }
      const rewritten = rewriteRelatedMembershipSchema(serverTables, physicalSchema);
      console.log(`   related-membership: rewrote obj_schema → ${physicalSchema} on ${rewritten} policy(ies)`);
    } finally {
      await schemaPool.end();
    }
  }

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
