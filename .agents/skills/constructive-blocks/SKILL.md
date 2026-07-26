---
name: constructive-blocks
description: Select, install, compose, integrate, and verify the complete Constructive Blocks registry, its standalone feature packs, and Console Kit. Use when adding Constructive UI primitives, app shell or app bar, billing blocks, standalone feature-pack views, Console modules, backend-aligned presets, a custom tenant console, or the full Next.js Console Kit; when wiring explicit tenant endpoints, sessions, _meta capability evidence, or modular Zustand state; and when diagnosing registry, release, capability, or RLS boundaries.
---

# Constructive Blocks

Use Blocks as the frontend source of truth. Backend presets select database
modules, registry roots install frontend source, Console capability discovery
proves a public GraphQL shape, and authenticated requests establish effective
PostgreSQL/RLS authority. Keep those as separate facts.

## Read the pinned contract first

[`references/install-roots.v1.json`](references/install-roots.v1.json) is the
portable authority for the exact Blocks branch and commit, release state,
`_meta` contract, endpoint bindings, package versions, source hashes, 19
complete inspector plans, and Console runtime invariants. Use the validated
queries below for ordinary selection; load the full snapshot only when
auditing or updating the contract.

Query the validated catalog instead of loading its entire file when the request
concerns an ordinary registry item:

```bash
node /absolute/path/to/check-blocks-contract.mjs --list-registry
node /absolute/path/to/check-blocks-contract.mjs --list-registry --type registry:block
node /absolute/path/to/check-blocks-contract.mjs --registry-item app-shell
```

The 102 entries cover the complete registry: Constructive theme and UI
primitives, app bar, app shell, billing blocks, standalone feature packs,
Console modules, presets, and the Next.js Console Kit. The six non-Data
standalone packs are provider-neutral; Data is adapter-driven and performs
schema discovery through Sheets. Select by `name`, `type`,
`categories`, and `docs`; inspect one item for its `dependencies`,
`devDependencies`, `registryDependencies`, and `files`.

Query Console roots and load only the selected complete plan:

```bash
node /absolute/path/to/check-blocks-contract.mjs --list-roots
node /absolute/path/to/check-blocks-contract.mjs --root preset-b2b-storage
```

The query returns the byte-pinned plan with its exact dependency closure, file
targets, sidecars, registry documentation, runtime contract, and verification
steps. Its `portableContract` also includes the applicable first-party module
bindings, the authoritative standalone correction for Data, and current
Console store conformance. Do not read the inspector v1 generic Data or
single-store sentences in isolation.

[`references/registry-catalog.v1.json`](references/registry-catalog.v1.json)
and [`references/install-plans.v1/`](references/install-plans.v1/) remain the
portable source artifacts behind these deterministic validated queries.

Read
[`references/runtime-contract.md`](references/runtime-contract.md) when wiring
standalone Data, Console modules, tenant descriptors, sessions, routing,
capability evidence, or the host-owned Zustand store.

Validate the portable contract from any working directory:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs
```

A fresh pinned checkout does not contain the ignored aggregate registry. Verify
its exact commit, clean tracked worktree, canonical source hashes, and release
metadata before generating anything:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --blocks-repo /absolute/path/to/blocks \
  --source-preflight
```

After the local workflow builds registry and package artifacts, verify every
source hash and all 19 prebuilt plans:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --blocks-repo /absolute/path/to/blocks
```

The live check deliberately uses the inspector's `--no-build` mode only after
the aggregate registry, canonical inputs, catalog, and plan bytes match their
SHA-256 attestations. It never rebuilds or edits Blocks.

## Choose the smallest owning block

For ordinary application UI, choose directly from the complete registry
catalog. `app-shell` installs the provider-neutral shell and `app-bar`
transitively; individual billing roots install only their reviewed dependency
closure; primitives remain independently installable.

For feature behavior, choose one ownership boundary:

| Need | Install root |
| --- | --- |
| Host-controlled application view | `feature-pack-{id}` |
| Shell/runtime without a leaf feature | `console-kit-core` |
| Custom tenant console | Selected `console-module-{id}` roots |
| Stable backend-aligned composition | `preset-auth-hardened`, `preset-b2b-storage`, or `preset-full` |
| Complete seven-pack Next.js console | `console-kit-nextjs` |

The seven pack IDs are `data`, `auth`, `users`, `organizations`, `storage`,
`billing`, and `notifications`. A standalone pack never installs Console Kit
and never imposes the Console Kit Zustand store. A matching Console module
installs its standalone view and Console core transitively, then contributes
Constructive discovery, routing, an adapter, and any module-owned state slice.

Map official backend presets exactly:

- `auth:hardened` -> `preset-auth-hardened` -> Data, Auth, Users.
- `b2b:storage` -> `preset-b2b-storage` -> Data, Auth, Users, Organizations,
  Storage.
- `full` -> `preset-full` -> all seven packs.

This mapping selects installed code. It does not prove that a tenant exposes
the necessary endpoints, roots, metadata, privileges, or RLS-visible rows.

## Respect the branch-only release gate

The pinned source is
`feat/feature-packs-console-kit@4f2a789fde9a90c0c6ed5977896493bb4818fa77`.
Its publication status is `branch-only`, and
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

Use the exact `installCommand` in the catalog or selected plan. Keep shadcn at
`4.13.1`; nested dependencies still require the `@constructive` namespace when
the root is installed by direct URL.

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

1. **Verify installed bytes.** Confirm each selected pack wrote
   `.constructive/feature-packs/{id}.json`, plus the preset sidecar for a preset,
   then run the plan's exact static commands from the consumer root.
2. **Verify host configuration.** Resolve every semantic endpoint explicitly
   and require a host session's `databaseId` to equal the tenant descriptor.
3. **Verify public capability evidence.** Evaluate current `_meta` contract
   `2026-07`, standard GraphQL introspection, and the exact first-party module
   bindings in `consoleModuleBindings`. Billing uses only `billing`;
   Notifications uses only `notifications`, regardless of broader optional
   endpoint candidates in their manifests.
4. **Verify authenticated behavior.** Exercise Auth sign-up, sign-in,
   persisted-session restoration, failure handling, and sign-out when Auth is
   installed. Supply `csrfTokenProvider` when the tenant requires CSRF.
5. **Verify RLS.** Exercise intended-role CRUD and denied anonymous, peer,
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
- A host-owned store missing an installed module slice must be recreated with
  every contribution. Do not introduce another per-feature state system;
  Data's pinned nested Sheets store is a recorded source limitation.

Do not reintroduce generated SDK requirements, global clients,
`BlocksRuntime`, legacy flow IDs as install units, credentials in props or
Zustand, process-wide Console stores, or new per-pack Console state systems.
