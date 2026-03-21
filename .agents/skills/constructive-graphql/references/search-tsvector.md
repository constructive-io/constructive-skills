# Creating and Querying TSVector Search

Built-in PostgreSQL full-text search with stemming, ranking, and phrase matching. No extension required — `tsvector` and `tsquery` are core PostgreSQL types.

---

## Creating TSVector Search via SDK

### Recommended: Declarative Full-Text Search (`db.fullTextSearch.create`)

The preferred way to set up TSVector search is through Constructive's `fullTextSearch` model. This inserts a row into the metaschema `full_text_search` table, which automatically:

1. Creates a trigger function that builds the tsvector from your source text fields
2. Creates INSERT and UPDATE triggers so the tsvector column stays in sync
3. Applies optional per-field weights (A-D) for ranking priority
4. Supports per-field language configurations for stemming

#### Step 1: Create a tsvector field on your table

```typescript
const tsvField = await db.field.create({
  data: {
    databaseId,
    tableId: articlesTableId,
    name: 'search_tsv',
    type: 'tsvector',
  },
  select: { id: true, name: true },
}).execute();
```

#### Step 2: Create a GIN index on the tsvector field

```typescript
const indexResult = await db.index.create({
  data: {
    databaseId,
    tableId: articlesTableId,
    name: 'idx_articles_search_tsv_gin',
    fieldIds: [tsvField.data.createField.field.id],
    accessMethod: 'gin',
  },
  select: { id: true, name: true },
}).execute();
```

#### Step 3: Declare the full-text search configuration

This is the key step. Instead of writing a manual trigger, call `db.fullTextSearch.create()` to declare which source text fields populate the tsvector column, with weights and language configs:

```typescript
const ftsResult = await db.fullTextSearch.create({
  data: {
    tableId: articlesTableId,
    fieldId: tsvField.data.createField.field.id,  // the tsvector field to populate
    fieldIds: [titleFieldId, bodyFieldId],          // source text columns
    weights: ['A', 'B'],                            // title weighted highest, body next
    langs: ['english', 'english'],                  // stemming language per field
  },
  select: { id: true },
}).execute();
```

The `fieldIds`, `weights`, and `langs` arrays must all have the same length — each position corresponds to one source field.

**Weight values** (A, B, C, D) control ranking priority:
- **A** = highest priority (e.g., title)
- **B** = high priority (e.g., subtitle, summary)
- **C** = normal priority (e.g., body text)
- **D** = low priority (e.g., metadata, tags)

After this call, the metaschema trigger generator creates the trigger function and triggers in the private schema. Any INSERT or UPDATE on the articles table will automatically recompute the `search_tsv` column from the weighted source fields.

### Alternative: Manual Setup (without metaschema triggers)

If you need custom trigger logic or don't want the metaschema managing the triggers, you can create the tsvector field and GIN index (Steps 1-2 above) and write your own trigger function to populate the tsvector column.

---

## Querying TSVector Search via SDK

Once the tsvector field, GIN index, and full-text search configuration exist, the SDK exposes search condition fields, rank scores, and ordering automatically.

### Basic Full-Text Search

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearchTsv: 'postgres full text',
  },
  orderBy: 'SEARCH_TSV_RANK_DESC',
  select: {
    id: true,
    title: true,
    searchTsvRank: true,
  },
}).execute();

if (result.ok) {
  const articles = result.data.articles.nodes;
  articles.forEach(a => {
    console.log(`${a.title} (rank: ${a.searchTsvRank})`);
  });
}
```

### Search with Pagination

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearchTsv: 'database indexing',
  },
  orderBy: 'SEARCH_TSV_RANK_DESC',
  first: 10,
  after: cursor,
  select: {
    id: true,
    title: true,
    searchTsvRank: true,
  },
}).execute();
```

### Combining Search with Other Filters

```typescript
const result = await db.article.findMany({
  where: {
    fullTextSearchTsv: 'postgres',
    isPublished: { equalTo: true },
    category: { equalTo: 'tech' },
  },
  orderBy: 'SEARCH_TSV_RANK_DESC',
  first: 20,
  select: {
    id: true,
    title: true,
    category: true,
    searchTsvRank: true,
  },
}).execute();
```

---

## Managing Full-Text Search Configurations

### List existing configurations

```typescript
const configs = await db.fullTextSearch.findMany({
  where: {
    tableId: { equalTo: articlesTableId },
  },
  select: {
    id: true,
    fieldId: true,
    fieldIds: true,
    weights: true,
    langs: true,
  },
}).execute();
```

### Update a configuration

Changing the source fields, weights, or languages causes the trigger generator to drop the old triggers and create new ones:

```typescript
await db.fullTextSearch.update({
  where: { id: existingFtsId },
  data: {
    fieldIds: [titleFieldId, bodyFieldId, tagsFieldId],
    weights: ['A', 'B', 'D'],
    langs: ['english', 'english', 'simple'],
  },
  select: { id: true },
}).execute();
```

### Delete a configuration

Deleting the full-text search row removes the auto-generated triggers and function:

```typescript
await db.fullTextSearch.delete({
  where: { id: existingFtsId },
  select: { id: true },
}).execute();
```

---

## Field Naming Convention

The SDK field names are derived from your database column name:

| DB Column | Condition Field | Score Field | OrderBy |
|-----------|----------------|-------------|---------|
| `search_tsv` | `fullTextSearchTsv` | `searchTsvRank` | `SEARCH_TSV_RANK_ASC/DESC` |
| `body_tsv` | `fullTextBodyTsv` | `bodyTsvRank` | `BODY_TSV_RANK_ASC/DESC` |
| `tsv` | `tsvTsv` | `tsvRank` | `TSV_RANK_ASC/DESC` |

**Pattern:**
- Condition: `fullText` + camelCase(column name)
- Rank score: camelCase(column name) + `Rank`
- OrderBy: SCREAMING_SNAKE(column name) + `_RANK_ASC` / `_RANK_DESC`

The rank score is a `Float` — higher values indicate better matches. It is `null` when no search condition is active.

---

## Common Gotchas

1. **Array length mismatch**: `fieldIds`, `weights`, and `langs` must have the same number of elements. Mismatched lengths will cause an error.
2. **Don't manually create GIN indexes on tsvector and also use `db.fullTextSearch.create()`** — create the GIN index yourself (Step 2) and let `fullTextSearch.create()` handle the trigger. The metaschema does not auto-create the GIN index for you.
3. **Language choice matters**: Using `'simple'` skips stemming entirely (useful for proper nouns, tags, identifiers). Using `'english'` applies English stemming rules. Mismatched language between indexing and querying produces zero results.
4. **Updating source fields requires a backfill**: After calling `db.fullTextSearch.update()` to change `fieldIds`/`weights`/`langs`, existing rows are not automatically re-indexed. The new triggers only fire on future INSERT/UPDATE. To backfill, touch each row (e.g., update a timestamp column).
5. **One tsvector field = one `fullTextSearch` config**: Each tsvector column should have exactly one `fullTextSearch` configuration. Creating multiple configs pointing to the same tsvector field will produce conflicting triggers.
6. **`fieldId` vs `fieldIds`**: `fieldId` (singular) is the tsvector destination column. `fieldIds` (plural) are the source text columns that populate it. Don't confuse them.

---

## When to Use TSVector

- Keyword search with stemming ("running" matches "run", "ran")
- Weighted multi-field search (title weighted higher than body)
- Phrase and proximity matching
- When you want Constructive to manage the tsvector population triggers automatically via `db.fullTextSearch.create()`

For better relevance ranking on document-heavy tables, consider BM25 (`references/bm25.md`).
