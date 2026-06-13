# Binding Doctrine

Condensation of the canonical **SDK Binding Contract** for in-skill use. Where any older blocks doc disagrees about data fetching, hooks, clients, providers, or endpoints, this wins. It supersedes the `@constructive-io/data` hybrid, the `<ConstructiveProvider>` model, and any pinned-SDK frame.

## 0. The doctrine

A block binds to the **per-application generated SDK** — the namespaced TypeScript client the *host app* produces with `@constructive-io/graphql-codegen` from *its own* PostGraphile endpoints — **not** to any pinned, hand-written, or pre-published SDK package. It imports generated **React Query hooks** from a convention path (`@/generated/<namespace>`) the host has aliased to its generated output. The block ships no network code of its own.

## 1. Why per-app, not pinned

A Constructive app's GraphQL surface is **dynamic** — a function of which pgpm modules are deployed, the app's `api_schemas` config, and `database_settings` flags. Two apps almost never expose the same operations, types, or field sets. A block pinned to one frozen `.d.ts` is correct for exactly one app and silently wrong for every other (the prior build's failure mode: guessed op names, wrong arg wrappers, wrong payload shapes). Codegen against the host's *live* endpoints encodes the exact operation kind, input shape, payload wrapper, and field names — a block written against the generated signatures is correct by construction.

## 2. Namespaces

Codegen emits one SDK per registered API (a row in `services_public.apis`; its `api_schemas` list the PostgreSQL schemas it exposes; each is reachable at its own subdomain). The four standard namespaces:

| Namespace | Subdomain | Schema set (current) |
|---|---|---|
| `auth` | `auth.` | `constructive_auth_public` + `users_public` + `user_identifiers_public` + `logging_public` |
| `admin` | `admin.` | `memberships_public` + `permissions_public` + `limits_public` + `invites_public` + `status_public` |
| `objects` | `objects.` | `object_store_public` + `object_tree_public` |
| `public` | `api.` | nearly all of the above combined |

**Routing blocks to a namespace:**

- Auth flows (sign-in, password, email/MFA, account, identity) → `auth`.
- Membership / invite / role / permission / limit / status → `admin`. (Invite *acceptance* mutations `submitAppInviteCode` / `submitOrgInviteCode` live in `invites_public`, reachable via `admin` or `public`.)
- File/object blocks → `objects`.
- A block needing ops from more than one schema set targets `public`, **or** imports from two namespaces. Prefer a single namespace per block; document any cross-namespace block in `requires.json` with multiple entries. The list is not closed — an app may register custom APIs.

## 3. Import convention (locked v1)

```tsx
'use client';
import { useSignInMutation } from '@/generated/auth';
import { useOrganizationMembersQuery } from '@/generated/admin';
```

A block **never** imports from a versioned SDK package name, never hardcodes a path like `src/graphql/auth-sdk/api`, and never writes its own `fetch`, GraphQL document, or client bootstrap.

> **Why a convention path, not an injected client?** Generated hooks are hard-bound to a module-level singleton (`getClient()`) — there is no `client` parameter on any hook. The only way a block and the host share one configured client is to import the *same generated module*. The `@/generated/<ns>` alias makes "the same module" a stable, app-agnostic name a block compiles against.

## 4. The override seam (portability)

The default path is the generated hook. Every block also accepts `onSubmit` (mutations) / `adapter` (queries) that **fully replaces** the network call, so the block stays usable on a non-Constructive backend. The block still owns form state, validation, error mapping, and notifications regardless. This is the one soft point in the binding; everything else here is the canonical path.

## 5. Generated hook anatomy

**Naming** (confirmed against real codegen output):

- Custom operations → `use<PascalOp>Mutation` (e.g. `useSignInMutation`, `useRequireStepUpMutation`). The previous plan assumed `useSignIn`; the real name is `useSignInMutation`.
- Table reads → `use<Plural>Query` / `use<Singular>Query` (e.g. `useUsersQuery`, `useUserQuery`).
- Table writes → `useCreate<Name>Mutation` / `useUpdate<Name>Mutation` / `useDelete<Name>Mutation`.

**React Query.** Every hook calls `useMutation`/`useQuery` and needs a `QueryClient` in the tree (the runtime supplies it). Each takes a `selection` field-picker plus standard React Query options:

```tsx
const signIn = useSignInMutation({
  selection: { fields: { result: { select: { userId: true, mfaRequired: true } } } },
  onSuccess: (data) => { /* data.signIn... */ },
});
await signIn.mutateAsync({ email, password, rememberMe });
```

**Per-namespace singleton.** Each SDK ships its own `configure(config)` / `getClient()` backed by a module-level instance. `configure()` must run **once per namespace** (auth and admin are separate singletons). There is **no** `client` prop on any hook. `OrmClientConfig = { endpoint?, headers?, fetch?, adapter?, realtime? }` — there is **no token-storage property**; auth is attached via `headers`/`fetch`/`adapter` (the runtime uses a `getToken`-driven adapter).

**Model accessor exists iff a `*Connection` type exists.** Codegen infers a table model accessor (`.findMany()` + the `use<Plural>Query` hook) only when the SDL has a `*Connection` object type for that table. Tables exposed only as private-schema views get no accessor and no list hook — only their explicit mutations.

**Op-shape branching** (how a block calls a hook):

- scalar / Connection return → flat-arg, no `select`, raw return.
- object payload return → `{ input }` + `{ select }`, read `.result`.
- table CRUD → `{ where, data }` with a `*Patch` data type (gated on a valid PK).

Always verify the real signature in the generated `.d.ts` / hook file — never guess.

## 6. The runtime block: `blocks-runtime`

One shipped registry item encapsulating host wiring so no human hand-writes provider boilerplate. It is a `registryDependency` of every data block and mounts, once at app root:

1. **One** `<QueryClientProvider>` (one shared `QueryClient` for all namespaces — the "two QueryClients" fear was an *unmounted-provider* artifact, not a real defect).
2. **Per-namespace `configure()`** for each namespace present, reading `NEXT_PUBLIC_<NS>_GRAPHQL_ENDPOINT` and attaching auth via a host `getToken` → `Authorization: Bearer <token>` adapter.

```tsx
<BlocksRuntime namespaces={['auth', 'admin']} getToken={() => tokenManager.getAccessToken()}>
  {children}
</BlocksRuntime>
```

A block **never** mounts a provider or calls `configure()`. Tests mount the runtime (or mock the generated hook module) — never react-query directly.

## 7. Generating the SDK (`cnc codegen`)

```bash
cnc codegen --endpoint https://auth.<app-host>/graphql --react-query --orm -o src/generated/auth
cnc codegen --api-names auth,admin,public,objects --react-query --orm -o src/generated
cnc codegen --schema-file ./schemas/auth.graphql --react-query --orm -o src/generated/auth
```

`--react-query` **and** `--orm` are both required. `--dry-run` previews without writing (used by the staleness check). Sources are mutually exclusive: `--endpoint` | `--schema-file` | `--schema-dir` | `--api-names`/`--schemas` | `--config`. Output is never hand-edited (`@generated … DO NOT EDIT`); regeneration is the only correct change.

## 11. Compliance checklist

A reviewer checking a block MUST confirm:

1. **Generated-hook import** — data blocks import from `@/generated/<ns>`, never a package name or hardcoded generated path.
2. **No network code** — no `fetch`, no GraphQL document strings, no `configure()`/`getClient()`, no `QueryClientProvider` in any block file.
3. **Generated hook names** — calls use real generated names (`use<Op>Mutation`, `use<Plural>Query`) and pass a `selection`.
4. **Override seam** — `onSubmit`/`adapter` present and fully replaces the default hook.
5. **`requires.json`** — every data block ships a co-located manifest; presentational blocks ship none.
6. **Runtime dependency** — data blocks list `blocks-runtime` in `registryDependencies`; none mount a provider.
7. **Docs prerequisite** — the registry `docs` field summarizes SDK/proc prerequisites for humans.
8. **Gap honesty** — blocks for known gaps carry the out-of-scope / backend-pending banner; their `requires.json` names the absent op.
9. **No pinned-SDK references** — `grep` for `@constructive-io/data`, `@constructive-io/react`, `useConstructiveClient`, `<ConstructiveProvider>`, `tokenStorage` finds nothing in block source.
