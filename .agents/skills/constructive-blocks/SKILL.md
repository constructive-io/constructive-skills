---
name: constructive-blocks
description: Select, install, compose, integrate, and verify the Constructive Blocks registry, App Kit, standalone platform feature packs, and Console Kit. Use when an agent builds an arbitrary Constructive-native internal app from typed resources, queries, actions, records, dashboards, boards, calendars, or workflows; when adding Constructive UI primitives, app shell, billing blocks, feature-pack views, Console modules, presets, or Console Kit; and when wiring tenant scope, final-schema evidence, release contracts, or RLS boundaries.
---

# Constructive Blocks

Use Blocks as the frontend source of truth. Backend presets select database
modules, registry roots install frontend source, Console capability discovery
proves a public GraphQL shape, and authenticated requests establish effective
PostgreSQL/RLS authority. Keep those as separate facts.

Choose between two orthogonal lanes. Use App Kit to compose an application
around domain resources and user tasks. Add feature packs or Console Kit only
when the product also needs their specific platform-capability surfaces.
Treat `installability.appKitDocumentation.authority` from the validated catalog
query as authority for exact APIs and exports; this skill owns selection and
verification procedure. While the release is branch-only, read the returned
`pinned-source` path from the source-preflighted Blocks checkout. Use the public
URL only when the query returns `kind: public-url`.

## Read the pinned contract first

[`references/install-roots.v1.json`](references/install-roots.v1.json) is the
portable authority for the exact Blocks branch and commit, release state,
`_meta` contract, endpoint bindings, package versions, source and built-content
hashes, the branch-aware App Kit documentation source, 19 complete inspector
plans, Console runtime invariants, and
structurally scoped source limitations. Use the validated
queries below for ordinary selection; load the full snapshot only when
auditing or updating the contract.

Query the validated catalog instead of loading its entire file when the request
concerns an ordinary registry item:

```bash
node /absolute/path/to/check-blocks-contract.mjs --list-registry
node /absolute/path/to/check-blocks-contract.mjs --list-registry --type registry:block
node /absolute/path/to/check-blocks-contract.mjs --list-registry --family app-kit
node /absolute/path/to/check-blocks-contract.mjs --list-registry --capability temporal
node /absolute/path/to/check-blocks-contract.mjs --registry-item app-shell
```

Use the returned `name`, `type`, `categories`, `docs`, and versioned metadata to
select candidates. Inspect one item before installation to verify its
dependencies, file targets, release status, and limitations.
For App Kit, also resolve the returned
`installability.appKitDocumentation.authority` before implementing an exact API.

Always use the validated queries for Data. The byte-pinned source catalog and
plan retain incorrect generic Data documentation as drift evidence; query
output replaces that field through `registry.queryOverrides`. Never quote or
implement `feature-pack-data` documentation by reading the raw catalog or plan
file directly.

Query Console roots and load only the selected complete plan:

```bash
node /absolute/path/to/check-blocks-contract.mjs --list-roots
node /absolute/path/to/check-blocks-contract.mjs --root preset-b2b-storage
```

The query returns a validated portable view of the byte-pinned plan with its
exact dependency closure, file targets, sidecars, corrected registry
documentation, runtime contract, and verification steps. Its
`portableContract` includes applicable first-party module bindings, referenced
adapter contract and action profiles, the exact standalone pack contract,
current Console store conformance, and `_meta` when Data is present. It also
returns every `sourceLimitations` record whose explicit install-root scope
matches the selection. Do not read the inspector v1 generic Data,
single-store, or Organizations-ready sentences in isolation.

Every standalone contract partitions its complete `propVocabulary` into
`requiredProps` and `optionalProps`, identifies deprecated and constrained
props, classifies resource and configuration inputs, and separates controlled,
defaulted, host-resource, host-view, and local state. Use that validated shape
instead of guessing from a component name or a generic feature-pack sentence.

The returned `metaContract` is executable evidence rather than a version
label: it contains the exact 27-alias type/field requirements plus SHA-256 and
byte-length attestations for `META_QUERY_SOURCE` and the generated contract
introspection query. Any alias, type, field, or document drift fails the
checker.

