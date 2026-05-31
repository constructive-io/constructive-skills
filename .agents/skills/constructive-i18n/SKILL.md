---
name: constructive-i18n
description: "Internationalization — DataI18n translation tables, multilingual tsvector search with per-row language stemming (30+ languages), i18n_module for app-level language config, lang_column dynamic stemming, and graphile-i18n plugin for Accept-Language negotiation. Use when asked to 'add translations', 'make fields translatable', 'multilingual search', 'i18n', 'DataI18n', 'i18n_module', 'lang_column', 'per-language stemming', 'translation tables', 'locale strings', 'Accept-Language', or when working with i18n in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive i18n

Multilingual support at every layer — from database schema to GraphQL API. Three pieces compose together:

- **`DataI18n`** — blueprint node creating `{table}_translations` with per-locale copies of translatable fields
- **`SearchFullText` with `lang_column`** — tsvector search where each row is stemmed in its own language (30+ languages via PostgreSQL built-in configs)
- **`i18n_module`** — app-level config for default language, supported languages, and fallback chain
- **`graphile-i18n`** — PostGraphile v5 plugin adding `localeStrings` with Accept-Language negotiation

## When to Apply

Use this skill when:
- Making fields translatable with DataI18n
- Adding multilingual full-text search
- Configuring app-level language settings
- Working with Accept-Language content negotiation
- Setting up per-row language stemming for tsvector

## DataI18n Blueprint Node

```json
{
  "tables": [{
    "table_name": "articles",
    "nodes": [
      "DataId", "DataTimestamps",
      { "$type": "DataI18n", "data": {
        "fields": ["title", "description"],
        "languages": ["en", "es", "fr", "de"]
      }}
    ],
    "fields": [
      { "name": "title", "type": { "name": "text" }, "is_required": true },
      { "name": "description", "type": { "name": "text" } }
    ]
  }]
}
```

Creates `articles_translations` table with `language`, `title`, `description` columns per locale.

## Multilingual Search

Compose `DataI18n` with `SearchFullText` using `lang_column` for per-row stemming:

```json
{ "$type": "SearchFullText", "data": {
  "field_name": "search_tsv",
  "lang_column": "language",
  "source_fields": [
    { "field": "title", "weight": "A" },
    { "field": "description", "weight": "B" }
  ]
}}
```

30+ languages supported out of the box via PostgreSQL text search configurations (english, spanish, french, german, japanese, etc.).

## i18n Module

Provisions `app_settings_i18n` singleton with:
- `default_language` — fallback language
- `supported_languages` — array of enabled locales
- `fallback_chain` — ordered fallback for missing translations

## graphile-i18n Plugin

Adds `localeStrings` computed field to GraphQL types with `Accept-Language` header negotiation. Returns translations in the requested locale with automatic fallback.

## Cross-References

- **Search strategies:** [`constructive-search`](../constructive-search/SKILL.md)
- **Blueprint definitions:** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **ORM query patterns:** [`constructive-orm`](../constructive-orm/SKILL.md)
