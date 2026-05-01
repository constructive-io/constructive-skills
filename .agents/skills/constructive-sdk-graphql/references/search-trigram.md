# Creating and Querying Trigram Fuzzy Search

Trigram-based fuzzy text matching using the `pg_trgm` extension. Provides typo tolerance, "did you mean?" suggestions, and fast `ILIKE` queries.

---

## Creating Trigram Search via SDK

Trigram indexes are created on existing text columns — no extra column needed.

### Step 1: Create a text field (if not already present)

```typescript
const titleField = await db.field.create({
  data: {
    databaseId,
    tableId: articlesTableId,
    name: 'title',
    type: 'text',
    isRequired: true,
  },
  select: { id: true, name: true },
}).execute();
```

### Step 2: Create a GIN trigram index

```typescript
const indexResult = await db.index.create({
  data: {
    databaseId,
    tableId: articlesTableId,
    name: 'idx_articles_title_trgm_gin',
    fieldIds: [titleField.data.createField.field.id],
    accessMethod: 'gin',
    opClasses: ['gin_trgm_ops'],
  },
  select: { id: true, name: true },
}).execute();

if (indexResult.ok) {
  console.log('Created trigram index:', indexResult.data.createIndex.index.name);
}
```

### GIN vs GiST for Trigrams

| | GIN | GiST |
|---|---|---|
| **Supports** | `%`, `LIKE`, `ILIKE`, regex | Same + KNN distance `<->` ordering |
| **Query speed** | Faster for containment/matching | Faster for nearest-neighbor |
| **Index size** | Larger | Smaller |
| **Use when** | Filtering (ILIKE, fuzzy WHERE) | Ordering by similarity |

**Recommendation:** Use GIN for most cases.

---

## Querying Trigram Search via SDK

### Trigram Similarity Search

On tables with search infrastructure, string columns get `similarTo` and `wordSimilarTo` operators:

```typescript
// similarTo: overall trigram similarity
const result = await db.article.findMany({
  where: {
    title: { similarTo: { value: 'postgre', threshold: 0.2 } },
  },
  first: 20,
  select: {
    id: true,
    title: true,
    titleTrgmSimilarity: true,  // 0..1, higher = more similar
  },
}).execute();
```

```typescript
// wordSimilarTo: best substring similarity (better for search)
const result = await db.article.findMany({
  where: {
    title: { wordSimilarTo: { value: 'postgres', threshold: 0.3 } },
  },
  orderBy: 'TITLE_TRGM_SIMILARITY_DESC',
  first: 10,
  select: {
    title: true,
    titleTrgmSimilarity: true,
  },
}).execute();
```

### Trgm Filter

```typescript
const result = await db.article.findMany({
  where: {
    trgmTitle: { value: 'postgre' },
  },
  orderBy: 'TITLE_TRGM_SIMILARITY_DESC',
  select: {
    title: true,
    titleTrgmSimilarity: true,
  },
}).execute();
```

### Fast ILIKE Search

The GIN trigram index accelerates `ILIKE` queries:

```typescript
const result = await db.article.findMany({
  where: {
    title: { likeInsensitive: '%postgres%' },
  },
  first: 20,
  select: { id: true, title: true },
}).execute();
```

### Prefix Autocomplete

```typescript
const result = await db.article.findMany({
  where: {
    title: { likeInsensitive: `${userInput}%` },
  },
  first: 5,
  select: { id: true, title: true },
}).execute();
```

### Combining Trigram with Other Filters

```typescript
const result = await db.article.findMany({
  where: {
    title: { similarTo: { value: 'kubernetes', threshold: 0.2 } },
    isPublished: { equalTo: true },
    category: { equalTo: 'devops' },
  },
  first: 20,
  select: {
    title: true,
    category: true,
    titleTrgmSimilarity: true,
  },
}).execute();
```

---

## Trigram + Other Search Strategies

Trigram is most useful as a complement to other search strategies.

### Composite unifiedSearch (Easiest)

