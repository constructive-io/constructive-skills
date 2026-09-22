# Compose an App Kit application

Read this when a brief describes a domain application rather than a platform
console. Resolve `installability.appKitDocumentation.authority` through the
validated App Kit catalog query before reading current APIs, exports, or
component contracts.

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

## Prepare and compose the consumer

1. Start with a valid consumer before invoking shadcn. Confirm `components.json`
   resolves every alias and its configured Tailwind stylesheet already exists;
   run all package and registry commands from that consumer root.
2. Treat installed roots as source dependencies, not finished features. Define
   the selected resources, queries, actions, and scope in application-owned
   code, then import the relevant controlled views or connected wrappers into
   real routes or surfaces.
3. Trace every requested job to an executable path. A link, heading, explanatory
   paragraph, empty placeholder, or installed-but-unimported source tree does
   not satisfy a collection, form, relation, board, dashboard, calendar, or
   workflow requirement.
4. Preserve the selected view's data contract. Server-driven search, filters,
   sorting, ranges, aggregates, and pagination must reach their query loaders;
   do not relabel client filtering of one fetched page as server-driven work.

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
