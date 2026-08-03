# Blocks runtime contract

Use this reference after selecting a registry item. The machine snapshot in
`install-roots.v1.json` remains authoritative for the pinned source, release
state, endpoints, first-party module bindings, pack manifests, preset profiles,
Console runtime, and source limitations. The complete catalog in
`registry-catalog.v1.json` pins the complete source registry, but its Data documentation
is retained only as drift evidence; validated queries apply
`registry.queryOverrides` before returning it.

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
view state. Query `--root feature-pack-{id}` for the exact component, install
target, props type, resource props, policy keys, action input vocabulary, and
controlled/default/local view-state ownership for the selected pack.

Standalone Data is the one exception because the view wraps Sheets. Its host
supplies a resolved endpoint and auth/session transport in `SheetsConfig`,
optionally through `SheetsExecuteFn`; Sheets internally loads current
`Query._meta` and standard GraphQL introspection before it builds table CRUD.
Data does not resolve Console semantic endpoints, own a
`ConstructiveTenantConsoleSession`, or have authority to choose cross-endpoint
fallbacks. The pinned standalone auth executor violates the last boundary when
`authEndpoint` is absent, so the portable contract requires a pre-render
configuration failure.

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

The backend `blank` preset intentionally has no frontend preset root. Start
from `console-kit-core` and select only the Console modules whose database
capabilities the host explicitly chose.

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
| Organizations | Memberships use `admin`/`Query.orgMemberships`, or a compatible `_meta` contract with a readable `contract.members` root found on an explicitly configured endpoint, confirmed by introspection, and proven executable |
| Storage | Named bucket/file roots and compatible storage `_meta` contracts use `storage`, `admin`, or `data` only; the selected endpoint must be confirmed by introspection |
| Billing | Plans, subscriptions, and meters use `billing` only |
| Notifications | Inbox uses `notifications` only; settings may be discovered but are unimplemented and must stay unavailable |

The machine `consoleModuleBindings` records exact required and optional
capabilities, candidate endpoint arrays, GraphQL coordinates, discovery source
hashes, adapter source hashes, and unbound optional capabilities. Use those
records when validating a ready state. In particular, the Billing and
Notifications manifest endpoint candidate lists are broader than their
first-party adapters; do not route either module through `admin`, `auth`, or
`data` based on manifest candidates.

The Organizations metadata alternative evaluates only endpoints that the host
explicitly configured. Storage evaluates only explicitly configured
`storage`, `admin`, or `data` endpoints because those are the endpoint kinds
its adapter can execute. Neither rule creates an implicit fallback or allows
the frontend to derive another host.

Readiness uses the adapter contract profiles returned by `--root`. A
`relay-forward-connection` root must accept `first: Int` or `Int!`, accept a
nullable `after: Cursor`, expose `nodes`, and expose `pageInfo.hasNextPage` plus
`pageInfo.endCursor`; `minimal-nodes-connection` requires `nodes` only. Every
root must also expose the exact adapter-selected node fields. Organizations
must satisfy one complete membership path group and one complete identity path
group, rather than accumulating unrelated partial evidence. Users and
Organizations actions remain disabled until the corresponding
`users-enabled-actions` or `organizations-enabled-actions` profile validates
the endpoint kind, declared input type, fixed payload path, and required
payload fields for that document tuple. Users actions all use `admin`.
Organizations uses `admin` for 17 documents and `auth` for `createUser`,
`updateUser`, `deleteUser`, `createOrgPrincipal`, `revokeOrgApiKey`, and
`deleteOrgPrincipal`. The `createUser` payload minimum is `id`, `type`, and
`username`; `displayName` is required in the nested input but optional in the
selected output, and `profilePicture` is optional output.

## Pinned source limitations

`sourceLimitations` is the machine-readable list of open Blocks source gaps.
Each record declares exact `surfaces`, `installRoots`, `featurePacks`, and
`runtimeModes`; filter by `appliesTo.installRoots` instead of guessing from
prose or treating every limitation as global. A `blocking` record fails only
the runtime modes named by that record. The list-root query reports each
mode's blockers and mitigations, exposes mode-limited records under
`conditionalBlockers`, and sets `runtimeStatus.unconditionallyBlocked` only
when a blocker is unconditional across every supported mode. There is no
top-level `blocked` alias. A `require-mitigation` record can
pass only when every named mitigation has evidence.