The `unifiedSearch` filter automatically fans a text query to tsvector, BM25, and trgm simultaneously:

```typescript
const result = await db.article.findMany({
  where: {
    unifiedSearch: 'postgres tutorial',
  },
  orderBy: 'SEARCH_SCORE_DESC',
  select: {
    title: true,
    searchScore: true,
  },
}).execute();
```

### Fuzzy Fallback Pattern

Use BM25 or TSVector as primary search, fall back to trigram when few results:

```typescript
// Primary: BM25 search
const bm25Result = await db.document.findMany({
  where: {
    bm25Content: { query: userQuery },
  },
  orderBy: 'BM25_CONTENT_SCORE_ASC',
  first: 10,
  select: { id: true, title: true },
}).execute();

const bm25Docs = bm25Result.ok ? bm25Result.data.documents.nodes : [];

// Fallback: trigram similarTo if BM25 returned few results
if (bm25Docs.length < 3) {
  const fuzzyResult = await db.document.findMany({
    where: {
      title: { similarTo: { value: userQuery, threshold: 0.15 } },
    },
    orderBy: 'TITLE_TRGM_SIMILARITY_DESC',
    first: 10,
    select: { id: true, title: true, titleTrgmSimilarity: true },
  }).execute();
}
```

### Autocomplete Pipeline

Use trigram similarTo for search-as-you-type, then TSVector or BM25 for final results on submit:

```typescript
// Stage 1: Autocomplete (on every keystroke)
const autocomplete = await db.article.findMany({
  where: {
    title: { similarTo: { value: partialInput, threshold: 0.15 } },
  },
  orderBy: 'TITLE_TRGM_SIMILARITY_DESC',
  first: 5,
  select: { id: true, title: true, titleTrgmSimilarity: true },
}).execute();

// Stage 2: Full search (on form submit)
const search = await db.article.findMany({
  where: {
    fullTextSearchTsv: fullQuery,
  },
  orderBy: 'SEARCH_TSV_RANK_DESC',
  first: 20,
  select: { id: true, title: true },
}).execute();
```

---

## Trgm Scoping

Trigram only activates on tables where at least one "intentional search" infrastructure (tsvector or BM25) exists. This prevents similarity fields from appearing on every table with text columns.

- Table with tsvector column -> trgm activates
- Table with BM25 index -> trgm activates
- Table with only pgvector -> trgm does NOT activate
- Table with no search infrastructure -> trgm does NOT activate

To force trgm on a table without intentional search, use the `@trgmSearch` smart tag:

```sql
COMMENT ON TABLE app_public.contacts IS E'@trgmSearch';
```

---

## Field Naming Convention

| DB Column | Filter | Similarity Field | OrderBy |
|-----------|--------|------------------|---------|
| `title` | `trgmTitle` | `titleTrgmSimilarity` | `TITLE_TRGM_SIMILARITY_ASC/DESC` |
| `body` | `trgmBody` | `bodyTrgmSimilarity` | `BODY_TRGM_SIMILARITY_ASC/DESC` |

**Pattern:**
- Filter: `trgm` + camelCase(column name) — accepts `{ value, threshold? }` input
- Similarity: camelCase(column name) + `TrgmSimilarity`
- OrderBy: SCREAMING_SNAKE(column name) + `_TRGM_SIMILARITY_ASC` / `_TRGM_SIMILARITY_DESC`
- Connection filter: `similarTo` / `wordSimilarTo` on the column's `StringTrgmFilter`

The similarity is a `Float` in 0..1 range — higher = more similar. It is `null` when no trgm filter is active.

---

## When to Use Trigram

- Typo-tolerant search ("postgre" matches "PostgreSQL")
- Fast `ILIKE` queries on text columns (GIN index eliminates sequential scans)
- Autocomplete / search-as-you-type with similarity scoring
- "Did you mean?" suggestions
- As a fuzzy fallback alongside BM25 or TSVector
- Via `unifiedSearch` composite filter for automatic multi-strategy search
