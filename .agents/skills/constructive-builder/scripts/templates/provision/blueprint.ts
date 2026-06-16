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

// Re-export types for schema modules
export type {
  BlueprintDefinition, BlueprintTable, BlueprintNode,
  BlueprintRelation, BlueprintField, BlueprintPolicy,
  BlueprintIndex, BlueprintFullTextSearch,
};

const databaseId = requireDatabaseId();

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