### Data limitations

| ID | Acceptance | Required handling | Mitigation IDs |
| --- | --- | --- | --- |
| `data-console-nested-sheets-store` | `blocking` | Data contributes no `storeSlice`, while `SheetsProvider` creates a nested Zustand store. Keep Console roots containing Data blocked until Blocks unifies that state. | `unify-data-console-store`, `contribute-data-store-slice` |
| `data-provider-global-locale-logger` | `require-mitigation` | `SheetsProvider` writes locale and logger configuration to process-wide mutable singletons. Mount at most one active provider per browser runtime until Blocks scopes both values through context. | `enforce-single-active-sheets-provider` |
| `data-standalone-auth-endpoint-fallback` | `require-mitigation` | Require an explicit non-empty `authEndpoint` and fail before render; never allow `config.authEndpoint || config.endpoint` to route auth through Data. | `require-explicit-auth-endpoint`, `fail-closed-without-auth-endpoint` |
| `data-standalone-database-scope-fallback` | `require-mitigation` | Require a non-empty `databaseId` equal to the active tenant; never share the source fallback scope named `default`. | `require-explicit-database-id`, `match-active-tenant-database-id` |
| `data-standalone-persistent-token-storage` | `blocking` | The source always writes successful standalone credentials to `localStorage`, regardless of `rememberMe`. Use embedded host auth until selectable non-persistent storage exists. | `use-host-owned-embedded-auth`, `block-until-token-persistence-is-selectable` |
| `data-standalone-csrf-auth-unavailable` | `blocking` | Sheets standalone auth has no anonymous CSRF bootstrap or header injection. Use embedded host auth when `require_csrf_for_auth` is enabled. | `use-host-auth-for-csrf-tenants`, `block-until-sheets-csrf-bootstrap-exists` |

### Cross-root capability limitations

| ID | Acceptance | Required handling | Mitigation IDs |
| --- | --- | --- | --- |
| `organizations-meta-membership-false-ready` | `require-mitigation` | An organizations-only `_meta` contract cannot prove memberships. Require `contract.members`, confirm its readable root by introspection, prove it executable, and independently prove the identity directory. | `require-meta-membership-root`, `prove-meta-membership-root-executable`, `prove-organization-identity-directory` |
| `storage-cross-endpoint-capability-false-ready` | `require-mitigation` | Prove buckets and files together on one `storage`, `admin`, or `data` endpoint through a paired root family or one compatible `_meta` family. Mixed-endpoint evidence is unavailable. | `restrict-storage-endpoint-kind`, `prove-storage-pair-on-one-endpoint`, `fail-storage-without-paired-evidence` |

### Adapter and surface limitations

| ID | Acceptance | Required handling | Mitigation IDs |
| --- | --- | --- | --- |
| `organizations-adapter-shape-false-ready` | `require-mitigation` | Validate one complete membership path and one identity path against the Relay connection profile, exact selected node fields, and every enabled action's endpoint, input, and payload. | `validate-organizations-connection-shapes`, `validate-meta-derived-organizations-shapes`, `validate-organization-action-payloads` |
| `storage-adapter-shape-false-ready` | `require-mitigation` | Validate both selected bucket and file roots against the Relay connection profile and their semantic fields. | `validate-storage-connection-shapes`, `fail-storage-on-adapter-shape-mismatch` |
| `auth-adapter-shape-false-ready` | `require-mitigation` | Validate every fixed SignIn, SignUp, SignOut, password, and `currentUser` argument, input type and field, payload selection, and selected MFA field. | `validate-auth-operation-shapes`, `fail-auth-on-adapter-shape-mismatch` |
| `users-adapter-shape-false-ready` | `require-mitigation` | Validate the users and app-membership Relay reads, exact node fields, and each enabled action's endpoint, input, and fixed payload object ending in `id`. | `validate-users-read-shapes`, `fail-users-on-adapter-shape-mismatch`, `validate-users-action-payloads` |
| `billing-adapter-shape-false-ready` | `require-mitigation` | Validate the minimal `nodes` connection envelope, node types, and every selected Plan and PlanSubscription field. | `validate-billing-read-shapes`, `fail-billing-on-adapter-shape-mismatch` |
| `notifications-adapter-shape-false-ready` | `require-mitigation` | Validate the minimal `nodes` connection envelope, Notification type, and every selected inbox field. | `validate-notifications-inbox-shape`, `fail-notifications-on-adapter-shape-mismatch` |
| `notifications-settings-discovered-unimplemented` | `require-mitigation` | Treat settings as discovered but unavailable. The current adapter and feature pack implement only inbox and read state; settings need both a resource adapter and a UI contract. | `hide-unimplemented-notification-settings`, `require-notification-settings-resource-and-surface` |

