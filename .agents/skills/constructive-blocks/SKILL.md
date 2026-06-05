---
name: constructive-blocks
description: "Install, wire, and author Constructive Blocks — copy-in React UI blocks (auth sign-in card, account, membership/invite flows) distributed via a shadcn registry that bind to the host app's per-application generated GraphQL SDK. Use when asked to add/install a Constructive block, run `shadcn add @constructive/<block>`, wire `blocks-runtime`, alias `@/generated/*`, generate a missing SDK with `cnc codegen`, write or check a `<block>.requires.json` manifest, run `check-sdk.mjs`, or author a new block against the generated React Query hooks. Enforces the SDK Binding Contract: a block imports generated hooks, never network code."
compatibility: Node.js 18+; host app on Next.js (App Router) + React 19 + @tanstack/react-query + a Constructive-generated SDK
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
license: MIT
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Blocks

Constructive Blocks are **copy-in** React UI blocks — auth, account, membership, invite, and object flows — shipped through a shadcn registry (`@constructive/<block>`). You install a block's source *into* the host app; it is then ordinary, editable app code.

A block is not a generic component. It binds to **your app's own generated GraphQL SDK** and is correct by construction for *that* app's schema. This skill is the operator's playbook for installing, wiring, checking, and authoring blocks without violating that binding.

## The doctrine in one sentence

> A data block imports generated **React Query hooks** from `@/generated/<namespace>` — the SDK the *host* produced from *its own* PostGraphile endpoints — and ships **no network code of its own**.

`@constructive-io/data`, `@constructive-io/sdk`, `<ConstructiveProvider>`, a hand-written `fetch`, or a hardcoded `src/graphql/...` path are all the **wrong** frame. The binding is the generated hook + a convention alias. The full law is [`references/binding-doctrine.md`](./references/binding-doctrine.md) (a condensation of the canonical SDK Binding Contract); it **wins** over any older blocks doc.

## When to Apply

Use this skill when:

- **Installing a block**: "add the sign-in card", `npx shadcn add @constructive/auth-sign-in-card`, or wiring any `@constructive/*` block into an app.
- **Preflight / checking**: running `check-sdk.mjs`, diagnosing "block compiles against a missing operation", verifying a `<block>.requires.json`.
- **Host wiring**: aliasing `@/generated/*`, mounting `<BlocksRuntime>`, adding a namespace to the runtime, generating a missing SDK with `cnc codegen`.
- **Authoring a block**: writing a new block that calls a generated hook, choosing its namespace, declaring its `requires.json`, adding the override seam.

**Scope boundary — Blocks are auth/account/org/shell ONLY.** The catalogued blocks and flows cover **auth, account, organization, and app-shell** capability bundles (sign-in, password reset, MFA, membership, invites, settings). They are **not** a general application-flow library. For your **domain-entity CRUD UI** — the React UI over your own business tables — use **`constructive-frontend`** (CRUD Stack cards + runtime-generic `_meta` meta-forms), **not** blocks; the harness automates that path via `scripts/scaffold-frontend.mjs`. A "flow" here answers *"which auth flow?"*, never *"which business workflow?"*.

If the request is about generating the SDK itself, defer to the codegen skills — this skill *consumes* that SDK: **`constructive-codegen`** (codegen CLI/config flags), **`constructive-hooks`** / **`constructive-orm`** (generated hook/ORM output shapes, pagination), **`constructive-search`** (search).

## Host setup — three steps (once per app)

A block compiles only if the host satisfies all three. `check-sdk.mjs` verifies steps 1–2; you do step 3 once.

**1. Generate the SDK** for each namespace the app uses, into `src/generated/<namespace>`:

```bash
# By API name against the app database (auto-expands to multi-target):
cnc codegen --api-names auth,admin --react-query --orm -o src/generated
# …or per endpoint:
cnc codegen --endpoint https://auth.<app-host>/graphql --react-query --orm -o src/generated/auth
```

`--react-query` **and** `--orm` are both required — hooks wrap the ORM client and the runtime's `configure()` lives in the ORM layer. Generated files are stamped `DO NOT EDIT`; never hand-edit them, regenerate.

