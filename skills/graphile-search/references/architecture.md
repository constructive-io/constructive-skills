# Search Plugin Architecture

All three search plugins share the same architecture. Understanding this pattern is essential for debugging, extending, or building new search plugins.

---

## WeakMap Bridge Pattern

The core challenge: **condition fields** run during SQL generation (deferred phase) on a proxy object, but **computed fields** run during Grafast's planning phase on the real PgSelectStep. These two phases cannot directly communicate.

The solution is a module-level WeakMap keyed by the SQL alias object, which has the **same reference identity** on both the PgSelectStep and the queryBuilder proxy.

```
1. PLANNING PHASE (score/distance field plan)
   └─ Initialises a WeakMap slot keyed by the SQL alias object
   └─ Creates a lambda step that will read the row at a dynamic index

2. PLANNING PHASE (orderBy enum apply)
   └─ Stores sort direction in PgSelectStep meta (e.g., 'ASC' or 'DESC')

3. DEFERRED SQL-GEN PHASE (condition apply)
   └─ Adds the score/distance expression to SELECT list via proxy.selectAndReturnIndex()
   └─ Stores the resulting index in the WeakMap slot
   └─ Reads PgSelectStep meta for explicit ordering; adds ORDER BY if requested

4. EXECUTION PHASE (lambda reads row)
   └─ Reads row[storedIndex] from the WeakMap slot to get the score/distance value
```

### Why This Pattern?

- Condition `apply` functions run on a **proxy** (not the real PgSelectStep) during deferred SQL generation
- Computed field `plan` functions run on the **real PgSelectStep** during Grafast planning
- The WeakMap allows the computed field's lambda to read a value that isn't known until the condition runs later
- OrderBy is only applied when **explicitly requested** via enum values, keeping cursor pagination stable

---

## Four Hooks

Each search plugin uses these four `graphile-build` schema hooks:

### 1. `init` — Register Types

Register input types and scalars needed by the other hooks.

```typescript
init(_, build) {
  // Register input types (e.g., Bm25SearchInput, VectorNearbyInput)
  build.registerInputObjectType('MySearchInput', {}, () => ({
    fields: () => ({ query: { type: GraphQLString } }),
  }), 'description');
  return _;
}
```

### 2. `GraphQLObjectType_fields` — Computed Fields

Add score/distance/rank computed fields to output types. Runs for every GraphQL object type — filter by `isPgClassType` and check for relevant columns.

```typescript
GraphQLObjectType_fields(fields, build, context) {
  const { scope: { isPgClassType, pgCodec } } = context;
  if (!isPgClassType || !pgCodec?.attributes) return fields;

  // For each relevant column:
  // 1. Create a WeakMap slot keyed by $select.alias
  // 2. Return a lambda that reads row[storedIndex]
  // The index is set later by the condition apply
}
```

### 3. `GraphQLEnumType_values` — OrderBy Values

Add orderBy enum values (e.g., `SEARCH_TSV_RANK_DESC`). Runs for every enum type — filter by `isPgRowSortEnum`.

```typescript
GraphQLEnumType_values(values, build, context) {
  const { scope: { isPgRowSortEnum, pgCodec } } = context;
  if (!isPgRowSortEnum || !pgCodec?.attributes) return values;

  // For each relevant column:
  // Add ASC/DESC enum values with apply functions that call step.setMeta()
  // The meta value is read by the condition apply to add ORDER BY
}
```

### 4. `GraphQLInputObjectType_fields` — Condition Fields

Add condition fields to connection condition input types. This is where the actual search logic lives.

```typescript
GraphQLInputObjectType_fields(fields, build, context) {
  const { scope: { isPgCondition, pgCodec } } = context;
  if (!isPgCondition || !pgCodec?.attributes) return fields;

  // For each relevant column:
  // Add a condition field with an apply function that:
  // 1. Adds WHERE clause ($condition.where(...))
  // 2. Adds score/distance to SELECT list ($parent.selectAndReturnIndex(...))
  // 3. Stores the index in the WeakMap slot
  // 4. Reads meta for explicit orderBy; adds ORDER BY if requested
}
```

---

## Plugin Dependencies

Each search plugin has a companion codec plugin:

| Search Plugin | Codec Plugin | What Codec Does |
|--------------|-------------|-----------------|
| `PgSearchPlugin` | `TsvectorCodecPlugin` | Registers `FullText` scalar for tsvector, filter `matches` operator |
| `Bm25SearchPlugin` | `Bm25CodecPlugin` | Introspects DB for BM25 indexes via `pg_indexes`, populates `bm25IndexStore` |
| `VectorSearchPlugin` | `VectorCodecPlugin` | Registers `Vector` scalar, teaches PostGraphile the `vector` PG type |

The presets bundle codec + search plugin:

```typescript
PgSearchPreset(options)    // = [TsvectorCodecPlugin, PgSearchPlugin]
Bm25SearchPreset(options)  // = [Bm25CodecPlugin, Bm25SearchPlugin]
VectorCodecPreset          // = [VectorCodecPlugin] (search plugin added separately)
```

---

## Auto-Discovery Mechanism

Each plugin discovers relevant columns differently:

| Plugin | Discovery Method |
|--------|-----------------|
| PgSearchPlugin | Checks `codec.extensions.pg.schemaName === 'pg_catalog' && codec.extensions.pg.name === 'tsvector'` on each attribute |
| Bm25SearchPlugin | Checks `bm25IndexStore` (populated by Bm25CodecPlugin during gather phase from `pg_indexes`) for text columns with BM25 indexes |
| VectorSearchPlugin | Checks `codec.name === 'vector'` on each attribute |

---

## Building a New Search Plugin

To add a new search strategy (e.g., trigram similarity):

1. **Create a codec plugin** — register custom types/scalars, optionally do gather-phase introspection
2. **Create a search plugin** — implement the four hooks:
   - `init` — register input types (e.g., `SimilarityInput`)
   - `GraphQLObjectType_fields` — add computed fields (e.g., `titleSimilarity: Float`)
   - `GraphQLEnumType_values` — add orderBy enums (e.g., `TITLE_SIMILARITY_ASC/DESC`)
   - `GraphQLInputObjectType_fields` — add condition fields with apply functions
3. **Create a preset** — bundle codec + search plugin
4. **Add to `ConstructivePreset`** — add the preset to the `extends` array
5. **Re-export from `graphile-settings/src/plugins/index.ts`**

Use `graphile-search-plugin` (simplest) as a template.

---

## Key Implementation Details

### getPgSelectStep Helper

All three plugins use duck-typing to navigate from a `PgSelectSingleStep` to the parent `PgSelectStep`:

```typescript
function getPgSelectStep($someStep: any): any | null {
  let $step = $someStep;
  if ($step && typeof $step.getClassStep === 'function') {
    $step = $step.getClassStep();
  }
  if ($step && typeof $step.orderBy === 'function' && $step.id !== undefined) {
    return $step;
  }
  return null;
}
```

### setInliningForbidden

All computed field plans call `$select.setInliningForbidden()` to prevent PostGraphile from inlining the select step, which would break the WeakMap slot mechanism.

### Score Casting

All score/distance expressions are cast to text before being added to the SELECT list: `sql.parens(scoreExpr)}::text`. The lambda then calls `parseFloat()` on the result. This avoids issues with PostgreSQL type coercion in complex queries.

### Explicit OrderBy Only

OrderBy is never applied automatically. Users must explicitly request rank/score/distance ordering via the enum values. This is critical for cursor pagination stability — if ordering changed implicitly based on whether a search was active, cursor digests would break across pages.