## Standalone Data host contract

`DataFeaturePack` accepts `config: SheetsConfig`. `endpoint` and `auth` are
required. Portable acceptance uses embedded mode: it gets the current
credential through a closure-owned `getToken`, should expose a stable
non-secret `getIdentityKey`, and may inject `execute` to keep the host's scoped
transport/session boundary. Pinned standalone mode remains blocked because it
always persists successful credentials in `localStorage`, does not make
`rememberMe` select non-persistent storage, and cannot bootstrap tenant CSRF.
If it is inspected during remediation, still require a non-empty
host-resolved `authEndpoint` and `databaseId` equal to the active tenant before
rendering; those checks prevent the separate endpoint and `default` scope
fallbacks but do not clear the blocking limitations.

This makes the root `conditionally-blocked`, not unconditionally blocked:
`embedded` requires the single-active-provider mitigation,
`standalone-auth` is blocked by persistent token storage, and
`standalone-auth-csrf-required` is blocked by persistent storage plus the
absent CSRF bootstrap. Every Data root requires the same provider-isolation
mitigation; Console roots containing Data remain unconditionally blocked by
the separate nested-store limitation.

The validated `--root feature-pack-data` response pins the import target and
`DataFeaturePackProps` vocabulary. `config` is required, Data has no injected
resource prop, `activeTable` is controlled by `onActiveTableChange`, and
`defaultActiveTable` seeds its uncontrolled state. The remaining local state
is the metadata request plus Sheets grid/editor state.

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

## Standalone prop and state contracts

The validated root response is the portable source for every standalone pack.
Its `propVocabulary` is exactly the ordered concatenation of `requiredProps`
and `optionalProps`; `deprecatedProps`, `propConstraints`, `resourceProps`, and
`configProps` preserve distinctions that a flat prop list loses. `viewState`
separates callback-controlled values, defaults, host resource state, host view
inputs, and component-local state.

- **Data:** `config` is required. `activeTable`, `defaultActiveTable`,
  `applicationScopes`, `includeTables`, `excludeTables`, `pageSize`,
  `onActiveTableChange`, `onCreateTable`, `onEvent`, and `sheetsProps` are
  optional. `activeTable` pairs with `onActiveTableChange`,
  `defaultActiveTable` seeds uncontrolled selection, and `pageSize` defaults to
  `50`. Metadata request and Sheets grid/editor state remain local.
- **Auth:** `view` is the required `entry` or `account` discriminator; it is not
  a resource prop. `account` is the optional resource. The remaining optional
  props are `notice`, deprecated `verificationNotice`, `mode`,
  `passwordPolicy`, `challengeContributions`, `policy`, `actions`,
  `onModeChange`, `onAuthenticated`, `accountSection`,
  `defaultAccountSection`, `onAccountSectionChange`, and `onError`. Entry mode
  defaults to `sign-in`; account section is controlled by
  `accountSection`/`onAccountSectionChange` or defaults to `profile` through
  `defaultAccountSection`. Credentials, challenge input, forms, dialogs,
  pending actions, and transient feedback remain local.
- **Users:** `resource` is required. `policy`, `actions`, `section`,
  `defaultSection`, `onSectionChange`, `focusedMemberId`,
  `focusedInvitationId`, `focusedProfileId`, `title`, `description`, and
  `onError` are optional. Section is controlled by `section`/`onSectionChange`
  or defaults to `members`; title defaults to `App access`. Focus IDs are host
  view inputs, while filters, dialogs, pending actions, and errors stay local.
