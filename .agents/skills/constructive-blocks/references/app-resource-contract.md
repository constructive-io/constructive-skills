# Generate App Kit resource contracts

Read this before generating resources, queries, forms, or relations. Use the
[canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for exact types, signatures, entrypoints, and supported field kinds.

## Build from executable evidence

1. Fetch current `_meta` facts and final GraphQL introspection from the same
   tenant/schema revision. Refresh a selected generated SDK or ORM first.
2. Inventory each resource's stable identity, display fields, editable fields,
   relations, executable reads, executable writes, and semantic actions.
3. Map final inflected GraphQL names rather than deriving them from PostgreSQL
   names. Record missing operations explicitly.
4. Implement definitions with the documented server-safe entrypoint and inject
   abortable loaders from the host transport.
5. Run the documented resource validator during generation or build. Fail on
   mismatched names, identities, relations, enum values, or operation roots.
6. Typecheck definitions and exercise one allowed and one denied operation
   against the intended identity before building views.

## Degrade deliberately

- Make ambiguous, missing, or mismatched identities read-only. Never guess an
  ID, including for composite keys.
- Keep absent mutations absent. A database field name does not prove a final
  GraphQL operation exists.
- Keep JSON, unknown custom scalars, and unsupported shapes read-only until the
  host supplies a renderer or editor supported by the current Blocks contract.
- Search relation candidates on the server and link existing records through
  semantic actions. Avoid nested multi-record creation in V1.

## Audit remote-state scope

Follow the canonical scope and query-key contract exactly. Change endpoint,
database, authenticated session partition, organization/tenant, and schema or
security revision independently, then prove cached, cancelled, and optimistic
data cannot cross any partition. Never place credentials in definitions,
URLs, cache keys, or stores.
