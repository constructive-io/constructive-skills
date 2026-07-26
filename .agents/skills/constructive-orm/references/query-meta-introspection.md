# Current `_meta` contract

Constructive `_meta` describes database facts that standard GraphQL introspection cannot express directly: PostgreSQL scalar encodings, nullability and defaults, constraints, relations, exact Constructive inflection hints, feature smart tags, and application scope.

It is schema evidence, not an executable-schema or authorization grant.

## Canonical consumer

Use `@constructive-io/data` rather than maintaining a local query or handwritten response types:

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

The current contract version is `2026-07`. The package exports the complete field requirements, typed documents, compatibility assessment, scalar encodings, table types, row-identity analysis, and executable-schema compatibility helpers.

## Discovery sequence

1. Execute `META_CONTRACT_INTROSPECTION_DOCUMENT` against the explicit data endpoint.
2. Call `assertMetaContract` before sending the full metadata query.
3. Execute `META_DOCUMENT` and call `assertMetaQuery`.
4. Run standard GraphQL introspection against the same endpoint.
5. Reconcile `_meta` hints with the public roots, arguments, input objects, enums, filters, ordering, pagination, and mutation payloads introspection actually exposes.
6. Use authenticated reads and writes to establish the active identity's effective grants and RLS behavior.

Do not execute a name from `_meta.query` until it exists on the introspected public schema. A visible mutation root likewise does not prove that the current identity may execute it.

## What `_meta` owns

- table and schema identity;
- field PostgreSQL and GraphQL types, array/subtype information, and scalar encodings;
- non-null, default, primary-key, foreign-key, description, and enum metadata;
- indexes and primary, unique, and foreign-key constraints;
- belongs-to, has-one, has-many, and many-to-many relation metadata;
- Constructive inflection hints;
- storage, search, i18n, realtime, and scope tags.

## What introspection owns

- which query and mutation roots are executable at this endpoint;
- operation arguments and variable types;
- create, patch, filter, condition, ordering, connection, and payload shapes;
- enum input tokens and custom operations;
- available pagination styles.

## What runtime behavior owns

- whether the credential is valid for this tenant;
- which rows RLS makes visible;
- whether create, update, and delete are authorized;
- constraint and policy errors for the attempted values;
- token expiry, revocation, and identity transitions.

The Data feature pack implements this sequence for generic application CRUD. Custom domain UI should reuse the package contract and narrow presentation, rather than fork the discovery machinery.
