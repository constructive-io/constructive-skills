# Blocks runtime contract

Use this reference after selecting a registry item. The machine snapshot in
`install-roots.v1.json` remains authoritative for the pinned source, release
state, endpoints, first-party module bindings, pack manifests, preset profiles,
and Console runtime. The complete catalog in `registry-catalog.v1.json` is
authoritative for all 102 registry items.

## Surface ownership

| Surface | Installs | Runtime owner |
| --- | --- | --- |
| `feature-pack-data` | Adapter-driven Sheets view and compatibility sidecar | Host supplies endpoint/session transport; Sheets owns `_meta`, introspection, and table CRUD |
| Six non-Data `feature-pack-{id}` roots | Provider-neutral view and compatibility sidecar | Host supplies the view contract |
| `console-module-{id}` | Core and standalone pack transitively, plus routing, discovery, adapter, and optional slice | Console Kit binds explicit Constructive endpoints and session evidence |
| `console-kit-core` | Shell, routes, discovery, session boundary, and modular store | Host supplies installed feature modules |
| `preset-{profile}` | Core and the exact modules in a stable backend profile | Installed preset component owns module composition |
| `console-kit-nextjs` | `preset-full` and the umbrella export | `ConstructiveConsoleKit` owns the seven-pack composition |

Auth, Users, Organizations, Storage, Billing, and Notifications standalone
packs perform no endpoint, metadata, introspection, session, or capability
discovery. Their hosts supply resources, states, policy, actions, errors, and
view state.

Standalone Data is the one exception because the view wraps Sheets. Its host
supplies a resolved endpoint and auth/session transport in `SheetsConfig`,
optionally through `SheetsExecuteFn`; Sheets internally loads current
`Query._meta` and standard GraphQL introspection before it builds table CRUD.
Data does not resolve Console semantic endpoints, own a
`ConstructiveTenantConsoleSession`, or choose cross-endpoint fallbacks.

The pinned inspector v1 emits one generic standalone discovery sentence for
all packs. `standaloneContracts.data.planFieldOverride` explicitly supersedes
that sentence for `feature-pack-data` while retaining the inspector's complete
byte-for-byte plan as source evidence.

Preset installs expose these components:

| Root | Component import |
| --- | --- |
| `preset-auth-hardened` | `AuthHardenedConsoleKit` from `@/blocks/presets/auth-hardened-console-kit` |
| `preset-b2b-storage` | `B2BStorageConsoleKit` from `@/blocks/presets/b2b-storage-console-kit` |
| `preset-full` | `FullConsoleKit` from `@/blocks/presets/full-console-kit` |
| `console-kit-nextjs` | `ConstructiveConsoleKit` from `@/blocks/console-kit/constructive` |

For a custom composition, import `ConstructiveConsoleKitCore` and the matching
`{id}ConsoleModule` exports. The installed modules are the module catalog; do
not create a parallel catalog.

## Tenant descriptor and endpoint map

Render the full console with a secret-free descriptor:

```tsx
'use client';

import {
  ConstructiveConsoleKit,
  type ConstructiveTenantDatabase
} from '@/blocks/console-kit/constructive';

const database: ConstructiveTenantDatabase = {
  id: 'tenant_database_id',
  name: 'Acme application',
  endpoints: {
    data: 'https://data.example.com/graphql',
    auth: 'https://auth.example.com/graphql',
    admin: 'https://admin.example.com/graphql'
  }
};

export function TenantConsole() {
  return (
    <ConstructiveConsoleKit
      database={database}
      showDiagnostics={process.env.NODE_ENV !== 'production'}
    />
  );
}
```

`ConstructiveTenantDatabase` requires `id` and `endpoints`; `name` is optional.
Each endpoint value is a URL string or `{ id?: string; url: string }`. The
semantic endpoint-to-Constructive API mapping is exact:

| Endpoint kind | Constructive API name |
| --- | --- |
| `data` | `api` |
| `auth` | `auth` |
| `admin` | `admin` |
| `billing` | `usage` |
| `storage` | `objects` |
| `notifications` | `notifications` |

