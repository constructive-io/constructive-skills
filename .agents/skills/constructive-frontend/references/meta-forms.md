# Custom metadata-driven domain UI

Use the Data feature pack for a generic table explorer or spreadsheet CRUD experience. It already owns the current `_meta` contract, executable-schema reconciliation, row identity, pagination, mutation generation, and RLS-aware failure states.

Build a custom metadata-driven surface only when the product needs domain-specific presentation or workflow that the Data pack should not own.

## Current contract

`@constructive-io/data` is the canonical consumer of Constructive `_meta` contract `2026-07`. Import its documents, types, and guards instead of copying a GraphQL selection into application code:

```ts
import {
  META_CONTRACT_INTROSPECTION_DOCUMENT,
  META_CONTRACT_VERSION,
  META_DOCUMENT,
  assertMetaContract,
  assertMetaQuery,
  type MetaQuery
} from '@constructive-io/data';
```

Run the contract introspection document first, call `assertMetaContract`, then execute `META_DOCUMENT` and call `assertMetaQuery`. This fails with a structured compatibility error when the endpoint lacks the required contract instead of continuing with partial metadata.

The current table model includes schema and query names, field encodings, indexes, grouped and compatibility constraint shapes, relation families, storage/search/i18n/realtime tags, and scope metadata. Import the package types so new contract fields and compatibility behavior arrive through normal dependency updates.

## Evidence order

1. Use the explicit semantic endpoint supplied by the tenant descriptor. Never derive a sibling hostname.
2. Use `_meta` for PostgreSQL and Constructive schema facts: nullability, defaults, constraints, relations, encodings, feature tags, and scope.
3. Use standard GraphQL introspection for the exact public query and mutation roots, arguments, input objects, enum values, filters, orderings, and pagination.
4. Reconcile both sources before building an operation. `_meta.query` values are advisory until confirmed against introspection.
5. Use authenticated reads and mutations to establish the active identity's effective grants and RLS behavior.

Neither `_meta` nor introspection grants frontend authority. Do not expose a mutation because its name appears in metadata, and do not bypass an RLS-empty result with an admin or operator endpoint.

## Form rules

- A field is required for create when it is non-null and has no server default, after confirming the create input through introspection.
- Use metadata scalar encodings for bigint, datetime, date, time, interval, UUID, spatial, vector, bytea, array, and composite values; do not infer solely from `pgType` strings.
- Resolve primary or unique row identity through the data runtime. Ambiguous or absent identity makes update and delete unavailable.
- Confirm relations through both `_meta` and the executable schema before showing record pickers or nested actions.
- Filter application data by current scope metadata rather than a hard-coded table allowlist.
- Cache metadata by endpoint and database identity, and invalidate it when either changes.

## Runtime boundary

Pass an endpoint-scoped request function or adapter into the custom view. Keep bearer tokens inside the host session boundary, outside props and Zustand. Abort in-flight work and clear identity-scoped caches when the database or signed-in identity changes.

Generated ORM and React Query clients are optional for stable custom-domain schemas. They are not a prerequisite for `_meta` forms, feature packs, or Console Kit.

See [`constructive-blocks`](../../constructive-blocks/SKILL.md) for the Data feature pack and Console module, and [`constructive-orm`](../../constructive-orm/SKILL.md) for the lower-level current `_meta` reference.