Every query returns an `installability` envelope. While
`publicRegistryReady` is false, `installability.publicInstall` and every
item-level `publicInstall` are `blocked` and `future-only`; use only the
envelope's exact pinned local workflow and command template in a disposable
consumer or isolated worktree with the frozen lockfile rule. List queries also
return the current `_meta` contract and mark each root with a `runtimeStatus`.
`unconditionallyBlocked` means a blocker applies in every supported mode;
`conditionalBlockers` names blockers limited to particular `modes`.
Standalone Data therefore keeps secure `embedded` eligible while its
standalone-auth modes are blocked, whereas Console roots containing Data remain
blocked by the nested-store limitation.

[`references/registry-catalog.v1.json`](references/registry-catalog.v1.json),
[`references/registry-content.v1.json`](references/registry-content.v1.json),
[`references/package-resolutions.v1.json`](references/package-resolutions.v1.json),
and [`references/install-plans.v1/`](references/install-plans.v1/) remain the
portable source artifacts behind these deterministic validated queries. The
content snapshot pins every file body reachable from the 19 Console plans and
all seven App Kit roots, so installed-source evidence cannot be satisfied by a
fabricated generated item.
The package snapshot pins the exact npm version, SRI, and canonical tarball URL
for every external dependency in those closures; first-party package bytes
remain pinned to the local Blocks artifacts.

Read
[`references/runtime-contract.md`](references/runtime-contract.md) when wiring
standalone Data, Console modules, tenant descriptors, sessions, routing,
capability evidence, or the host-owned Zustand store.

Read only the App Kit references required by the brief:

| Reference | Load when |
| --- | --- |
| [`references/app-composition.md`](references/app-composition.md) | Routing a domain application from intent and data shape |
| [`references/app-resource-contract.md`](references/app-resource-contract.md) | Defining scope, resources, queries, relations, and final-schema validation |
| [`references/app-view-patterns.md`](references/app-view-patterns.md) | Selecting controlled and connected data, board, dashboard, or calendar views |
| [`references/app-actions-workflows.md`](references/app-actions-workflows.md) | Defining semantic actions, invalidation, optimistic behavior, and steps |
| [`references/app-verification.md`](references/app-verification.md) | Verifying schema, cache isolation, authority, interaction, and installs |
| [`references/event-studio.md`](references/event-studio.md) | Building the complete Event Studio starter |
| [`references/event-studio-blueprint.json`](references/event-studio-blueprint.json) | Applying Event Studio's public org-scoped blueprint definition |
| [`references/app-recipes.md`](references/app-recipes.md) | Adapting compact cross-domain composition recipes |
| [`references/brief-to-roots.v1.json`](references/brief-to-roots.v1.json) | Auditing deterministic brief-to-root selection fixtures |

Validate the portable contract from any working directory:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs
```

A fresh pinned checkout does not contain the ignored aggregate registry. Verify
its exact commit, clean worktree apart from ignored generated artifacts,
canonical source hashes, and release metadata before generating anything:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --blocks-repo /absolute/path/to/blocks \
  --source-preflight
```

After the local workflow builds registry and package artifacts, verify every
source hash, every planned built-file content hash, and all 19 prebuilt plans:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --blocks-repo /absolute/path/to/blocks
```

The live check deliberately uses the inspector's `--no-build` mode only after
the aggregate registry, canonical inputs, catalog, and plan bytes match their
SHA-256 attestations. It never rebuilds or edits Blocks.

When advancing the pinned Blocks commit, first update the source pin and any
changed checker invariants as a reviewed source change. Then regenerate the
catalog, all inspector plans, built-content snapshot, package snapshot, and
their attestation hashes together from a clean exact checkout. The synchronizer
builds the registry, writes every result into a same-filesystem scratch area,
validates that staged contract against Blocks, and rolls back if replacement or
post-write validation fails:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/sync-blocks-contract.mjs \
  --blocks-repo /absolute/path/to/blocks
```

By default it preserves existing exact package resolution records, which keeps
pin advancement deterministic. Use `--refresh-package-resolutions` only for an
intentional dependency-refresh review; that flag resolves npm's current
`latest` releases, so review every version/SRI/URL diff and rerun the install
and typecheck matrix. `--check` stages and validates the complete result
without replacing checked-in files.