These names describe host-provided routing metadata, so they do not authorize
URL derivation. Pass the public URLs returned by provisioning. Any fallback is
an explicit host policy because sending an operation through another semantic
endpoint can change its authorization boundary.

Never include bearer tokens, passwords, callback secrets, private routing
headers, or operator credentials in the tenant descriptor.

## First-party module endpoint bindings

A pack becomes `ready` only after every required capability has live evidence.
Endpoint presence identifies where to inspect; it does not prove a root,
executable operation, privilege, or RLS-visible row.

| Pack | Required first-party binding |
| --- | --- |
| Data | `data.meta` and `data.introspection` use `data`; evidence is current `Query._meta` plus standard introspection |
| Auth | Credentials, sessions, and password operations use `auth` |
| Users | `users.directory` uses `auth`; `users.memberships` uses `admin` |
| Organizations | Memberships use `admin`/`Query.orgMemberships`, or a compatible organization `_meta` contract found on any explicitly configured endpoint and confirmed by introspection |
| Storage | Named bucket/file roots use `storage`, `admin`, or `data`; a compatible storage `_meta` contract may be found on any explicitly configured endpoint and must be confirmed by introspection |
| Billing | Plans, subscriptions, and meters use `billing` only |
| Notifications | Inbox and settings use `notifications` only |

The machine `consoleModuleBindings` records exact required and optional
capabilities, candidate endpoint arrays, GraphQL coordinates, discovery source
hashes, adapter source hashes, and unbound optional capabilities. Use those
records when validating a ready state. In particular, the Billing and
Notifications manifest endpoint candidate lists are broader than their
first-party adapters; do not route either module through `admin`, `auth`, or
`data` based on manifest candidates.

Organization and Storage metadata alternatives evaluate only endpoints that
the host explicitly configured. This does not create an implicit fallback or
allow the frontend to derive another host.

## Standalone Data host contract

`DataFeaturePack` accepts `config: SheetsConfig`. `endpoint` and `auth` are
required. Embedded mode gets the current credential through a closure-owned
`getToken` and should expose a stable non-secret `getIdentityKey`. Standalone
mode needs a host-resolved `authEndpoint`. A host may inject `execute` to keep
its own scoped transport/session boundary:

```tsx
'use client';

import {
  DataFeaturePack
} from '@/blocks/feature-packs/data/data-feature-pack';
import type {
  SheetsConfig,
  SheetsExecuteFn
} from '@constructive-io/sheets';

type TenantSession = Readonly<{
  databaseId: string;
  identityId: string;
  getToken: () => string | null;
  execute: SheetsExecuteFn;
}>;

export function TenantData({
  dataEndpoint,
  session
}: Readonly<{
  dataEndpoint: string;
  session: TenantSession;
}>) {
  const config: SheetsConfig = {
    endpoint: dataEndpoint,
    databaseId: session.databaseId,
    auth: {
      mode: 'embedded',
      getToken: session.getToken,
      getIdentityKey: () => session.identityId
    },
    execute: session.execute
  };

  return <DataFeaturePack config={config} />;
}
```

The host chose `dataEndpoint` and owns `session`. The Data pack passes this
configuration to Sheets, whose default PostGraphile adapter verifies contract
version `2026-07`, fetches `Query._meta`, and cross-checks standard
introspection. An injected `execute` must apply the same tenant and identity
scope to metadata, row reads, and mutations.

## Session and credential boundary

When an `auth` endpoint is present and no host session is passed,
`ConstructiveConsoleKitCore` creates one database-scoped standalone session.
It supports password sign-up, sign-in, persisted restoration, sign-out, and
authentication-failure handling. Session storage is the default; local storage
is used only for an explicitly remembered session.

Without a routable `auth` endpoint, pass a host-owned session whose
`databaseId` equals `database.id`. A mismatch fails closed. Token retrieval
happens per request, so refresh cannot leave a stale token captured in an
adapter.

Pass `csrfTokenProvider` when the tenant enables
`require_csrf_for_auth`. It must create a fresh anonymous backend session and
return that session's exact CSRF secret.

