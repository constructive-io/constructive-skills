---
name: constructive-sdk-i18n
description: "Internationalization and multilingual search — DataI18n blueprint node for translation tables, SearchFullText composition with dynamic per-row language stemming (30+ languages out of the box), i18n_module for app-level language config, and the graphile-i18n plugin for Accept-Language negotiation. Use when asked to 'add translations', 'make fields translatable', 'multilingual search', 'i18n', 'DataI18n', 'i18n_module', 'lang_column', 'per-language stemming', 'tsvector multilingual', 'translation tables', 'locale strings', 'Accept-Language', or when working with i18n in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive i18n (SDK Guide)

Constructive provides multilingual support at every layer — from database schema to GraphQL API. Three pieces compose together:

- **`DataI18n`** — blueprint node. Creates a `{table}_translations` table with per-locale copies of translatable fields.
- **`SearchFullText` with `lang_column`** — tsvector full-text search where each row is stemmed in its own language. 30+ languages supported out of the box via PostgreSQL's built-in text search configurations.
- **`i18n_module`** — app-level config (`app_settings_i18n`) for default language, supported languages, and fallback chain.
- **`graphile-i18n`** — PostGraphile v5 plugin that adds `localeStrings` fields with Accept-Language negotiation.

Related skills:
- **`constructive-sdk-graphql`**: ORM queries, codegen, search patterns
- **`constructive-platform`**: Blueprint provisioning overview
- **`constructive-sdk-ai`**: SearchVector for semantic/embedding search on translations

---

## Multilingual Out of the Box

PostgreSQL ships with 30+ text search configurations. When you use `DataI18n` + `SearchFullText`, each translation row is stemmed in its own language automatically — no per-language config needed.

| Language | Config name | Example stemming |
|----------|-------------|-----------------|
| English | `english` | "running" → "run" |
| Spanish | `spanish` | "corriendo" → "corr" |
| French | `french` | "courant" → "cour" |
| German | `german` | "laufend" → "lauf" |
| Portuguese | `portuguese` | "correndo" → "corr" |
| Russian | `russian` | "бегущий" → "бег" |
| ... | ... | ... |

Full list: `simple`, `arabic`, `armenian`, `basque`, `catalan`, `danish`, `dutch`, `english`, `finnish`, `french`, `german`, `greek`, `hindi`, `hungarian`, `indonesian`, `irish`, `italian`, `lithuanian`, `nepali`, `norwegian`, `portuguese`, `romanian`, `russian`, `serbian`, `spanish`, `swedish`, `tamil`, `turkish`, `yiddish`.

Custom configs (e.g., `zhparser` for Chinese, `mecab` for Japanese) work too — once installed as PostgreSQL extensions, they become valid `regconfig` values.

---

## Blueprint Patterns

### Basic translatable fields

```ts
const blueprint = {
  tables: [{
    table_name: 'products',
    fields: [
      { name: 'name', type: { name: 'text' } },
      { name: 'description', type: { name: 'text' } },
      { name: 'price', type: { name: 'numeric' } },
    ],
    nodes: [
      'DataId', 'DataTimestamps', 'DataDirectOwner',
      {
        $type: 'DataI18n',
        data: { fields: ['name', 'description'] },
      },
    ],
  }],
  modules: ['i18n_module'],
};
```

This creates:
- `products` table with `name`, `description`, `price`
- `products_translations` table with `products_id` (FK), `lang_code`, `name`, `description`, unique on `(products_id, lang_code)`
- `@i18n products_translations` smart tag on the base table (enables the graphile-i18n plugin)

### With multilingual full-text search (recommended)

```ts
{
  $type: 'DataI18n',
  data: {
    fields: ['name', 'description'],
    search: {
      field_name: 'search',
      source_fields: [
        { field: 'name', weight: 'A' },
        { field: 'description', weight: 'B' },
      ],
    },
  },
}
```

When `search` is provided inside `DataI18n`:
- The tsvector `search` column is created on the **translations table** (not the base table)
- `lang_column` is automatically set to `'lang_code'` — each row is stemmed in its own language
- The trigger generates: `to_tsvector(NEW.lang_code::regconfig, COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.description, ''))`
- A GIN index is created for fast full-text queries

**How `lang_column` works:** Instead of a static language string (e.g., `'spanish'`), the tsvector trigger reads the language from the row's own `lang_code` column. Insert a row with `lang_code = 'spanish'` → Spanish stemmer. Insert with `lang_code = 'french'` → French stemmer. Each row gets stemmed in its own language automatically.

