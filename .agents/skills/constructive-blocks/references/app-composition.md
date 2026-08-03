# Compose an App Kit application

Read this when a brief describes a domain application rather than a platform
console. Use the [canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for current APIs, exports, and component contracts.

## Route the brief

1. Extract the user's jobs, record shapes, relations, aggregate questions,
   time ranges, semantic actions, and preferred navigation. Do not route from a
   department label.
2. Query the validated catalog with `--list-registry --family app-kit`. Match
   the returned `dataShapes`, `intents`, and `capabilities` to the brief, then
   inspect each candidate's dependency closure. Add only roots supported by
   this evidence. Exclude `kind: starter` unless the user explicitly asks for
   that starter or its complete reference application; starters are examples,
   not default capability bundles. Set `starterRequested: true` only in a
   deterministic fixture that records that explicit request.
3. Compare the choice with `brief-to-roots.v1.json`. Treat the fixture as a
   regression oracle for selection behavior, not a substitute for the current
   catalog.
4. Plan optional platform capabilities separately. Add Sheets only for genuine
   spreadsheet interaction and Console surfaces only for tenant-platform
   administration.
5. Decide how the host owns routes, URL state, and record opening. A route,
   page, dialog, or Stack card may be appropriate; do not impose Stack.

## Establish ownership before coding

- Keep remote state in App Kit's documented TanStack Query boundary and keep
  cache scope secret-free.
- Keep shareable view state controlled or URL-addressable, and keep transient
  interaction state local.
- Inject the Constructive transport from the host. Do not add runtime schema
  discovery, a connector runtime, or another global store.
- Treat grants and RLS as authority. Visibility and disabled-state rules only
  improve presentation.
- Use action invalidation, manual refresh, and documented focus/reconnect
  behavior for freshness; do not add V1 subscriptions or interval polling.

Next, read the resource, view, action, or verification reference only when that
part of the brief is active.