By default, the browser wrapper parses supported callbacks, captures callback
credentials in a closure-owned vault, and scrubs the URL. Pass
`callback={false}` only when the host owns parsing, storage, scrubbing, and
redemption. Callback and session credentials belong in their credential
boundaries, never in props or Zustand.

## Console store and the current Data exception

The target architecture is one host-owned vanilla Zustand store per Console
Kit instance. Core contributes navigation, tenant context, session, endpoint
capability, discovery/runtime, and adapter slices. Feature modules may
contribute one `storeSlice`; Storage currently does.

The actual positional factory signature is:

```ts
createConsoleKitStore(
  initialRouteInput: ConsoleKitRoute | FeaturePackId,
  initialContext: ConsoleKitContext | null = null,
  sliceContributions: readonly ConsoleKitStoreSliceContribution[] = []
)
```

Use all installed modules to derive slices, create one store, and pass that
store plus the same modules to Core:

```tsx
'use client';

import * as React from 'react';

import {
  ConstructiveConsoleKitCore,
  createConsoleKitStore,
  type ConstructiveTenantDatabase
} from '@/blocks/console-kit/console-kit-core';
import { dataConsoleModule } from '@/blocks/feature-packs/data/data-console-module';
import { storageConsoleModule } from '@/blocks/feature-packs/storage/storage-console-module';

const featureModules = [
  dataConsoleModule,
  storageConsoleModule
] as const;

export function CustomTenantConsole({
  database
}: Readonly<{
  database: ConstructiveTenantDatabase;
}>) {
  const [store] = React.useState(() => {
    const slices = featureModules.flatMap((module) =>
      module.storeSlice ? [module.storeSlice] : []
    );
    return createConsoleKitStore(
      'data',
      {
        databaseId: database.id,
        organizationId: null
      },
      slices
    );
  });

  return (
    <ConstructiveConsoleKitCore
      database={database}
      featureModules={featureModules}
      store={store}
    />
  );
}
```

Console Kit rejects a host store missing a module contribution. A database or
identity change resets scoped core state, recreates module slices, and
invalidates stale action/getter closures. A same-scope adapter refresh
preserves module state.

The pinned Data source does not yet satisfy the target architecture.
`DataFeaturePack` mounts `SheetsProvider`; that provider calls
`createSheetsStore()`, while `dataConsoleModule` contributes no `storeSlice`.
A Console Kit instance containing Data therefore owns its Console store plus a
nested Sheets store. The machine contract hash-attests all three sources and
marks the inspector's generic `runtimeContract.state` field as superseded by
this current-source conformance record.

Do not create a process-wide store, put credentials in state, or introduce
another per-feature state system. Data's nested store is a Blocks source gap to
remove, not an architecture pattern to copy.

## Routing ownership

Use `routes.defaultRoute` for an initial uncontrolled route. When the host owns
navigation, provide `routes.route` and, as needed, `getHref`,
`onRouteChange`, and `renderLink`. Installed modules bound the valid route set;
capability discovery decides which installed routes are usable for the active
tenant.

Do not maintain parallel navigation state outside the controlled routing
interface.

## Metadata and authority evidence

The current `_meta` contract is `2026-07` at GraphQL coordinate
`Query._meta`. Its implementation and compatibility sources are SHA-256 pinned
under `metaContract`.

Evaluate evidence in this order:

1. **Explicit endpoint resolution.** A semantic endpoint must be present and
   reachable; never derive a sibling host.
2. **Current `_meta`.** Validate the contract signature, then use the payload
   for tables, fields, keys, relations, scopes, advisory inflection, and
   feature tags.
3. **Standard introspection.** Confirm exact public roots, types, inputs,
   filters, pagination, enums, and directives before constructing operations.
4. **Authenticated reads and writes.** Establish effective grants and row
   visibility for the active identity. PostgreSQL privileges and RLS remain
   authoritative.

Metadata states are `checking`, `compatible`, `incompatible`, and `error`.
Feature availability states are `checking`, `available`, `unavailable`,
`unauthorized`, `incompatible`, and `error`. Pack capability states are
`checking`, `ready`, `partial`, and `unavailable`.

