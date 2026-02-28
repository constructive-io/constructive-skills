---
name: graphile-pgvector
description: Integrate pgvector with PostGraphile v5. Use when asked to "expose vector search in GraphQL", "add embedding column to schema", "surface pgvector types in PostGraphile", "register vector codec", or when building AI-powered GraphQL APIs that need similarity search or embedding support.
compatibility: PostGraphile v5 RC, pgvector extension, Grafast, graphile-build-pg
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Graphile + pgvector Integration

Integrate pgvector with PostGraphile v5 (Grafast/graphile-build-pg) so that `vector(n)` columns are surfaced in GraphQL as a `Vector` scalar, and vector similarity search is available as first-class GraphQL query fields.

## When to Apply

Use this skill when:
- Adding `vector(n)` columns to tables and need them visible in the PostGraphile schema
- Exposing vector similarity search (cosine, L2, inner product) as GraphQL queries
- Building AI/RAG features on top of a Constructive or PostGraphile v5 stack
- Writing integration tests for pgvector-backed GraphQL APIs

## Two Moving Parts

| Component | Package | What it does |
|---|---|---|
| `VectorCodecPlugin` | `graphile-settings` | Registers a codec for the `vector` PG type → `Vector` GraphQL scalar; makes `embedding` columns visible |
| `PgVectorPlugin` / `PgVectorPreset` | `postgraphile-plugin-pgvector` | Adds `vectorSearch<Table>` root query fields with `query`, `limit`, `offset`, `metric` args |

Both must be in the preset for end-to-end vector support.

## VectorCodecPlugin — Expose `vector` Columns as GraphQL Scalar

Without this plugin, PostGraphile silently ignores `vector(n)` columns. The codec teaches `graphile-build-pg` how to parse and serialize the type.

### Wire Format

PostgreSQL sends vectors as text: `[0.1,0.2,...,0.768]`
JavaScript representation: `number[]`
GraphQL scalar: `Vector` (serialized as `[Float]`)

### Source Location

`graphile-settings/src/plugins/vector-codec.ts` — included automatically in `ConstructivePreset`.

### Pure Helper Exports (Testable Standalone)

```typescript
import { fromPgVector, toPgVector, vectorScalarConfig } from 'graphile-settings/plugins/vector-codec';

// Parse PG text → JS
fromPgVector('[0.1,0.2,0.3]'); // => [0.1, 0.2, 0.3]

// Serialize JS → PG text
toPgVector([0.1, 0.2, 0.3]); // => '[0.1,0.2,0.3]'
```

### Plugin Structure

```typescript
export const VectorCodecPlugin: GraphileConfig.Plugin = {
  name: 'VectorCodecPlugin',
  version: '1.0.0',

  // Gather phase: hook into codec discovery; register codec when type.typname === 'vector'
  gather: {
    hooks: {
      async pgCodecs_findPgCodec(info, event) {
        if (event.pgCodec) return;
        const { pgType: type, serviceName } = event;
        if (type.typname !== 'vector') return;
        // ... resolve namespace, build codec with fromPg/toPg, set event.pgCodec
      },
    },
  },

  // Schema phase: register Vector scalar and map the codec to it
  schema: {
    hooks: {
      init: {
        before: ['PgCodecs'],
        callback(_, build) {
          build.registerScalarType('Vector', {}, () => vectorScalarConfig, '...');
          for (const codec of Object.values(build.input.pgRegistry.pgCodecs)) {
            if ((codec as any).name === 'vector') {
              setGraphQLTypeForPgCodec(codec as any, 'input', 'Vector');
              setGraphQLTypeForPgCodec(codec as any, 'output', 'Vector');
            }
          }
          return _;
        },
      },
    },
  },
};
```

### Key Hook: `pgCodecs_findPgCodec`

This gather hook fires for every unknown PG type. Return early if `event.pgCodec` is already set (already handled). Check `type.typname === 'vector'` and assign a codec with `fromPg`/`toPg` functions.

### Key Hook: `init` (before `PgCodecs`)

Must run before `PgCodecs` processes the registry. Registers the `Vector` scalar and maps it to the codec for both `input` and `output` GraphQL roles.

---

## PgVectorPlugin — Vector Search GraphQL Fields

Adds root query fields for similarity search across configured tables.

### Installation

