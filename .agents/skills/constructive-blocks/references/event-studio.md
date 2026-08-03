# Build the Event Studio starter

Read this only for the complete Event Studio recipe. Use the
[canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for its current UI exports and integration contract.

## Provision the paired domain

1. Select the supported `b2b` preset through the normal backend
   provisioning flow. Keep preset selection separate from frontend install.
2. Apply `event-studio-blueprint.json` through the public blueprint SDK/ORM
   workflow. Do not translate it into raw SQL or edit backend repositories.
3. Confirm that the resulting final schema exposes org-scoped `programs`,
   `sessions`, `people`, `venues`, and explicit `session_people` records.
4. Verify member read/create/update and denied member delete. Verify delete for
   org admins and owners, then repeat the denial across organizations.

The fixture uses `org_id` membership, text statuses, `text[]` session tags,
generated record identities, and a unique session/person link pair. Grants let
PostgreSQL evaluate delete while RLS reserves it for admins and owners. Keep
these as database authority rather than client-side policy.

## Compose and connect the starter

1. Select the starter only from the explicit `event-studio-opt-in` brief fixture and
   inspect its catalog dependency closure.
2. Implement the host adapter against the generated final GraphQL surface; do
   not copy illustrative root names.
3. Back metrics with analytical loaders, collections and relation search with
   server queries, the board with a semantic move action, and calendar views
   with explicit range/timezone input.
4. Wire publish, schedule, status, link, and unlink intents with permission
   errors and targeted invalidation.
5. Keep view, filters, selection, and range URL-addressable through the chosen
   host navigation adapter.

Run the App Kit verification loop, then add Event Studio's denied member
delete, unique relation, direct URL restoration, production Next.js build, and
hydration cases. The V1 recipe contains no realtime, recurrence, raw SQL, or
durable workflow behavior.
