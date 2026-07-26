# Evidence producer contract

Use these schemas exactly. Every machine-evidence object rejects extra keys unless this reference explicitly says otherwise. Use `schemaVersion: 1`, keep every referenced path relative to the validated workspace, and write references as regular non-symlink files beneath that workspace.

## Contents

- [Transition rules](#transition-rules)
- [Referenced outcome artifacts](#referenced-outcome-artifacts)
- [Brief and tenant evidence](#brief-and-tenant-evidence)
- [Install evidence](#install-evidence)
- [Domain and static evidence](#domain-and-static-evidence)
- [Live evidence](#live-evidence)
- [Visual evidence](#visual-evidence)
- [Acceptance evidence](#acceptance-evidence)
- [Retention and journal integrity](#retention-and-journal-integrity)

## Transition rules

A passing transition requires exactly one artifact for every type assigned to its stage:

| Stage | Required types |
| --- | --- |
| `brief` | `validation` |
| `tenant` | `tenant-contract`, `endpoint-check` |
| `install` | `install-plan`, `install-log`, `manifest`, `package-provenance`, `blocks-check` |
| `domain` | `source-check`, `meta-contract` |
| `static` | `typecheck`, `build` |
| `live` | `live-session`, `graphql`, `rls` |
| `visual` | `screenshot`, `interaction` |
| `acceptance` | `evaluator` |

A failing transition requires one or more types valid for that stage. Every attached failure artifact must contain at least one failed result; omit successful types from a failure transition. `validation` can only pass, while `blocks-check` is successful only when the canonical full checker actually exits successfully.

## Referenced outcome artifacts

Use request and UI outcome files wherever another schema names `requestRef` and `uiRef`. `checks` must be non-empty, use unique non-empty IDs, and contain only `{ "id", "passed" }`. The top-level `passed` value must equal the conjunction of its checks.

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-request-outcome",
  "endpointKind": "data",
  "operation": "updateAccount",
  "statusCode": 200,
  "checks": [{ "id": "http-ok", "passed": true }],
  "passed": true
}
```

`statusCode` must be `0` or an integer from 100 through 599, and a passing request requires a 2xx response. `endpointKind` and `passed` must match the referencing result.

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-ui-outcome",
  "state": "ready",
  "visible": true,
  "interactive": true,
  "checks": [{ "id": "account-row-visible", "passed": true }],
  "passed": true
}
```

A passing UI result must be visible. Its `passed` value must match the referencing result.

## Brief and tenant evidence

### `validation`

Point `validation` directly at the immutable passing `constructive.builder-validation` file used to initialize the journal. Its path, SHA-256, and parsed JSON must exactly equal the journal's validation input; a copied or reconstructed report is invalid.

### `tenant-contract`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-tenant-contract-evidence",
  "tenants": [
    {
      "tenantId": "tenant-primary",
      "role": "primary",
      "endpointKinds": ["data", "auth"],
      "requireCsrfForAuth": true,
      "passed": true
    }
  ]
}
```

List the primary descriptor first, followed by isolation descriptors in their validated order. Each ID, role, endpoint-kind set, and Auth CSRF policy must exactly match the resolved tenant contract.

### `endpoint-check`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-endpoint-check-evidence",
  "results": [
    {
      "tenantId": "tenant-primary",
      "endpointKind": "data",
      "statusCode": 200,
      "passed": true,
      "requestRef": ".constructive/harness/evidence/requests/primary-data.json"
    }
  ]
}
```

Provide one unique result for every primary/isolation tenant × declared semantic endpoint. `statusCode` must equal the referenced request outcome's status.

## Install evidence

### `install-plan`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-install-plan-evidence",
  "plans": [
    {
      "root": "console-module-auth",
      "sha256": "<attested-plan-sha256>",
      "passed": true
    }
  ]
}
```

Preserve the validated install-plan order and repeat every selected root plus the SHA-256 of its immutable compact plan.

### `install-log`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-install-log-evidence",
  "results": [
    {
      "root": "console-module-auth",
      "command": "pnpm dlx shadcn@4.13.1 add @constructive/console-module-auth",
      "exitCode": 0,
      "outputRef": ".constructive/harness/evidence/install/console-module-auth.txt",
      "outputSha256": "<output-file-sha256>",
      "passed": true
    }
  ]
}
```

Provide every selected root once. `command` must exactly equal `install.command` in that root's attested plan, `passed` must equal `exitCode === 0`, and `outputSha256` must match the retained output file.

### `manifest`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-manifest-evidence",
  "results": [
    {
      "surfaceId": "console",
      "featurePack": "auth",
      "manifestRef": ".constructive/feature-packs/auth.json",
      "sha256": "<manifest-sha256>",
      "passed": true
    }
  ]
}
```

Provide one result for every validated surface × installed feature pack. The referenced installed sidecar may contain its normal additional fields, but it must have `schemaVersion: 1`, an `id` equal to `featurePack`, and `capabilities.required` as an array.

### `package-provenance`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-package-provenance-evidence",
  "packages": [
    {
      "name": "@constructive-io/data",
      "resolvedRef": ".constructive/harness/evidence/packages/constructive-data.json",
      "sha256": "<resolution-file-sha256>",
      "sourceCommit": "<pinned-blocks-head-or-null>",
      "passed": true
    }
  ]
}
```

Provide each unique `composition.npmDependencies[].name` from all attested plans exactly once. Retain concrete package-manager resolution output in `resolvedRef`; its hash must match. `sourceCommit` must equal the pinned Blocks HEAD, or `null` only when the validated run has no branch-only source.

### `blocks-check`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-blocks-check-evidence",
  "headCommit": "<pinned-blocks-head>",
  "checkerSha256": "<canonical-checker-sha256>",
  "outputSha256": "<sha256-of-trimmed-stdout>",
  "passed": true
}
```

Run the canonical sibling checker with `--blocks-repo <pinned-blocks-worktree>` and without `--source-preflight`. Hash its trimmed stdout. The harness reruns that full command and requires the same output. If a validated test fixture has no Blocks source, all three source fields must be `null`; production branch-only runs use the pinned values.

## Domain and static evidence

### `source-check`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-source-check-evidence",
  "results": [
    {
      "routeId": "contacts",
      "sourceRef": "src/app/contacts/page.tsx",
      "sha256": "<source-file-sha256>",
      "passed": true
    }
  ]
}
```

Provide every validated application-owned domain route exactly once. The source reference and SHA-256 must resolve to its retained workspace file.

### `meta-contract`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-meta-contract-evidence",
  "results": [
    {
      "routeId": "contacts",
      "resource": "Contact",
      "endpointKind": "data",
      "contractVersion": "2026-07",
      "metaPassed": true,
      "introspectionPassed": true,
      "reconciled": true,
      "requestRef": ".constructive/harness/evidence/requests/contacts-meta.json",
      "passed": true
    }
  ]
}
```

Provide every domain route exactly once. The route/resource pair and contract version must match validation, `endpointKind` must be `data`, and `passed` must equal the conjunction of metadata, introspection, and reconciliation. The request outcome must be for the data endpoint and have the same pass result.

### `typecheck` and `build`

Use the same shape with the type-specific kind:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-typecheck-evidence",
  "command": "pnpm typecheck",
  "exitCode": 0,
  "outputRef": ".constructive/harness/evidence/static/typecheck.txt",
  "outputSha256": "<output-file-sha256>",
  "passed": true
}
```

Use `constructive.builder-build-evidence` for `build`. Commands must be non-empty, output references and hashes must match retained files, and `passed` must equal `exitCode === 0`.

## Live evidence

Use these kinds for the three required live types:

- `live-session` → `constructive.builder-live-session-evidence`, covering every Auth scenario.
- `graphql` → `constructive.builder-graphql-evidence`, covering every feature and CRUD scenario.
- `rls` → `constructive.builder-rls-evidence`, covering every RLS scenario.

All three use this exact outer shape:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-graphql-evidence",
  "tenantIds": ["tenant-primary", "tenant-isolation"],
  "results": [
    {
      "scenarioId": "user-management",
      "actorIds": ["owner", "peer"],
      "assertions": [
        {
          "id": "capability:users.directory:ready",
          "passed": true,
          "contract": {
            "role": "required",
            "capability": "users.directory",
            "alternativeId": "users.directory.path-1",
            "verificationProfileId": "tenant-runtime",
            "endpointKind": "admin",
            "evidence": {
              "type": "graphql-operations",
              "operation": "query",
              "coordinates": ["Query.users"]
            }
          },
          "requestRef": ".constructive/harness/evidence/requests/users.json",
          "uiRef": ".constructive/harness/evidence/ui/users.json"
        }
      ]
    }
  ]
}
```

`tenantIds` must exactly cover the primary and isolation tenant IDs as a unique set. A pass must include every scenario assigned to the evidence type, repeat its exact actor IDs, and cover every assertion ID. Auth IDs resolve as `auth-check:<check-id>:<expected-state>`. Console feature assertions repeat the exact resolved contract object; assertions without a Blocks binding use `contract: null`. Request and UI outcomes must have the same `passed` result as their assertion.

## Visual evidence

### `screenshot`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-visual-evidence",
  "results": [
    {
      "target": { "kind": "surface", "surfaceId": "console", "featurePack": "auth" },
      "viewport": {
        "id": "desktop",
        "width": 1440,
        "height": 1000,
        "deviceScaleFactor": 1,
        "colorScheme": "light"
      },
      "state": "ready",
      "passed": true,
      "screenshotRef": ".constructive/harness/evidence/visual/auth-desktop.png",
      "interactionRef": ".constructive/harness/evidence/visual/auth-desktop-interaction.json"
    }
  ]
}
```

Provide every validated target × viewport × state exactly once and repeat the full resolved target and viewport objects. `screenshotRef` must be a structurally complete PNG with valid chunk CRCs, non-empty inflating IDAT scanlines, terminal IEND, and exact pixel dimensions `round(width × deviceScaleFactor)` by `round(height × deviceScaleFactor)`. JPEG, WebP, header-only stubs, truncated chunks, invalid filters, and dimension-only files are rejected.

The referenced interaction outcome uses this exact shape:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-interaction-outcome",
  "targetKey": "surface|console|auth|desktop|ready",
  "viewportId": "desktop",
  "state": "ready",
  "checks": [{ "id": "keyboard-navigation", "passed": true }],
  "passed": true
}
```

Build `targetKey` as `surface|<surfaceId>|<featurePack>|<viewportId>|<state>`, `domain-route|<routeId>|<resource>|<viewportId>|<state>`, or `shell|<surfaceId>|<viewportId>|<state>`.

### `interaction`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-interaction-evidence",
  "results": [
    {
      "target": { "kind": "surface", "surfaceId": "console", "featurePack": "auth" },
      "viewport": {
        "id": "desktop",
        "width": 1440,
        "height": 1000,
        "deviceScaleFactor": 1,
        "colorScheme": "light"
      },
      "state": "ready",
      "passed": true,
      "artifactRef": ".constructive/harness/evidence/visual/auth-desktop-interaction.json"
    }
  ]
}
```

Provide the same complete target × viewport × state set as `screenshot`; each `artifactRef` points to the exact interaction-outcome schema above.

## Acceptance evidence

Use `constructive.builder-acceptance-evidence` with exactly `schemaVersion`, `kind`, `tenantIds`, `capabilities`, `scenarios`, `limitations`, and `verdict`:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-acceptance-evidence",
  "tenantIds": ["tenant-primary", "tenant-isolation"],
  "capabilities": [
    {
      "surfaceId": "console",
      "featurePack": "auth",
      "expected": "ready",
      "actual": "ready",
      "passed": true,
      "requestRef": ".constructive/harness/evidence/requests/auth-acceptance.json",
      "uiRef": ".constructive/harness/evidence/ui/auth-acceptance.json"
    }
  ],
  "scenarios": [],
  "limitations": [
    {
      "id": "source-limitation-id",
      "status": "open-pinned-source-gap",
      "passed": true,
      "requirements": [
        {
          "id": "stable-mitigation-requirement-id",
          "passed": true,
          "requestRef": ".constructive/harness/evidence/requests/mitigation.json",
          "uiRef": ".constructive/harness/evidence/ui/mitigation.json"
        }
      ]
    }
  ],
  "verdict": "pass"
}
```

Capabilities exactly cover validated surface/pack expectations; `actual` is `ready`, `partial`, or `unavailable`, and a pass requires `actual === expected`. `scenarios` uses the live result grammar and covers every validated scenario. `limitations` exactly covers source-attested limitations; repeat each ID/status and every mitigation requirement in source order. A blocking limitation always remains false and prevents a pass. A require-mitigation result passes only when every requirement passes. Set `verdict` to the journal transition, `pass` or `fail`.

## Retention and journal integrity

Every load re-hashes retained evidence and references, reruns their exact semantic validators, reruns the pinned source preflight, and reruns the full Blocks checker for retained `blocks-check` proof. This semantic replay is the enforcement boundary: editing evidence and recomputing the journal's unkeyed hashes does not make an invalid artifact acceptable.

The per-attempt `previousHash`/`eventHash` chain, immutable-input root, and whole-journal SHA-256 bind ordinary history and detect stale or accidental edits. They do not provide cryptographic authenticity against a writer who can rewrite the journal and recompute unkeyed hashes; never describe the journal as tamper-proof.
