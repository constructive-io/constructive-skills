# Manifest & Checks

The authoritative `<block>.requires.json` schema and the `check-sdk.mjs` preflight. Per the SDK Binding Contract §7, **this document is authoritative** for the manifest shape — where the contract leaves the cross-namespace form to "pick one and keep it consistent," the choice is locked here.

## What ships a manifest

Every **data block** (any block importing a generated hook) ships a co-located, machine-readable `<block>.requires.json` as a registry `file`. On install it lands at:

```
.constructive/blocks/<block>.requires.json
```

This path is **relative to the blocks registry target**. shadcn resolves the target against the host's aliases, so on a standard Next.js `src/` layout the manifest actually lands at `src/.constructive/blocks/<block>.requires.json`; only when the blocks target sits at the project root does it land at the root `.constructive/blocks/`. `check-sdk.mjs` scans **both** locations (and accepts `--manifests-dir` to override), so a manifest under `src/` is never silently missed.

**Presentational blocks ship none** (no generated-hook import → nothing to verify). The registry item's `docs` field always carries a *human-readable* summary of the same prerequisites; the JSON manifest is the machine-checkable twin that `check-sdk.mjs` reads.

## Schema — single namespace (canonical)

A block that imports from one namespace ships a single top-level object:

```json
{
  "namespace": "auth",
  "mutations": ["signIn", "requireStepUp"],
  "queries": ["currentUser"],
  "models": []
}
```

| Field | Meaning |
|---|---|
| `namespace` | The generated namespace the block imports from (`auth`, `admin`, `objects`, `public`, or a custom API). Exactly the `<ns>` in `@/generated/<ns>`. |
| `mutations` | GraphQL **operation names** the block calls — camelCase, post-inflection (`signIn`, not `SignIn`, not `useSignInMutation`). The check derives the hook name. |
| `queries` | GraphQL query operation names, same convention. |
| `models` | Table **model accessors** the block needs — populated **only** when the block uses a `use<Plural>Query` list hook. Subject to the Connection rule (below). The ORM accessor is **singular** (`db.orgMembership`); prefer the singular name, but the check normalises plural↔singular so either form matches. |
| `pending` *(optional)* | Op/model names this block declares as **backend-pending** — a seam shipped for a proc not yet deployed in any public schema (e.g. `transferOrgOwnership`, `removeOrgMember`). The check **reports** these but never fails on them. A missing op that is **not** listed here still fails clearly. Omit when the block has no pending seam. Accepts a flat array `["transferOrgOwnership"]` or a per-kind object `{ "mutations": [...], "models": [...] }`. |

The four core keys are present; unused ones are empty arrays. `pending` is optional.

### Model names are singular-normalised

A model accessor and its `models/<name>.ts` file are **always singular** (the ORM exposes `db.orgMembership.findMany()`, never `db.orgMemberships`), even though the *list hook* it pairs with is plural (`useOrgMembershipsQuery`). The manifest's `models` entry names the **accessor**, so the canonical form is singular (`orgMembership`, `email`, `user`). `check-sdk.mjs` normalises both the declared name and the on-disk file name through one singulariser, so a manifest that declares `orgMemberships` (plural) and one that declares `orgMembership` (singular) **both** satisfy the same `models/orgMembership.ts` — author either, prefer singular.

### Declaring a backend-pending seam

Some GA blocks ship a button/path for a procedure that is real-but-not-yet-deployed (the "pending seams" called out in `flows.json` — `transferOrgOwnership`, `removeOrgMember`, `resendOrgInvite`). Such a block is still **correctly wired**: its GA path stands alone and the pending action degrades gracefully. List the pending op in `pending` so the preflight reports it as informational (`◦ … (backend-pending)`) instead of a hard `✗`:

```json
{
  "namespace": "admin",
  "mutations": ["updateOrgMembership", "deleteOrgMembership", "removeOrgMember", "transferOrgOwnership"],
  "queries": [],
  "models": ["orgMembership"],
  "pending": ["removeOrgMember", "transferOrgOwnership"]
}
```

This keeps the check honest: declared-pending ops don't block a build, but any op the SDK lacks that is **not** declared pending still fails — so a genuine wiring/stale-SDK error is never masked.

## Schema — cross-namespace (locked shape)

A block that imports from more than one namespace uses a top-level **`requires` array**, one object per namespace:

```json
{
  "requires": [
    { "namespace": "admin", "mutations": ["submitOrgInviteCode"], "queries": [], "models": [] },
    { "namespace": "auth",  "mutations": [], "queries": ["currentUser"], "models": [] }
  ]
}
```