- **Organizations:** `resource` is required. `policy`, `actions`, `section`,
  `defaultSection`, `onSectionChange`, `createOrganizationOpen`,
  `onCreateOrganizationOpenChange`, `focusedMemberId`,
  `focusedInvitationId`, `focusedProfileId`, `developerView`, and `onError` are
  optional. Section defaults to `members`, create-dialog openness defaults to
  false, and `developerView` defaults to `all`. The host may control section
  and create-dialog state; focus/developer inputs stay host-owned, while forms,
  filters, dialogs, pending actions, and errors remain local.
- **Storage:** `resource` is required; `policy`, `actions`, and `onError` are
  optional. There are no controlled view props. Active bucket and path are
  host resource state changed through semantic actions. Dialog, pending, and
  error state stays local, and new buckets default to private access.
- **Billing:** `account`, `resources`, and `formatOptions` are required.
  `actions`, `controls`, `onSectionChange`, `showHeader`, `messages`, `onError`,
  `onMessage`, `className`, `section`, and `defaultSection` are optional;
  `section` and `defaultSection` are mutually exclusive. `account` and
  `resources` are resource inputs, while `formatOptions` and `messages` are
  configuration. Section defaults to `overview`, `showHeader` defaults true,
  and pricing interval uses `defaultInterval` or the first available interval
  when uncontrolled. History and activity filters are host-controlled only;
  pagination lives in their resource/action boundary. Pending state, errors,
  uncontrolled section/pricing state, and selected activity detail stay local.
- **Notifications:** `resource` is required; `policy`, `actions`, and `onError`
  are optional. There are no controlled view props. The local filter defaults
  to `all`; dialogs, pending actions, and transient errors also remain local.

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
  type ConsoleKitFeatureModule,
  type ConstructiveTenantDatabase
} from '@/blocks/console-kit/console-kit-core';
import { dataConsoleModule } from '@/blocks/feature-packs/data/data-console-module';
import { storageConsoleModule } from '@/blocks/feature-packs/storage/storage-console-module';

const featureModules: readonly ConsoleKitFeatureModule[] = [
  dataConsoleModule,
  storageConsoleModule
];

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
under `metaContract`. `metaContract.requirements` contains the exact 27-alias
type-and-field map consumed by `META_CONTRACT_REQUIREMENTS`.
`metaContract.documents` also pins the runtime GraphQL strings: the
2,885-byte `META_QUERY_SOURCE` has SHA-256
`8b5b46f141f8303ffafac5fbb4f34103a363d8a0755d1fba16199bbf3b78f7ee`,
and the 1,949-byte generated `META_CONTRACT_INTROSPECTION_SOURCE` has SHA-256
`5a0aaeec9659cb0e6b43154f0db3fea6459a313f80feb67e87f3d1680985496a`.
Every Data-bearing validated query returns this complete contract.

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

## Verification profiles

Use `static-registry-install` for ordinary registry UI and billing items. It
verifies installed bytes and dependency closure, consumer typecheck and build,
plus visual/accessibility behavior when UI changed; it must not require tenant
endpoints, `_meta`, Auth acceptance, CRUD, or RLS evidence.

Use `tenant-runtime` for every standalone feature pack, Console module, preset,
core, and full Console root. It includes static installation checks, then adds
host endpoint/session checks, discovery evidence for surfaces that discover,
Auth lifecycle tests when Auth is present, and allowed plus denied CRUD/RLS
cases for data actions. A `blocking` source limitation fails this profile only
for the runtime modes in its `appliesTo.runtimeModes`; every applicable
`require-mitigation` record needs evidence for all of its stable mitigation
IDs.

## Pinned local consumption before release

This workflow is for the pinned branch-only source. It creates ignored build
artifacts in Blocks but must leave the worktree clean apart from those ignored
generated artifacts.

Every validated query marks `installability.publicInstall` as `blocked` and
`future-only` in this snapshot. Item and plan query surfaces also wrap the
canonical public command in a status-bearing `publicInstall` object; they never
expose a bare `installCommand`. Do not execute that wrapped command until its
status is `available`. Use only the pinned local workflow below before release.

Set explicit absolute paths and run the source preflight first. This mode
verifies the exact commit, a clean worktree apart from ignored generated
artifacts, canonical tracked-source hashes, package versions, and the source
patterns behind every open limitation without requiring the ignored aggregate
registry that a fresh checkout cannot contain:

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

git -C "$BLOCKS_REPO" status --short --untracked-files=all
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
