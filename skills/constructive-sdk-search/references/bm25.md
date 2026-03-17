# Creating and Querying BM25 Search

BM25 ranked search via the `pg_textsearch` extension. Provides better relevance ranking than built-in `ts_rank` with term frequency saturation and document length normalization.

---

## Creating BM25 Search via SDK

BM25 indexes are created directly on existing text columns — no extra column needed.

### Step 1: Create a text field (if not already present)

```typescript
const contentField = await db.field.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'content',
    type: 'text',
  },
  select: { id: true, name: true },
}).execute();
```

### Step 2: Create a BM25 index on the text field

```typescript
const indexResult = await db.index.create({
  data: {
    databaseId,
    tableId: documentsTableId,
    name: 'idx_documents_content_bm25',
    fieldIds: [contentField.data.createField.field.id],
    accessMethod: 'bm25',
    options: { text_config: 'english' },
  },
  select: { id: true, name: true },
}).execute();

if (indexResult.ok) {
  console.log('Created BM25 index:', indexResult.data.createIndex.index.name);
}
```

The `text_config` option controls stemming and stop word behavior. Use `'english'` for English text, `'simple'` for no stemming. Additional BM25 tuning parameters (`k1`, `b`) can also be passed in `options`.

---

## Querying BM25 Search via SDK

Once a BM25 index exists on a text column, the SDK exposes search condition fields, BM25 scores, and ordering.

### Basic BM25 Search

```typescript
const result = await db.document.findMany({
  where: {
    bm25Content: { query: 'postgres full text search' },
  },
  orderBy: 'BM25_CONTENT_SCORE_ASC',
  select: {
    id: true,
    title: true,
    bm25ContentScore: true,
  },
}).execute();

if (result.ok) {
  const docs = result.data.documents.nodes;
  docs.forEach(d => {
    console.log(`${d.title} (score: ${d.bm25ContentScore})`);
  });
}
```

**Important:** BM25 scores are negative — more negative means more relevant. Sort ascending (`_ASC`) to get the best matches first.

### Search with Pagination

```typescript
const result = await db.document.findMany({
  where: {
    bm25Content: { query: 'machine learning' },
  },
  orderBy: 'BM25_CONTENT_SCORE_ASC',
  first: 10,
  after: cursor,
  select: {
    id: true,
    title: true,
    bm25ContentScore: true,
  },
}).execute();
```

### Combining BM25 with Other Filters

```typescript
const result = await db.document.findMany({
  where: {
    bm25Content: { query: 'kubernetes deployment' },
    isPublished: { equalTo: true },
    category: { equalTo: 'devops' },
  },
  orderBy: 'BM25_CONTENT_SCORE_ASC',
  first: 20,
  select: {
    id: true,
    title: true,
    category: true,
    bm25ContentScore: true,
  },
}).execute();
```

---

## Field Naming Convention

| DB Column | Condition Field | Score Field | OrderBy |
|-----------|----------------|-------------|---------|
| `content` | `bm25Content` | `bm25ContentScore` | `BM25_CONTENT_SCORE_ASC/DESC` |
| `body` | `bm25Body` | `bodyBm25Score` | `BODY_BM25_SCORE_ASC/DESC` |

**Pattern:**
- Condition: `bm25` + camelCase(column name) — accepts `{ query: String }` input
- Score: camelCase(column name) + `Bm25Score` (or `bm25` + camelCase(column name) + `Score`)
- OrderBy: SCREAMING_SNAKE(column name) + `_BM25_SCORE_ASC` / `_BM25_SCORE_DESC`

The score is a negative `Float` — more negative indicates a better match. It is `null` when no BM25 condition is active.

---

## BM25 vs TSVector

| | TSVector (`ts_rank`) | BM25 (`pg_textsearch`) |
|---|---|---|
| **Ranking quality** | Frequency-based (biased toward long docs) | Term saturation + length normalization |
| **What you create** | `tsvector` column + GIN index + trigger | BM25 index on text column (no extra column) |
| **Score direction** | Higher = better | More negative = better |
| **Best for** | Simple keyword filtering with rough ordering | Document search where relevance ranking quality matters |

**Recommendation:** Use BM25 for articles, knowledge bases, help centers — anywhere ranking quality matters. Use TSVector when you need weighted multi-field search or already have tsvector columns from the metaschema system.

---

## When to Use BM25

- Document search where relevance quality matters (articles, knowledge bases, help centers)
- When you want better ranking than `ts_rank` without managing a separate tsvector column
- Content-heavy tables where document length varies significantly
- When you need a simpler setup (no trigger, no extra column — just an index on your text column)