This is the **one** cross-namespace shape — do not use a bare top-level array, and do not nest namespaces inside a single object. `check-sdk.mjs` normalizes a manifest as: `raw.requires` when present, else `[raw]` (the single-object form). Prefer a single namespace per block where possible (§2); reach for `requires[]` only when a block genuinely spans schema sets.

## Operation-name → hook-name derivation

The manifest names **operations**; the check derives the generated **hook** it expects to find exported by the SDK:

| Manifest field | Entry | Expected SDK export |
|---|---|---|
| `mutations` | `signIn` | `useSignInMutation` |
| `queries` | `currentUser` | `useCurrentUserQuery` |
| `models` | `user` | a model file `models/user.*` (or an export named `user`) |

So a manifest entry is satisfied when the operation's `use<Pascal><Mutation\|Query>` identifier is a real export of the namespace's generated SDK.

## The Connection rule (when `models` applies)

A model accessor and its `use<Plural>Query` list hook exist **iff** the SDL has a `*Connection` object type for that table. Tables exposed only as private-schema views (no Connection type) get **no** accessor and **no** list hook — only their explicit mutations.

Practical consequence: only list `models` a block actually reads via a list hook. Sessions and API keys (`user_sessions` / `user_api_keys`, in `constructive_auth_private`) have no Connection type, so they are **not listable** through any generated SDK — a manifest must not claim them as `models`. The blocks for those lists are out of frontend scope until an API exposes the Connection (see SKILL.md "Known SDK gaps").

## `check-sdk.mjs`

Zero-dependency Node (≥18), bundled at `scripts/check-sdk.mjs`. Run from the host app root.

```bash
node scripts/check-sdk.mjs                       # check every installed manifest
node scripts/check-sdk.mjs auth-sign-in-card     # one block by name…
node scripts/check-sdk.mjs ./path/to.requires.json   # …or by manifest path
node scripts/check-sdk.mjs --project /path/app   # check a different project root
node scripts/check-sdk.mjs --manifests-dir DIR   # point at a non-standard manifests dir
node scripts/check-sdk.mjs --json                # machine-readable report on stdout
node scripts/check-sdk.mjs --help
```

Manifests are auto-discovered under **both** `<project>/.constructive/blocks` and `<project>/src/.constructive/blocks` (a block name passed as `[block]` is resolved against both, too). `--manifests-dir` overrides discovery with an explicit directory.

### What it verifies

1. The `@/generated/*` alias exists in the host `tsconfig.json` (follows one `extends` level; tolerant of JSONC comments + trailing commas — comment/comma stripping is **string-aware**, so path globs like `"@/*": ["./src/*"]` are never mis-parsed as block comments).
2. The generated dir for each block's namespace exists, resolved **via the alias** (tries `@/generated/<ns>`, `@/generated/<ns>/*`, then `@/generated/*` — never a hardcoded path).
3. Every manifest `mutation`/`query`/`model` maps to a real export of that SDK (it scans every SDK source file, so a leaf `export function useXMutation` is found regardless of barrel re-exports).
4. *(Advisory)* whether `<BlocksRuntime>` appears mounted somewhere in the host source.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Every prerequisite satisfied — or nothing to check (no manifests). |
| `1` | A prerequisite is missing (alias, generated dir, or an op/model export). |
| `2` | The check could not run — no `tsconfig.json`, bad args, or an unreadable/unparseable manifest. |

### What it does NOT do

It **never runs `cnc codegen`**. Drift detection (`--dry-run`) and generating a missing SDK need an endpoint and operator confirmation, so the script only *detects* and prints the exact command to run. The operator (or the agent following SKILL.md) performs the generation after confirming endpoint/api-names.

## Reading a failure → remediation

| Failure | What it means | Remediation |
|---|---|---|
| `✗ @/generated/* alias in tsconfig` | Host never aliased the generated output. | Add `"@/generated/*": ["./src/generated/*"]` to `tsconfig.json` paths, then re-check. |
| `namespace <ns> ✗ (unresolved …)` / dir missing | No SDK generated for that namespace. | The script prints `cnc codegen --api-names <ns> --react-query --orm -o src/generated`. Confirm endpoint/api-names with the operator, run it, re-check. |
| `✗ mutation <op> → use<Op>Mutation` (dir exists) | SDK is present but lacks that op — backend hasn't deployed the procedure, or the SDK is stale. | Regenerate; drift-check with `cnc codegen … --dry-run`. If the op is a known backend-pending gap, the block is not buildable until the proc ships. |
| `• <BlocksRuntime> not found` | Advisory only — not a hard failure. | Mount `<BlocksRuntime>` once at the app root (see SKILL.md host setup step 3). |

A red op line is the binding working as designed: the block surfaces the exact missing operation *before* compiling against a guess.