```bash
pnpm add postgraphile-plugin-pgvector
```

### Usage — Preset (Recommended)

```typescript
import { PgVectorPreset } from 'postgraphile-plugin-pgvector';

const preset: GraphileConfig.Preset = {
  extends: [
    ConstructivePreset,        // includes VectorCodecPlugin
    PgVectorPreset({
      collections: [
        {
          schema: 'public',
          table: 'documents',
          embeddingColumn: 'embedding',
          graphqlFieldName: 'vectorSearchDocument',  // optional; auto-generated if omitted
          maxQueryDim: 768,                          // optional defensive validation
        },
        {
          schema: 'public',
          table: 'contacts',
          embeddingColumn: 'embedding',
        },
      ],
      defaultMetric: 'COSINE',  // COSINE | L2 | IP
      maxLimit: 100,
    }),
  ],
};
```

### Usage — Plugin Directly

```typescript
import { PgVectorPlugin } from 'postgraphile-plugin-pgvector';

const plugin = PgVectorPlugin({
  collections: [{ schema: 'public', table: 'documents', embeddingColumn: 'embedding' }],
});
```

### Generated GraphQL API

```graphql
type Query {
  vectorSearchDocument(
    query: [Float!]!       # embedding vector (must match column dimensions)
    limit: Int             # default 10, capped at maxLimit
    offset: Int            # pagination
    metric: VectorMetric   # COSINE (default), L2, IP
  ): [DocumentVectorSearchResult!]!
}

enum VectorMetric { COSINE L2 IP }

type DocumentVectorSearchResult {
  distance: Float!   # distance score; lower = more similar for COSINE/L2
  id: Int!
  title: String!
  # ... all other table columns
}
```

### GraphQL Query Example

```graphql
query SearchDocuments($vector: [Float!]!) {
  vectorSearchDocument(query: $vector, limit: 5, metric: COSINE) {
    distance
    id
    title
    content
  }
}
```

### Distance Metrics

| Metric | Operator | Range | Notes |
|---|---|---|---|
| `COSINE` | `<=>` | 0–2 | 0 = identical; recommended for normalized embeddings |
| `L2` | `<->` | 0–∞ | Euclidean distance |
| `IP` | `<#>` | −∞–0 | Negative inner product; higher (less negative) = more similar |

---

## Codegen — `Vector` Type → `number[]`

When using `@constructive-io/graphql-codegen`, add the `Vector` scalar mapping so generated types use `number[]` instead of `unknown`:

```typescript
// graphql-codegen.config.ts
export default createConfig({
  targets: [{
    // ...
    scalars: {
      Vector: 'number[]',
    },
  }],
});
```

With `@constructive-io/graphql-codegen >= 4.6.0`, `Vector: 'number[]'` is built-in to `SCALAR_TS_MAP`.
For `4.2.0`, apply a pnpm patch adding `scalars?: Record<string, string>` to the config type defs.

---

## SQL Search Functions (Alternative: Direct SQL)

For route-level RAG (bypassing GraphQL), define SQL functions instead:

```sql
CREATE OR REPLACE FUNCTION your_schema.search_contacts(
  query_embedding vector(768),
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  entity_id text,
  first_name text,
  last_name text,
  email text,
  headline text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id, entity_id, first_name, last_name, email, headline,
    1 - (embedding <=> query_embedding) AS similarity
  FROM your_schema.contacts
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

These are surfaced automatically in the GraphQL schema (PostGraphile computed columns / functions) if the naming and return type conventions match. The `VectorCodecPlugin` is still required so that the `vector` argument type resolves correctly.

---

## Integration Tests

Use `graphile-test`'s `getConnections` with real DB. No mocks.

```typescript
// __tests__/pgvector.test.ts
import { join } from 'path';
import { getConnections, seed } from 'graphile-test';
import { PgVectorPreset } from 'postgraphile-plugin-pgvector';
import { ConstructivePreset } from 'graphile-settings';