## Choose the smallest owning block

1. **Choose a lane.** Route domain resources and user tasks through App Kit.
   Route tenant-platform administration through feature packs or Console Kit.
   Treat an app that needs both as two explicit selections.
2. **Discover candidates.** Query `--list-registry --family app-kit` for the
   application lane or use the catalog/root queries for the platform lane.
   Match returned metadata and docs to the brief instead of inferring names.
   Exclude `kind: starter` from ordinary composition; install a starter only
   when the user explicitly requests that starter or its complete reference
   application. A deterministic fixture may select one only when its
   `starterRequested` marker records that explicit opt-in.
3. **Inspect closure.** Query each candidate item or Console plan and review
   transitive registry dependencies, files, runtime status, limitations, and
   installability before writing an install command.
4. **Check deterministic routing.** Compare arbitrary-app selection with
   `brief-to-roots.v1.json`. Query the selected preset plan when a backend
   preset must be mirrored; do not maintain the mapping in application code.
5. **Keep authority separate.** An install choice does not prove endpoint
   availability, executable roots, grants, or RLS-visible rows. Verify those
   after integration.

For App Kit, installation is only dependency acquisition. Application-owned
code must import and compose the selected definitions and views into working
user paths; installed source directories, navigation labels, prose, or empty
placeholders are never evidence that a capability was implemented.

Select Sheets only for spreadsheet-style inline editing and generic table
exploration. Do not substitute Console Kit for a domain application shell or
turn every action flow into a review queue.

## Respect the branch-only release gate

The pinned source is
`feat/app-kit@1a72e5d95f7ce4a243cd4536ed78c638708d538c`.
The checkout may be that named branch or detached at the exact commit. Its
publication status is `branch-only`, and
`release.publicRegistryReady` is `false`. Do not run a public install for these
new roots, substitute an older Dashboard registry, or silently select a
similarly named retired block.

Use the executable pinned local-consumption workflow in
[`references/runtime-contract.md`](references/runtime-contract.md) when an
install is required before release. It builds ignored registry/package
artifacts from the attested checkout, serves both local registries, and keeps
consumer configuration explicit. Public installation becomes valid only after
the machine snapshot is deliberately updated to a released commit with
`publicRegistryReady: true` and the checker passes against it.

For a released registry, preserve the consumer's existing shadcn aliases and
configure the canonical namespace:

```json
{
  "registries": {
    "@constructive": "https://constructive-io.github.io/blocks/r/{name}.json"
  }
}
```

Released query surfaces expose `publicInstall` with the command beside its
`status` and `availability`; execute it only when status is `available`.
Branch-only responses mark it `blocked` and `future-only`, so use the
`installability.pinnedLocalConsumption` command template instead. Keep shadcn
at the exact returned `testedShadcnVersion` for reproducible branch-local
diagnostics. Released public commands use `shadcn@latest`; nested dependencies
still require the `@constructive` namespace when a root is installed by direct
URL.

## Integrate the installed owner

For Auth, Users, Organizations, Storage, Billing, and Notifications standalone
packs, the host supplies resources, resource states, policy grants, semantic
actions, errors, and selection/view state. Those six views perform no endpoint,
`_meta`, introspection, session, or capability discovery.

Standalone Data is intentionally different. Its host supplies a resolved data
endpoint plus auth/session transport through `SheetsConfig`, optionally
injecting `SheetsExecuteFn` as `execute`; Sheets then loads `Query._meta` and
standard GraphQL introspection internally. Data does not own semantic endpoint
selection, Console endpoint fallback, or a
`ConstructiveTenantConsoleSession`. The top-level
`standaloneContracts.data` record supersedes the inspector v1 plan's generic
standalone discovery sentence for this one pack.

When `auth.mode` is `standalone`, require a non-empty host-resolved
`authEndpoint` and a `databaseId` equal to the active tenant before rendering.
The pinned source otherwise falls back to the data endpoint and the shared
`default` database scope. Standalone Sheets auth also always persists tokens
in `localStorage`, ignores `rememberMe` as a persistence choice, and cannot
bootstrap tenant CSRF. Use embedded host authentication for portable installs;
the `feature-pack-data` root is not unconditionally blocked because
`embedded` avoids those source paths. Its `standalone-auth` mode remains
blocked by credential persistence, and `standalone-auth-csrf-required` is also
blocked by the missing CSRF boundary until Blocks implements both.