Missing or ambiguous evidence fails closed. Keep independently proven packs
operational, hide unsupported controls, expose the degraded reason, and retry
after correcting the endpoint or session boundary.

## Pinned local consumption before release

This workflow is for the pinned branch-only source. It creates ignored build
artifacts in Blocks but must leave tracked source unchanged.

Set explicit absolute paths and run the tracked-source-only preflight first.
This mode verifies the exact commit, clean tracked worktree, canonical source
hashes, package versions, and the current Data store limitation without
requiring the ignored aggregate registry that a fresh checkout cannot contain:

```bash
export BLOCKS_REPO=/absolute/path/to/blocks
export SKILLS_REPO=/absolute/path/to/constructive-skills
export CONSUMER_REPO=/absolute/path/to/existing-shadcn-consumer

node "$SKILLS_REPO/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs" \
  --blocks-repo "$BLOCKS_REPO" \
  --source-preflight

pnpm --dir "$BLOCKS_REPO" install --frozen-lockfile
pnpm --dir "$BLOCKS_REPO" build:registry
pnpm --dir "$BLOCKS_REPO" pack:local

node "$SKILLS_REPO/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs" \
  --blocks-repo "$BLOCKS_REPO"

git -C "$BLOCKS_REPO" status --short --untracked-files=no
```

The full checker now verifies the generated aggregate registry and all 19
prebuilt inspector plans against the portable artifacts. The final Git command
must print nothing. Start the package registry in one terminal:

```bash
LOCAL_NPM_REGISTRY_PORT=4873 \
  pnpm --dir "$BLOCKS_REPO" local:registry
```

Start the generated block registry in another:

```bash
python3 -m http.server 4174 \
  --bind 127.0.0.1 \
  --directory "$BLOCKS_REPO/apps/registry/public"
```

The existing consumer must already contain `components.json`. Add this line to
its temporary `.npmrc`:

```ini
@constructive-io:registry=http://127.0.0.1:4873
```

Point only the Constructive namespace at the local block server while
preserving every existing alias:

```json
{
  "registries": {
    "@constructive": "http://127.0.0.1:4174/r/{name}.json"
  }
}
```

Install any catalog item with the pinned shadcn executable:

```bash
pnpm --dir "$BLOCKS_REPO/apps/registry" exec shadcn add \
  @constructive/app-shell \
  --cwd "$CONSUMER_REPO" \
  --yes

pnpm --dir "$BLOCKS_REPO/apps/registry" exec shadcn add \
  @constructive/preset-b2b-storage \
  --cwd "$CONSUMER_REPO" \
  --yes

pnpm --dir "$CONSUMER_REPO" exec tsc --noEmit
pnpm --dir "$CONSUMER_REPO" build
```

Use a disposable consumer or an isolated throwaway worktree. The local package
server necessarily writes localhost tarball resolutions, so never commit its
temporary `.npmrc` or lockfile. If the installed source will be retained, keep
it unmerged until the packages and block roots are public. After release,
remove both local registry settings, regenerate against public registries, and
reject every localhost reference before committing:

```bash
pnpm --dir "$CONSUMER_REPO" install --lockfile-only
rg -n '127\\.0\\.0\\.1|localhost' \
  "$CONSUMER_REPO/package.json" \
  "$CONSUMER_REPO/pnpm-lock.yaml"
```

The final command must return no matches. Before publication, discard the
temporary consumer lockfile instead of pretending it is release-ready.

Maintainers can exercise representative UI, billing, standalone Data, preset,
and full-console installs with the Blocks-owned smoke harness:

```bash
SMOKE_CASE=app-shell,billing-settings-page,feature-pack-data,preset-b2b-storage,console-kit-nextjs \
  pnpm --dir "$BLOCKS_REPO" \
  --filter @constructive-io/registry \
  smoke:install
```

## Verification record

Retain the selected registry item, pinned source commit, sidecars, secret-free
endpoint map, static checks, metadata compatibility, introspection evidence,
Auth lifecycle results when installed, intended-role CRUD, denied isolation
cases, and final state/reason for every installed pack.

Do not count a preset name, installed manifest, visible mutation root,
RLS-empty response, or metadata-compatible endpoint as proof of authority.