### Standalone SearchFullText with lang_column

You can also use `lang_column` independently on any table that has a language column:

```ts
{
  $type: 'SearchFullText',
  data: {
    field_name: 'search',
    lang_column: 'language',  // column name containing the regconfig value
    source_fields: [
      { field: 'title', weight: 'A' },
      { field: 'body', weight: 'B' },
    ],
  },
}
```

### Both base table and translations search

You can search both the base table (static language) and the translations table (dynamic per-row language):

```ts
nodes: [
  // Static English search on the base table
  {
    $type: 'SearchFullText',
    data: {
      field_name: 'search',
      source_fields: [
        { field: 'name', weight: 'A', lang: 'english' },
        { field: 'description', weight: 'B', lang: 'english' },
      ],
    },
  },
  // Dynamic per-language search on translations table
  {
    $type: 'DataI18n',
    data: {
      fields: ['name', 'description'],
      search: {
        field_name: 'search',
        source_fields: [
          { field: 'name', weight: 'A' },
          { field: 'description', weight: 'B' },
        ],
      },
    },
  },
]
```

---

## Querying Translations

### SQL — insert and search translations

```sql
-- Insert a Spanish translation
INSERT INTO app_public.products_translations
  (products_id, lang_code, name, description)
VALUES
  ($1, 'spanish', 'Zapatos para correr', 'Los mejores zapatos deportivos');

-- Search in Spanish (stems match: "corriendo" → "corr", same as "correr")
SELECT * FROM app_public.products_translations
WHERE lang_code = 'spanish'
  AND search @@ plainto_tsquery('spanish'::regconfig, 'corriendo');

-- Search across all languages
SELECT * FROM app_public.products_translations
WHERE search @@ plainto_tsquery(lang_code::regconfig, 'running shoes');
```

### ORM — query translations via parent relation

```ts
// From parent → translations
const product = await db.product.findFirst({
  where: { id: productId },
  select: {
    id: true,
    name: true,
    price: true,
    productTranslations: {
      select: { langCode: true, name: true, description: true }
    }
  }
});

// From translation → parent
const translation = await db.productTranslation.findFirst({
  where: { langCode: { equalTo: 'es' } },
  select: {
    langCode: true,
    name: true,
    product: {
      select: { id: true, price: true }
    }
  }
});
```

### GraphQL — localeStrings (via graphile-i18n plugin)

```graphql
query {
  allProducts {
    nodes {
      name           # base table value
      price
      localeStrings { # best-match translation
        langCode     # matched language (null = base fallback)
        name         # translated or base fallback
        description  # translated or base fallback
      }
    }
  }
}
```

The `localeStrings` field resolves the best translation for the request's `Accept-Language` header, falling back through the configured language chain.

---

## i18n Module Configuration

The `i18n_module` creates an `app_settings_i18n` singleton in `app_private` with admin-only RLS:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_language` | `text` | `'english'` | Default PostgreSQL text search config |
| `supported_languages` | `text[]` | `['en']` | ISO codes for supported UI languages |
| `fallback_chain` | `jsonb` | `{}` | Ordered fallback map (e.g., `{"pt-BR": ["pt", "en"]}`) |
| `is_enabled` | `boolean` | `true` | Kill switch for i18n features |

Install via blueprint `modules: ['i18n_module']`, the `full` preset, or `modules: ['all']`.

---

## graphile-i18n Plugin

The PostGraphile v5 plugin auto-discovers `@i18n` tagged tables and adds `localeStrings` fields. See [graphile-i18n README](https://github.com/constructive-io/constructive/tree/main/graphile/graphile-i18n) for full configuration.

```ts
import { I18nPreset, makeI18nContext } from 'graphile-i18n';

const preset = {
  extends: [I18nPreset()],
  grafast: {
    context: makeI18nContext({
      supportedLanguages: ['en', 'es', 'fr', 'de'],
    }),
  },
};
```

---

## Architecture Summary

```
Blueprint                    Database                         GraphQL
─────────                    ────────                         ───────
DataI18n node        →  {table}_translations table    →  {table}Translations collection
  + search param     →    + tsvector (lang_column)    →    + search field
                     →    + GIN index                 →

i18n_module          →  app_settings_i18n singleton   →  admin mutations

@i18n smart tag      →  (on base table)              →  localeStrings field
                                                         (Accept-Language negotiation)
```