For `console-kit-nextjs`, render `ConstructiveConsoleKit` from
`@/blocks/console-kit/constructive`. Pass a secret-free
`ConstructiveTenantDatabase` containing `id`, optional `name`, and explicit
semantic endpoints. Use the installed preset component for a preset root. For
a custom console, render `ConstructiveConsoleKitCore` with exactly the
installed feature modules and create one host-owned store with every module's
`storeSlice`. That is the target architecture, but the pinned Data module does
not yet satisfy it: `DataFeaturePack` mounts `SheetsProvider`, which creates a
second, nested Zustand store, and `dataConsoleModule` contributes no
`storeSlice`. Treat this as a source limitation to remove in Blocks, not a
pattern for new modules.

Keep deployment-specific endpoints and credentials out of installed source.
Never derive sibling hosts, invent private routing headers, send tenant
database operations through an operator endpoint, or store credentials in
Zustand.

## Prove static, capability, and authority layers

After installation:

1. **Select the verification profile.** Use `static-registry-install` for
   ordinary UI and billing registry items; it verifies bytes, dependency
   closure, typecheck, build, and relevant visual/accessibility behavior but
   never requires a tenant. Use `tenant-runtime` for every feature pack,
   Console module, preset, core, or full Console root.
2. **Verify installed bytes.** Confirm each selected pack wrote
   `.constructive/feature-packs/{id}.json`, plus the preset sidecar for a preset,
   then run the plan's exact static commands from the consumer root.
3. **Verify host configuration.** Resolve every semantic endpoint explicitly
   and require a host session's `databaseId` to equal the tenant descriptor.
4. **Verify public capability evidence.** Evaluate current `_meta` contract
   `2026-07`, standard GraphQL introspection, and the exact first-party module
   bindings in `consoleModuleBindings`. Billing uses only `billing`;
   Notifications uses only `notifications`, regardless of broader optional
   endpoint candidates in their manifests. The Organizations metadata
   alternative requires `contract.members`, its readable query root, and an
   executable introspected operation; an organization directory alone must not
   mark memberships ready.
5. **Verify authenticated behavior.** Exercise Auth sign-up, sign-in,
   persisted-session restoration, failure handling, and sign-out when Auth is
   installed. Supply `csrfTokenProvider` when the tenant requires CSRF.
6. **Verify RLS.** Exercise intended-role CRUD and denied anonymous, peer,
   revoked, and cross-tenant cases. A visible root or compatible schema does
   not prove write authority.

Report `ready`, `partial`, and `unavailable` packs independently. Preserve
working packs when another degrades, and keep unsupported controls hidden
instead of fabricating an action or broader authority.

## Recover without crossing boundaries

- A 404 root or missing package is a release failure; use the pinned local
  workflow or wait for release.
- A nested dependency failure usually means the consumer omitted the
  `@constructive` namespace.
- A missing semantic endpoint is host configuration; correct the explicit map
  rather than deriving another host.
- A database/session mismatch must remain a configuration error.
- Compatible `_meta` with a missing executable root requires
  introspection-led degradation; a runtime authorization rejection requires
  privilege/RLS diagnosis.
- An `objects` endpoint does not prove Storage table capability, and an
  installed notification backend module does not prove a public inbox.
- A Data standalone config without explicit `authEndpoint` is a configuration
  error; never allow Sheets to substitute the data endpoint for auth.
- An Organizations metadata contract without `contract.members` is
  unavailable for membership capability even though the pinned discovery
  module reports it supported.
- A host-owned store missing an installed module slice must be recreated with
  every contribution. Do not introduce another per-feature state system;
  Data's pinned nested Sheets store is a recorded source limitation.

Do not reintroduce generated SDK requirements, global clients,
`BlocksRuntime`, legacy flow IDs as install units, credentials in props or
Zustand, process-wide Console stores, or new per-pack Console state systems.