**2. Alias `@/generated/*`** to the generated output in `tsconfig.json` (and the bundler if it doesn't read tsconfig paths):

```jsonc
{ "compilerOptions": { "paths": { "@/generated/*": ["./src/generated/*"] } } }
```

**3. Mount `<BlocksRuntime>` once at the app root.** It is a `registryDependency` of every data block (installed automatically), so this is the only provider wiring a human writes:

```tsx
// app/layout.tsx
import { BlocksRuntime } from '@/blocks/runtime/blocks-runtime';
import { tokenManager } from '@/lib/auth';

export default function RootLayout({ children }) {
  return (
    <BlocksRuntime namespaces={['auth', 'admin']} getToken={() => tokenManager.getAccessToken()}>
      {children}
    </BlocksRuntime>
  );
}
```

The runtime mounts **one** shared `QueryClient`, calls each namespace's generated `configure()` (reading `NEXT_PUBLIC_<NS>_GRAPHQL_ENDPOINT`), and attaches `Authorization: Bearer <token>` via the host's `getToken`. A block **never** mounts a provider or calls `configure()`.

## Flow selection (start here)

**Before** you install any block, pick the **flow(s)** the app needs. A *flow* is a backend-capability bundle — it answers *"which auth flow do you want?"* with the exact database **modules** to provision, the GraphQL **operations** that go live, and the **blocks** that wire the UI. Every catalogued flow is **GA** (DB-wired, GraphQL-exposed, blocks resolve). This is the catalog-first analogue of better-auth's plugins, and it is the cure for the `modules:['all']` over-provisioning trap.

The catalog is two co-located files (both generated from one source of truth in apps/blocks — never hand-edit them):

- **[`references/flows.json`](./references/flows.json)** — the machine-readable catalog: each flow's `backend.preset`, the resolved flat `backend.modules[]`, `backend.exposedOps[]`, and `blocks[]`. Read this to drive provisioning + install programmatically.
- **[`references/flow-catalog.md`](./references/flow-catalog.md)** — the human-readable index of the same data.

### Decision procedure

1. **Read the brief → list the capabilities** the app needs (e.g. "sign in, reset password, manage org members").
2. **Map each capability to a flow id** in `references/flows.json` (e.g. `email-password`, `password-reset`, `org-members`). Pick the minimal set that covers the brief.
3. **Provision the UNION of the chosen flows' `backend.modules[]`** — the exact flat list, deduplicated across flows. Pass it to `databaseProvisionModule.create({ data: { modules } })`. **Never `modules:['all']`.** A flow's `modules[]` is authoritative; `preset` is only the smallest covering shipped preset (advisory). Org flows have no preset smaller than `b2b`.
4. **Install ONLY the chosen flows' `blocks[]`** — not the whole library. `npx shadcn@latest add <block> <block> …` for the union of the flows' blocks.
5. **Run `check-sdk.mjs`** (below) for each installed data block — it proves the host SDK actually exposes the ops the flow's blocks call, before you waste a build.

```bash
# Example: brief needs sign-in + password reset.
# flows.json → email-password (preset auth:email) + password-reset (preset auth:email).
# Union of modules is the auth:email set (same preset) → provision that once, then:
npx shadcn@latest add auth-sign-in-card auth-sign-up-card auth-sign-out-button \
  auth-forgot-password-card auth-reset-password-card
node path/to/skill/scripts/check-sdk.mjs   # gate every installed data block
```

If a needed capability is **not** in the catalog (magic-link, OTP, MFA enroll, passkey, anonymous, SSO/SCIM stubs, context-switch), its blocks exist in the library but are **not GA** — they ship a "backend-pending" banner and their `requires.json` names a not-yet-deployed op, so `check-sdk.mjs` fails clearly rather than letting you build against a guess.

## Installing a block

```bash
# 1. Pull the block's source into the app (also installs its registry deps:
#    blocks-runtime, foundation libs, primitives, cn).
npx shadcn add @constructive/auth-sign-in-card

# 2. Preflight: prove the host SDK actually exports every op the block needs.
node path/to/skill/scripts/check-sdk.mjs auth-sign-in-card
```

Step 1 also writes the block's manifest to `.constructive/blocks/<block>.requires.json` — relative to wherever the blocks registry target lives, so on a standard Next.js `src/` layout it lands at **`src/.constructive/blocks/<block>.requires.json`**. `check-sdk.mjs` auto-discovers both the project-root and `src/` locations (use `--manifests-dir DIR` for anything non-standard). **Always run step 2 after installing a data block** — it is the §9 enforcement gate. A green check means the block will compile against real operations; a red check names the exact missing op *before* you waste a build.

Then render it:

```tsx
import { SignInCard } from '@/blocks/auth/sign-in-card/sign-in-card';

<SignInCard
  onSuccess={(r) => router.push('/')}
  forgotPasswordHref="/forgot"
  signUpHref="/register"
/>
```

## The `requires.json` manifest

Every **data block** ships a co-located, machine-readable manifest declaring exactly what the host SDK must expose. It lands at `.constructive/blocks/<block>.requires.json` on install — under `src/` when the blocks target lives there (`src/.constructive/blocks/<block>.requires.json`), which is the usual Next.js layout:

```json
{ "namespace": "auth", "mutations": ["signIn"], "queries": [], "models": [] }
```

- `namespace` — the generated namespace the block imports from (`auth`, `admin`, `objects`, `public`, …).
- `mutations` / `queries` — **GraphQL operation names** (camelCase, post-inflection) the block calls. `signIn` (not `useSignInMutation`) — the manifest names the *operation*; the check derives the hook.
- `models` — table model accessors the block needs (only when it uses a `use<Plural>Query` list hook; see the Connection rule below).

**Presentational blocks ship no manifest.** A cross-namespace block uses one shape consistently — see [`references/manifest-and-checks.md`](./references/manifest-and-checks.md) for the authoritative schema (single-object vs `requires: [...]` array) and rules.

## `check-sdk.mjs` — the preflight gate

Zero-dependency Node (≥18). Run from the host app root:

```bash
node scripts/check-sdk.mjs                    # check every installed manifest
node scripts/check-sdk.mjs auth-sign-in-card  # check one block (name or manifest path)
node scripts/check-sdk.mjs --project /path/app --json
```

It (1) verifies the `@/generated/*` alias exists in `tsconfig.json`, (2) resolves and checks the generated dir for each block's namespace, (3) asserts every manifest op maps to a real SDK export (`signIn` → `useSignInMutation`), (4) advises whether `<BlocksRuntime>` is mounted, and (5) emits **contract advisories** (WARN-only) for known arg-domain / defective ops an installed block touches — see the **(B)** table under "Known SDK gaps". **Exit codes: `0`** satisfied · **`1`** a prerequisite is missing · **`2`** the check couldn't run (no tsconfig / bad manifest). **Contract advisories never change the exit code** — they're read from `warnings[]` in `--json`.

On failure it prints the exact remediation:

- **Alias or generated dir missing** → it prints the `cnc codegen --api-names <ns> --react-query --orm -o src/generated` to run, then re-check.
- **SDK present but an op is absent** → the backend likely hasn't deployed that procedure, or the SDK is stale. Regenerate and drift-check with `cnc codegen … --dry-run`.

It also prints **contract advisories** (WARN, exit code unchanged): a `⚠` line per known arg-domain / defective op an installed block touches (see the **(B)** table above). For an **arg-domain** WARN, pass the safe value (e.g. `createApiKey` → `read_only`/`full_access`, not `read`/`write`/`admin`). For a **defective** WARN (GAP-N), the op is upstream-broken — don't build a flow that depends on it succeeding; treat it as backend-pending. The harness reads these from `warnings[]` in `--json` (`node scripts/check-sdk.mjs --json`).

**This script never runs `cnc codegen` itself** — generation needs an endpoint and operator confirmation. It *detects*; you *remediate*. If the SDK is genuinely missing, confirm the endpoint/api-names with the operator, run `cnc codegen`, then re-run the check.

## Extending the runtime with a new namespace

`blocks-runtime.tsx` is the host's wiring point, not a leaf block — editing it is expected. To support a namespace beyond `auth`/`admin`, make exactly three matched edits:

```tsx
import { configure as configureObjects } from '@/generated/objects';      // 1. import its configure()
export type BlocksNamespace = 'auth' | 'admin' | 'objects';               // 2. widen the union
const CONFIGURERS = { auth: configureAuth, admin: configureAdmin, objects: configureObjects };
const ENDPOINTS = {
  auth: process.env.NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT,
  admin: process.env.NEXT_PUBLIC_ADMIN_GRAPHQL_ENDPOINT,
  objects: process.env.NEXT_PUBLIC_OBJECTS_GRAPHQL_ENDPOINT,             // 3. add the literal env var
};
```

The env var **must** be referenced literally (`process.env.NEXT_PUBLIC_OBJECTS_GRAPHQL_ENDPOINT`), never as `process.env[\`NEXT_PUBLIC_${ns}_...\`]` — Next.js only inlines literal references.

## Generated hook anatomy

Block authors call the **real generated names** and pass a `selection` — never guess a signature; verify it in the generated `.d.ts`.

| Operation kind | Generated hook | Example |
|---|---|---|
| Custom operation | `use<PascalOp>Mutation` | `signIn` → `useSignInMutation` |
| Table read (list / one) | `use<Plural>Query` / `use<Singular>Query` | `useUsersQuery`, `useUserQuery` |
| Table write | `useCreate/Update/Delete<Name>Mutation` | `useCreateApiKeyMutation` |

```tsx
const signIn = useSignInMutation({
  selection: { fields: { result: { select: { userId: true, mfaRequired: true } } } },
});
await signIn.mutateAsync({ email, password, rememberMe });
```

**Connection rule (critical):** a model accessor + `use<Plural>Query` list hook exist **iff** the SDL has a `*Connection` type for that table. Tables exposed only as private-schema views get no list hook — only their explicit mutations. This is why sessions/api-keys are not listable (see gaps below).

## Known SDK gaps (consequences, not bugs)

There are **two** distinct gap classes, surfaced by `check-sdk.mjs` in two different ways:

**(A) Absent ops — caught by the binding gate (HARD-FAIL on import, ◦ when degraded).** The op isn't in the SDK at all (not-yet-deployed proc or no Connection type). A block that *imports* it fails the check; a block that *declares but degrades* (never imports it) reports `◦` and passes.

| Capability | Status | Block handling |
|---|---|---|
| List active sessions | No Connection type (`user_sessions` is private) → no list hook | `auth-account-sessions-list` is **out of frontend scope** until an API exposes a sessions Connection. Only `revokeSession` exists. |
| List API keys | Same — `user_api_keys` is private | `auth-account-api-keys-list` likewise out of scope; `createApiKey`/`revokeApiKey` exist. |
| Passkeys / TOTP-enroll / magic-link / email-OTP / anonymous / context-switch / org transfer+delete (`removeOrgMember` / `transferOrgOwnership` / `delete_org`) | Procedures **not yet deployed** in any public schema | Blocks kept **backend-pending** with a "not buildable until proc ships" banner; their `requires.json` names the pending op so `check-sdk.mjs` fails clearly (or marks it `◦` when degraded). Route member-remove through GA `deleteOrgMembership`. |

A block whose required op is absent **fails the check with a precise message** rather than compiling against a guess — that is the gap surfacing honestly, not a defect.

**(B) Present-but-defective ops — surfaced by the CONTRACT PREFLIGHT (WARN, never a failure).** These ops *exist* and type-check (they pass the binding gate), but calling them the way a block ships fails at **runtime**: a wrong **arg-domain** (a live `INVALID_ACCESS_LEVEL`) or a known **upstream defect** (silent no-op / RLS-deny / abort). The binding gate can't see this — the export is present — so `check-sdk.mjs` emits a **contract advisory** naming the op, the GAP-N, and the safe value. **This table is the source `check-sdk.mjs` mirrors** (the `KNOWN_AXES` table in the script); keep them in sync — a new row here with an op signature should gain a `KNOWN_AXES` entry. The advisories appear under "⚠ contract advisories" in the human report and as a `warnings[]` array in `--json`. Based on the harness's confirmed-live facts in **`PLATFORM-GAPS.md`** + **`planning/upstream-gaps-stress-test-2026-06-05.md`**.

| Op(s) | Axis | GAP | Safe value / behavior |
|---|---|---|---|
| `createApiKey` | **arg-domain** `accessLevel ∈ {read_only, full_access}` | auth-api-key axis | The `auth-api-key-create-dialog` ships `{read, write, admin}` → live **`INVALID_ACCESS_LEVEL`**. Pass `read_only` or `full_access`. (`createApiKey` also enforces `STEP_UP_REQUIRED` server-side.) |
| `createUser(type=2)` / `createOrganization` | **defective** (RLS-deny) | GAP-6 | RLS-denied for an authenticated session (`new row violates row-level security policy for table "users"`) — no self-service org can be minted on the b2b tier. Confirmed via both the block and the direct API. Upstream (constructive-db). |
| `userSessions` / `sessions` (list) | **defective** (no Connection) | GAP-2 | No `userSessions` list query is exposed → the Sessions flow can't enumerate sessions to revoke. Out of frontend scope until a Connection ships. |
| `revokeSession` | **defective** (id mismatch) | GAP-2 | Returns `SESSION_NOT_FOUND` for the id on a `signIn`/`signUp` result (UUIDv5 identity id ≠ `sessions`-row UUIDv7; reads `user_sessions` while `signIn` writes `sessions`). Treat sessions-revoke as backend-pending; don't hand-craft a session id. |
| `revokeApiKey` | **defective** (silent partial write) | GAP-3 | Returns `true` + writes an audit-log entry but never sets `revoked_at` — the key keeps working. Don't trust its `true` as a revoke (security footgun). |
| `sendVerificationEmail` | **defective** (aborts) | GAP-9 | Aborts before any email enqueues (`user_secrets_del(uuid, text[]) does not exist`). Email-verification unreachable on `auth:email`; the send raises server-side. No workaround. |
| `sendAccountDeletionEmail` | **defective** (silent no-op) | GAP-10 | Returns HTTP 200 but enqueues nothing — the UI claims "a confirmation email has been sent" while Mailpit stays empty. Don't hand-roll the deletion email. |
| `forgotPassword` / `signOut` | **defective** (empty selection) | GAP-11 | `forgot-password-card` + `sign-out-button` (dashboard-blocks) ship `selection:{fields:{}}` which codegen rejects (`… must have a selection of subfields`). App-local fix: set the selection to `{ clientMutationId: true }`. (`signOut` codegen is also broken per GAP-4.) |

A contract advisory is **not** a failure — the block is installable and compiles. It is a heads-up so the build doesn't burn a round-trip on a runtime arg-domain error or a silent no-op. (GAP-5 absent ops live in table **(A)**, handled by the binding gate's pending mechanism — they are intentionally **not** duplicated as contract advisories.)

