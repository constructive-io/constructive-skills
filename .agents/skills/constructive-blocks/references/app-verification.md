# Verify an App Kit application

Read this before declaring an App Kit build complete. Use the
[canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for the current runtime and accessibility contracts, and use the checker for
the pinned install contract.

## Run the evidence loop

1. Reconcile `_meta` with final introspection. Cover inflected roots, enums,
   arrays, JSON, custom scalars, composite and absent identities, relations,
   absent operations, and custom roots.
2. Vary every documented cache-scope dimension independently. Cancel slow work
   during a scope switch and prove cached or optimistic data cannot cross it.
3. Exercise validation, confirmation, cancellation, duplicate submission,
   partial GraphQL errors, denials, rollback, and targeted cross-view
   invalidation.
4. Exercise intended member behavior plus anonymous, peer, revoked, cross-org,
   and destructive member denials. Verify admin/owner destruction only where
   the database policy permits it.
5. Test keyboard board movement, focus restoration, reduced motion, chart
   accessibility, calendar locale/timezone behavior, responsive fallbacks, and
   distinct loading, empty, denied, and error presentation.
6. Install each selected root independently under default and custom aliases.
   Reject hidden dependencies on Constructive UI packages, Sheets, Console Kit,
   or an unselected App Kit family.
7. Build and hydrate a real Next.js App Router consumer for page-scale
   starters.

Discover and narrow candidates before installation:

```bash
node /absolute/path/to/check-blocks-contract.mjs --list-registry --family app-kit
node /absolute/path/to/check-blocks-contract.mjs --list-registry --capability temporal
```

Do not equate registry generation, schema compatibility, or a visible row with
runtime qualification; report each evidence layer separately.
