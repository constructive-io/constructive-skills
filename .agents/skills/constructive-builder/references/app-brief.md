# Tenant frontend brief

The schemaVersion 2 brief freezes frontend assembly and acceptance decisions for an already-provisioned tenant. It contains references, endpoint routing, and expected behavior; it never contains credentials or backend module recipes.

Validate it through an absolute skill path and the pinned local Blocks source:

```bash
builder_skill_root=/absolute/path/to/constructive-builder
blocks_source=/absolute/path/to/pinned/blocks
node "$builder_skill_root/scripts/validate-brief.mjs" app-brief.json \
  --blocks-source "$blocks_source" \
  --output .constructive/harness/validation.json
```

The output path must stay under the validated workspace's `.constructive/harness` directory. The validator source-preflights the branch-only Blocks checkout, hashes the brief, primary and isolation descriptors, portable catalog, selected compact plans, canonical Blocks source, current `_meta` guidance, and full workspace inventory.

## Top-level shape

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exactly `2`. |
| `kind` | Exactly `constructive.tenant-frontend-brief`. |
| `app` | Kebab-case `id`, visible `name`, and a safe relative `workspace` contained by the brief directory. |
| `tenant` | Exact descriptor path plus preset/custom provenance. |
| `frontend` | One discriminated composition; loose or mixed root arrays are invalid. |
| `domain` | Application-owned CRUD route declarations only. `_meta` skill wiring is derived from the pinned contract, not copied here. |
| `acceptance` | Per-surface pack states, isolation tenants, actors, live scenarios, and visual targets. |

Removed flow-era and root-array keys are errors. `--tenant` may name only the exact path already frozen by `tenant.descriptorPath`; it cannot introduce a second tenant truth.

## Tenant provenance

A provisioned preset records one exact backend slug from the pinned Blocks `backendPresetRouting` array:

```json
{
  "kind": "preset",
  "preset": "auth:hardened"
}
```

The current routing contract resolves:

| Backend preset | Frontend preset root |
| --- | --- |
| `blank` | none; use explicit Console core/modules, full Console, or standalone composition |
| `auth:hardened` | `preset-auth-hardened` |
| `b2b:storage` | `preset-b2b-storage` |
| `full` | `preset-full` |

A custom backend remains executable because it carries opaque, non-secret references to the provisioning receipt and capability handoff:

```json
{
  "kind": "custom",
  "compositionReceiptRef": "tenant.customReceipt",
  "capabilityHandoffRef": "tenant.capabilities",
  "justification": "The tenant uses a tested custom Constructive DB composition."
}
```

The validator does not hardcode this table: it consumes `backendPresetRouting`, so a new or removed backend preset changes validation with the pinned snapshot. Custom tenants use Console core, selected Console modules, standalone packs, or the complete Console with evidence-driven degraded states. They cannot claim an official preset surface.

## Frontend composition

Choose exactly one variant:

- `console-preset` has `surfaceId`, one matching `preset-*` root, `mountPath`, and a Console session.
- `console-full` has `surfaceId`, `root: "console-kit-nextjs"`, `mountPath`, and a Console session. It installs all seven packs and works with preset or custom tenants; every unsupported pack still needs an explicit partial/unavailable expectation.
- `console-core` has `surfaceId`, exact root `console-kit-core`, `mountPath`, and a host session. It installs no packs; with no domain routes it uses exact empty capability/actor/scenario/isolation sets and proves the shell through its required visual target, while any declared domain route restores the normal actor and live-scenario requirements.
- `console-modules` has `surfaceId`, one or more unique `console-module-*` roots, `mountPath`, and a Console session. Presets, full kits, core, and standalone roots cannot be mixed into this list.
- `standalone` has unique mounts with `id`, `feature-pack-*` root, `mountPath`, and a pack-specific host binding. Duplicate IDs, roots, or paths are invalid.

Builder, rather than Blocks, rejects incompatible or duplicate composition choices.

### Console sessions

`internal-auth-endpoint` requires the Auth pack and `tenant.endpoints.auth`. CSRF and callback ownership are each explicit: Console ownership has only `{ "owner": "console" }`; host ownership also requires `providerRef` or `handlerRef`.

`host-session` requires `databaseId` equal to the primary descriptor's `id`, a non-secret `sessionRef`, and host-owned CSRF and callback handlers. A mismatch fails before rendering.

### Standalone bindings

Standalone Data uses `kind: "sheets"`, `endpointKind: "data"`, a host `configRef`, an embedded or standalone-auth session, and one transport:

- `default` uses the pinned Sheets/PostGraphile adapter.
- `custom-execute` names an `executeRef` and justification.
- `custom-adapter` names exact `adapterRef` and `executeRef` values plus justification.