## The override seam (portability)

The default path is the generated hook. Every data block also accepts an `onSubmit` (mutations) / `adapter` (queries) prop that **fully replaces** the network call, so the block runs on a non-Constructive backend. The block keeps owning form state, validation, error mapping, and notifications either way:

```tsx
<SignInCard onSubmit={async (vars) => myAuth.login(vars)} onSuccess={(r) => ...} />
```

This is the one soft point in the binding; everything else is the canonical Constructive-stack path.

## Testing blocks

Generated SDK hooks (`use<Op>Mutation`, `use<Plural>Query`) bind to a **module-level client singleton** — there is no client prop and no network call a prop can intercept. A test replaces the data layer, not the network. In order of preference:

1. **Use the override seam (no mocking).** Pass the block's `onSubmit` (mutations) / `adapter` (queries) prop a fake resolver and assert on form state / `onSuccess`:
   ```tsx
   render(<SignInCard onSubmit={async () => ({ accessToken: 'tok' })} onSuccess={onSuccess} />);
   await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
   expect(onSuccess).toHaveBeenCalled();
   ```
2. **Mock the `@/generated/<ns>` module** to exercise the default hook path without touching the singleton (`jest.mock`; Vitest `vi.mock` is equivalent):
   ```tsx
   jest.mock('@/generated/auth', () => ({
     useSignInMutation: () => ({ mutateAsync: jest.fn().mockResolvedValue({ signIn: { result: { accessToken: 'tok' } } }), isPending: false }),
     configure: jest.fn(),
   }));
   ```