describe('PgVectorPlugin', () => {
  let db: PgTestClient;
  let teardown: () => Promise<void>;
  let query: QueryFn;

  beforeAll(async () => {
    const testPreset = {
      extends: [
        ConstructivePreset,
        PgVectorPreset({
          collections: [{
            schema: 'pgvector_test',
            table: 'documents',
            embeddingColumn: 'embedding',
            graphqlFieldName: 'vectorSearchDocument',
          }],
        }),
      ],
    };

    const connections = await getConnections({
      schemas: ['pgvector_test'],
      preset: testPreset,
      useRoot: true,
    }, [
      seed.sqlfile([join(__dirname, './setup.sql')])
    ]);

    ({ db, teardown, query } = connections);
    await db.client.query('BEGIN');
  });

  afterAll(async () => {
    try { await db.client.query('ROLLBACK'); } catch {}
    await teardown();
  });

  beforeEach(() => db.beforeEach());
  afterEach(() => db.afterEach());

  it('returns vector search results ordered by distance', async () => {
    // Insert test doc with pre-computed embedding
    const embedding = Array(768).fill(0.1);
    await db.client.query(
      `INSERT INTO pgvector_test.documents (title, content, embedding)
       VALUES ($1, $2, $3::vector)`,
      ['Test Doc', 'Hello world', `[${embedding.join(',')}]`]
    );

    const result = await query<{ vectorSearchDocument: Array<{ title: string; distance: number }> }>(`
      query {
        vectorSearchDocument(query: [${embedding.join(',')}], limit: 5, metric: COSINE) {
          title
          distance
        }
      }
    `);

    expect(result.data?.vectorSearchDocument).toHaveLength(1);
    expect(result.data?.vectorSearchDocument[0].title).toBe('Test Doc');
    expect(result.data?.vectorSearchDocument[0].distance).toBeCloseTo(0, 5);
  });
});
```

### Setup SQL

```sql
-- __tests__/setup.sql
CREATE SCHEMA IF NOT EXISTS pgvector_test;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE pgvector_test.documents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  embedding vector(768),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON pgvector_test.documents USING hnsw (embedding vector_cosine_ops);
```

### Key `graphile-test` Pattern Notes

- `getConnections({ schemas, preset, useRoot: true }, [seed.sqlfile([...])])` — no mocks
- `graphile-test` has `MinimalPreset` baked in; pass your plugin preset as `extends`
- SQL fixture must `CREATE EXTENSION IF NOT EXISTS vector;` before creating vector columns
- Use `BEGIN` / `ROLLBACK` for transaction-scoped test isolation (not `beforeEach` schema drops)

---

## Codec-Only Usage (No Search Fields)

If you only need `vector` columns visible in the schema (not search fields), just include `VectorCodecPlugin` in your preset:

```typescript
import { VectorCodecPlugin } from 'graphile-settings/plugins/vector-codec';
// or use ConstructivePreset which includes it automatically

const preset = {
  plugins: [VectorCodecPlugin],
};
```

After adding: `embedding: number[] | null` appears in all generated types, mutations accept `Vector` scalar, and SQL functions with `vector` args are surfaced in GraphQL.

---

## Common Pitfalls

| Issue | Cause | Fix |
|---|---|---|
| `embedding` field missing from schema | `vector` type not recognized | Add `VectorCodecPlugin` (or `ConstructivePreset`) |
| `Unknown type "Vector"` in codegen | Scalar not mapped | Add `scalars: { Vector: 'number[]' }` to codegen config |
| SQL function with `vector` arg not surfaced | Same as above | `VectorCodecPlugin` must be present |
| `VectorMetricEnum` duplicate type error | Multiple `PgVectorPreset` instances | Create the enum once outside the loop or deduplicate by name |
| `withPgClient` not in context | Missing `makePgService` in preset | Ensure `pgServices` is configured in your PostGraphile preset |
| `getResource` returning `null` in init hook | Table not in `schemas` list | Add the schema to `schemas` in `getConnections` or PostGraphile config |
| `dimension mismatch` error from pgvector | Query vector length ≠ column dimension | Set `maxQueryDim` in collection config; validate before calling |

---

## References

- Related skill: `pgvector-setup` — DB schema with HNSW indexes
- Related skill: `pgvector-embeddings` — generating and storing embeddings
- Related skill: `rag-pipeline` — full RAG pipeline from embed to LLM
- Related skill: `agentic-kit-rag` — wiring RAG into agentic-kit chat routes
- [pgvector docs](https://github.com/pgvector/pgvector)
- [PostGraphile v5 plugin guide](https://postgraphile.org/postgraphile/next/extending/)
- [Grafast step plan API](https://grafast.org/)
