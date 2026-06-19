/**
 * use-meta.ts — `useMeta` / `useTableMeta` hooks for runtime schema introspection.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: lifted from constructive-frontend/references/meta-forms.md §4.
 * scripts/scaffold-frontend.mjs stamps this to <app>/src/lib/meta/use-meta.ts.
 * Placeholders / rewrites:
 *   __APP_ENDPOINT__   ← the app-public GraphQL endpoint URL (where `_meta` and all
 *                        domain CRUD live for THIS app). The meta-forms reference
 *                        imported a `CRM_ENDPOINT` from a crm-provider; here the
 *                        endpoint is injected directly so the CRUD infra is
 *                        self-contained (no crm-provider dependency).
 *   @/lib/auth/token-manager ← the app's TokenManager (same bridge the auth blocks
 *                        write to). The generator leaves this relative import as-is;
 *                        it is the canonical token store in the boilerplate.
 *   @/types/meta       ← rewritten to wherever meta-types.ts landed.
 * No bespoke logic added — faithful copy with the documented query.all fix carried
 * through dynamic-form-card.ts.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { TokenManager } from '@/lib/auth/token-manager';
import type { MetaTable } from '@/types/meta';

// The app-public GraphQL endpoint for THIS app — `_meta` + every domain CRUD root.
const APP_ENDPOINT = '__APP_ENDPOINT__';

const META_QUERY = `query GetMeta {
  _meta {
    tables {
      name
      fields { name isNotNull hasDefault type { pgType gqlType isArray } }
      inflection { tableType createInputType patchType filterType orderByType }
      query { all one create update delete }
      primaryKeyConstraints { name fields { name } }
      foreignKeyConstraints { name fields { name } referencedTable referencedFields }
      uniqueConstraints { name fields { name } }
    }
  }
}`;

async function fetchMeta(): Promise<{ _meta: { tables: MetaTable[] } }> {
  // PER-REQUEST token read (gotchas SDK-008): the token is read HERE, inside the request
  // function, on every call — NEVER snapshotted at module load. So the FIRST `_meta`/CRUD
  // request in a fresh authenticated session (right after sign-up/sign-in, before any reload)
  // already carries the live bearer instead of going out anonymous. Use the `app` namespace
  // (this is the app-public endpoint); TokenManager keys a single store but the arg keeps the
  // intent explicit and aligned with the SDK `app` adapter's per-request auth seam.
  const { token } = TokenManager.getToken('app');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token.accessToken}`;
  const res = await fetch(APP_ENDPOINT, {
    method: 'POST', headers,
    body: JSON.stringify({ query: META_QUERY }),
  });
  if (!res.ok) throw new Error(`_meta fetch failed: ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message ?? '_meta error');
  return json.data;
}

export function useMeta() {
  return useQuery({ queryKey: ['_meta'], queryFn: fetchMeta, staleTime: Infinity });
}

export function useTableMeta(tableName: string): MetaTable | null {
  const { data } = useMeta();
  return data?._meta.tables.find((t) => t.name === tableName) ?? null;
}