3. **Mount `<BlocksRuntime>` (integration).** For the real hook + `QueryClient`, wrap in `<BlocksRuntime namespaces={['auth']} getToken={() => null}>` and point `NEXT_PUBLIC_AUTH_GRAPHQL_ENDPOINT` at a mock server (e.g. MSW). Slower — reserve for a few integration tests.

Always wrap rendered components that read React Query state in a `QueryClientProvider` (or `<BlocksRuntime>`, which provides one). Never leave a real generated module unmocked in a unit test — it reads a `NEXT_PUBLIC_*` endpoint that isn't set and fails opaquely.

## Authoring a new block — checklist

A new block is contract-compliant only if all hold (full list in `references/binding-doctrine.md` §11):

1. Data blocks import hooks from `@/generated/<ns>` — never a package name or hardcoded generated path.
2. No `fetch`, no GraphQL document strings, no `configure()`/`getClient()`, no `QueryClientProvider` in any block file.
3. Calls use the real generated hook names and pass a `selection`.
4. An `onSubmit`/`adapter` override prop is present and fully replaces the default hook.
5. Co-located `<block>.requires.json` lists namespace + ops; presentational blocks ship none.
6. `blocks-runtime` is in the block's `registryDependencies`; the block mounts no provider.
7. The registry `docs` field summarizes the SDK/proc prerequisites for humans.
8. `grep` for `@constructive-io/data`, `useConstructiveClient`, `<ConstructiveProvider>`, `tokenStorage` finds nothing.