This models the real `SheetsConfig`/`SheetsExecuteFn` seam. Data performs `_meta` and standard introspection internally, while the host owns semantic endpoint selection, URL resolution, authentication, and injected transport. A standalone-auth session additionally names `authEndpointKind: "auth"` and a `databaseId` exactly equal to the descriptor. It is rejected when `authPolicy.requireCsrfForAuth` is true or unknown because the pinned Sheets source has no CSRF bootstrap seam; embedded host auth remains the secure default. Non-Data standalone packs use `host-resources` with resources, policy, actions, and session references; those packs own no discovery or endpoint resolution.

## Tenant descriptors

Every descriptor contains `id`, optional `name`, `endpoints`, and an `authPolicy` exactly when an Auth endpoint is present. `authPolicy` contains the explicit non-secret boolean `requireCsrfForAuth`; absence never means CSRF is disabled. Endpoint values are a URL or `{ "id"?, "url" }`. Only source-attested semantic endpoint keys are accepted. URLs must be absolute HTTP(S) routes with no user information, fragment, or query string.

Cross-tenant RLS proof requires `acceptance.isolationTenants[]`, each with an exact descriptor path and session reference. The loaded descriptor must have a database ID different from the primary tenant. A cross-tenant actor references that record and repeats its exact database ID; an arbitrary string cannot satisfy the check.

## Capability expectations

Declare one entry for every `(surfaceId, featurePack)` pair installed by the composition. `ready` and `partial` require a scenario target; `partial` and `unavailable` require a reason. A partial entry also partitions every source-required capability into non-empty `requiredCapabilities.available` and `requiredCapabilities.unavailable` arrays, with no omission or overlap.

Console readiness uses only `consoleModuleBindings` attested by Blocks. A `first-party` binding selects one `verificationProfileId` for the surface/pack expectation and one exact route for every available required capability and every prerequisite: `{ "capability", "alternativeId", "endpointKind" }`. The alternative ID must belong to that capability and profile, and the selected endpoint kind must both exist in the descriptor and be permitted by the alternative. The resolved expectation retains the verification profile and adapter sources/requirements once, while each proof retains its alternative ID and evidence contract. This keeps assertion contracts compact without reducing readiness to endpoint names or root-name guesses. `unavailable` uses `{ "kind": "none" }`. Standalone entries repeat their mount's exact `host-sheets`, `custom-adapter`, or `host-resources` handoff so acceptance cannot test a different runtime.

The validator selects every applicable Blocks `sourceLimitations` record from its surface, root, feature-pack, and runtime-mode selectors. `blocking` records cannot pass under consumer wiring. `require-mitigation` records remain mandatory evaluator entries and pass only with retained affirmative evidence for every snapshot mitigation requirement; fail-closed configuration guards therefore do not become unconditional blockers. The current `data-console-nested-sheets-store` record is blocking for Console Data.

## Actors and live scenarios

Actors are exact variants:

- `anonymous` has `id`, `kind`, and a primary/isolation `tenantScope`.
- `account` also has `accountRef` and `sessionState: "active" | "revoked"`.

Every domain route has `mode: "crud"`; there is no opaque custom route mode. Each route needs a complete CRUD scenario with reload persistence and five structured RLS scenarios: same-tenant owner, same-tenant peer, anonymous, revoked session, and cross-tenant. Each RLS scenario declares create/read/update/delete outcomes and whether a denied mutation leaves storage unchanged. Actor rules require two distinct same-tenant accounts for peer checks and a real isolation descriptor/session for cross-tenant checks.

Auth scenarios cover sign-up, sign-in, session restoration, sign-out, forgot-password, reset-password, and revoked-session denial. Each check is `{ "id", "expected" }`; its expected ready/unavailable state is derived from the Auth required-capability partition, so partial Auth proves both working scenarios and deliberate unavailable controls.

Feature scenarios cover every other ready/partial surface pack with structured `capabilityChecks`. Each `{ "capability", "expected" }` must exactly cover every source-required capability and prerequisite; arbitrary prose belongs only in optional `observations` and cannot replace contract coverage. Targets name an exact surface/pack or domain route/resource, so generic prose cannot stand in for route coverage.

Every declared actor must appear in at least one scenario, and every isolation tenant must be reached by an actor that appears in a scenario. The zero-pack Console core with no domain routes is the only exact-empty case: capabilities, actors, scenarios, and isolation tenants are all empty while shell visual proof remains mandatory.

## Visual targets

`visual.viewports` freezes every named viewport with exact `width`, `height`, `deviceScaleFactor`, and `colorScheme`; desktop and mobile definitions are mandatory, so screenshots do not depend on a browser tool's defaults. Visual targets require both IDs. Every Console surface first needs `{ "kind": "shell", "surfaceId" }` with `ready` proof for its app bar, sidebar, responsive navigation, and interaction boundary. Every installed `(surfaceId, featurePack)` pair and every domain route also needs its own structured target. States are validated from `loading`, `ready`, `empty`, `populated`, `partial`, `unavailable`, `unauthorized`, `error`, and `validation-error`, and pack targets must include their expected degraded or ready state.