UI is built on `@constructive-io/ui` (consumed as an npm dependency — **never** vendored/copied) + the shared foundation libs/primitives (`auth-errors`, `auth-schemas`, `form-field`, `auth-error-alert`, `auth-loading-button`). Form state uses `@tanstack/react-form`.

## Reference Guide

| Reference | Topic | Consult when |
|---|---|---|
| [binding-doctrine.md](./references/binding-doctrine.md) | The canonical SDK binding law: namespaces, import convention, runtime, hook anatomy, override seam, compliance checklist | Authoring a block, reviewing one, or resolving any "how does a block reach the backend" question |
| [manifest-and-checks.md](./references/manifest-and-checks.md) | Authoritative `requires.json` schema (single + cross-namespace), op-name rules, `check-sdk.mjs` invocation/exit codes/remediation | Writing or validating a manifest, interpreting a check failure |
| [flow-catalog.md](./references/flow-catalog.md) | The GA flow catalog (human-readable) — each flow's preset, resolved modules, exposed ops, and blocks. Machine twin: [`flows.json`](./references/flows.json) | Picking which flow(s) to install, deciding the modules to provision and the blocks to add (see "Flow selection") |

## Cross-References

- `constructive-codegen` / `constructive-hooks` / `constructive-orm` / `constructive-search` — generating the SDK this skill consumes: `cnc codegen` flags, hook/ORM output shapes, selection/pagination/search.
- `constructive-frontend` — the `@constructive-io/ui` component library blocks are built on, **and** the home of domain-entity CRUD UI (CRUD Stack + `_meta` meta-forms, scaffolded by `scaffold-frontend.mjs`). Reach for it for business-table UI; reach for blocks for auth/account/org/shell.
- `constructive-platform` — CNC CLI, server config, API/endpoint deployment (what determines which ops a namespace exposes).
