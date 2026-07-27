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

Use request and UI outcome files wherever another schema names `requestRef` and `uiRef`. Each outcome is contextual proof for exactly one endpoint, route, scenario assertion, capability result, or limitation requirement. `checks` contains exactly one `{ "id", "passed" }` entry with the contextual ID described below, and top-level `passed` must equal that check.

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-request-outcome",
  "contextKey": "scenario|user-management|operation:update:allow|owner|tenant-primary",
  "endpointKind": "data",
  "operation": "operation:update:allow",
  "statusCode": 200,
  "checks": [{ "id": "operation:update:allow", "passed": true }],
  "passed": true
}
```

`statusCode` must be `0` or an integer from 100 through 599, and a passing request requires a 2xx response. `contextKey`, `endpointKind`, `operation`, check ID, and `passed` must match the referencing result.

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-ui-outcome",
  "contextKey": "scenario|user-management|operation:update:allow|owner|tenant-primary",
  "state": "ready",
  "visible": true,
  "interactive": true,
  "checks": [{ "id": "operation:update:allow", "passed": true }],
  "passed": true
}
```

A passing UI result must be visible. Its `contextKey`, state, exact check ID, and `passed` value must match the referencing result. Do not reuse a generic request or UI file across contexts; the journal validates every use before it deduplicates retained references.

Build contextual fields exactly:

- Endpoint checks use `endpoint|<tenantId>|<endpointKind>`, operation `endpoint-check`, and check ID `endpoint:<tenantId>:<endpointKind>`.
- Metadata checks use `meta|<routeId>|<resource>|<contractVersion>`, operation `meta-contract`, and check ID `meta-contract:<routeId>`.
- Scenario assertions use `scenario|<scenarioId>|<assertionId>|<comma-separated-actorIds>|<comma-separated-actor-tenantIds>`, operation/check ID equal to the assertion ID, and the assertion's resolved endpoint. Their UI state is `unavailable` for `:unavailable`, `unauthorized` for deny/revoked assertions, and `ready` otherwise.
- Capability results use `capability|<surfaceId>|<featurePack>|<expected>|<actual>`, operation `capability-state`, check ID `capability:<surfaceId>:<featurePack>`, and UI state equal to `actual`.
- Limitation requirements use `limitation|<limitationId>|<requirementId>`, operation `mitigation`, check ID `limitation:<limitationId>:<requirementId>`, and UI state `ready` or `error` according to `passed`.

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
  "preparation": [
    {
      "command": "pnpm --dir /work/blocks install --frozen-lockfile",
      "exitCode": 0,
      "outputRef": ".constructive/harness/evidence/install/prepare-install.txt",
      "outputSha256": "<output-file-sha256>",
      "passed": true
    },
    {
      "command": "pnpm --dir /work/blocks build:registry",
      "exitCode": 0,
      "outputRef": ".constructive/harness/evidence/install/prepare-registry.txt",
      "outputSha256": "<output-file-sha256>",
      "passed": true
    },
    {
      "command": "pnpm --dir /work/blocks pack:local",
      "exitCode": 0,
      "outputRef": ".constructive/harness/evidence/install/prepare-packages.txt",
      "outputSha256": "<output-file-sha256>",
      "passed": true
    }
  ],
  "results": [
    {
      "root": "console-module-auth",
      "command": "pnpm --dir /work/blocks/apps/registry exec shadcn add @constructive/console-module-auth --cwd /work/app --yes",
      "exitCode": 0,
      "outputRef": ".constructive/harness/evidence/install/console-module-auth.txt",
      "outputSha256": "<output-file-sha256>",
      "passed": true
    }
  ]
}
```

For branch-only runs, `preparation` exactly covers `release.localConsumption.prepareCommands` after replacing `<blocks-repo>` and `<consumer-repo>` with the pinned absolute paths. Each install command exactly equals `localInstallCommandTemplate` with those replacements and `{name}` set to the selected root. A run without a local Blocks source uses `preparation: []` and the public `install.command` from each plan. Every `passed` value equals `exitCode === 0`, and each output hash matches its retained file.

A passing install also attests every unique `composition.files[]` target from the selected plans. `literal` targets resolve workspace-relative, `project-root` converts `~/.constructive/...` to `.constructive/...`, and `shadcn-alias` resolves `@alias/...` through the exact `components.json.aliases` value and the consumer's TypeScript/JavaScript path mapping. The consumer must use `base-nova`, TypeScript, and Lucide either explicitly or through shadcn's default. Each installed file must byte-match the planned source whose path is pinned by the aggregate registry and whose body is pinned by `registry-content.v1.json`; TypeScript and JavaScript files permit only the deterministic import-alias substitutions declared by `components.json`. Missing, fabricated, escaping, traversal, conflicting provenance, alias collisions, and symlinked paths fail the install stage.

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

Provide one result for every validated surface × installed feature pack. `manifestRef` must be exactly `.constructive/feature-packs/<featurePack>.json`, and the parsed sidecar must deep-equal the complete feature-pack manifest embedded in the immutable selected plan. A reconstructed minimal manifest or a correct manifest at another path is invalid.

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

Each `resolvedRef` uses this exact receipt schema:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-package-resolution",
  "name": "@constructive-io/data",
  "version": "0.2.0",
  "resolved": "http://127.0.0.1:4873/@constructive-io/data/-/data-0.2.0.tgz",
  "integrity": "sha512-<base64-digest>",
  "lockfileRef": "pnpm-lock.yaml",
  "lockfileSha256": "<pnpm-lock-sha256>",
  "tarballRef": ".constructive/harness/evidence/packages/constructive-data-0.2.0.tgz",
  "tarballSha256": "<tarball-sha256>",
  "packageJsonRef": "node_modules/@constructive-io/data/package.json",
  "packageJsonSha256": "<installed-package-json-sha256>"
}
```

`lockfileRef` is exactly `pnpm-lock.yaml`; its exact package resolution field must bind the name/version and tarball integrity. `tarballRef` retains the exact archive whose SHA-512 digest equals `integrity`, whose `package/package.json` matches the receipt, whose canonical termination contains two zero records followed only by zero block padding, and whose complete regular-file tree byte-matches the installed `node_modules/<name>` tree. Symlinks, special files, unsafe archive paths, duplicate files, trailing payloads, and unsupported archive entry types fail. External packages must match the exact version, SRI, and canonical npm tarball URL in the immutable `package-resolutions.v1.json` snapshot. When a pinned branch-only package appears in `release.packages`, its version, deterministic local-registry URL, and archive bytes must instead match the release entry and `.artifacts/npm` artifact from the pinned Blocks source.

Capture the archive during the install proof; do not repack `node_modules`. For branch-only first-party packages, copy the exact `.artifacts/npm/<package>-<version>.tgz` produced by `pack:local`. For external packages, retain the package-manager resolution's original distribution archive and URL, then verify its SRI before writing the receipt. One `pnpm-lock.yaml` reference may serve every receipt, but each package has its own retained tarball and exact installed tree.

### `blocks-check`

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-blocks-check-evidence",
  "headCommit": "<pinned-blocks-head>",
  "checkerSha256": "<canonical-checker-sha256>",
  "outputRef": ".constructive/harness/evidence/install/blocks-check.txt",
  "outputSha256": "<sha256-of-trimmed-stdout>",
  "passed": true
}
```

Run the canonical sibling checker with `--blocks-repo <pinned-blocks-worktree>` and without `--source-preflight`. Retain stdout at `outputRef` and hash its trimmed value. The harness reruns that full command, requires identical trimmed stdout, and independently retains the output file's byte hash. If a validated test fixture has no Blocks source, `headCommit`, `checkerSha256`, `outputRef`, and `outputSha256` must all be `null`; production branch-only runs use the pinned values.

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

Provide every validated application-owned domain route exactly once. `sourceRef` must be the exact Next.js App Router file: `/` maps to `src/app/page.tsx`, and any other normalized route maps to `src/app/<route.path>/page.tsx`. Its SHA-256 must match that retained workspace file.

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

Provide every domain route exactly once. The route/resource pair and contract version must match validation, `endpointKind` must be `data`, and `passed` must equal the conjunction of metadata, introspection, and reconciliation. The request outcome uses the metadata context key, operation, and check ID defined above and has the same pass result.

### `typecheck` and `build`

Use the same shape with the type-specific kind:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-typecheck-evidence",
  "command": "pnpm exec tsc --noEmit",
  "exitCode": 0,
  "outputRef": ".constructive/harness/evidence/static/typecheck.txt",
  "outputSha256": "<output-file-sha256>",
  "passed": true
}
```

Use `constructive.builder-build-evidence` for `build`. The typecheck command must exactly equal `verify.commands[0]` in every selected plan, the build command must exactly equal `verify.commands[1]`, and selected plans must agree. Output references and hashes must match retained files, and `passed` must equal `exitCode === 0`; a successful arbitrary command is not proof.

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

`tenantIds` must exactly cover the primary and isolation tenant IDs as a unique set. A pass must include every scenario assigned to the evidence type, repeat its exact actor IDs, and cover every assertion ID. Auth IDs resolve as `auth-check:<check-id>:<expected-state>`. Console feature assertions repeat the exact resolved contract object; assertions without a Blocks binding use `contract: null`. Every assertion gets its own scenario-context request and UI outcomes with the exact assertion check ID; a generic artifact reused by another scenario, actor/tenant scope, or assertion is invalid. A fail artifact may report a strict subset, but it must contain at least one failed assertion and every included result remains fully contextual.

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

Provide every validated target × viewport × state exactly once and repeat the full resolved target and viewport objects. Every result uses unique `screenshotRef` and `interactionRef` paths; reusing one desktop artifact for a mobile or unrelated state is invalid. `screenshotRef` receives structural evidence validation: the harness checks the PNG signature, one leading 13-byte IHDR, supported non-interlaced color/bit-depth combinations, a required palette for indexed color, non-empty consecutive IDAT chunks, one terminal IEND, every chunk CRC, exact-size inflation with filter bytes 0–4, and pixel dimensions `round(width × deviceScaleFactor)` by `round(height × deviceScaleFactor)`. This is an evidence-integrity check rather than full PNG rendering conformance; the browser capture remains the render proof. JPEG, WebP, header-only stubs, truncated chunks, unsupported critical chunks, invalid filters, and dimension-only files are rejected.

The referenced interaction outcome uses this exact shape:

```json
{
  "schemaVersion": 1,
  "kind": "constructive.builder-interaction-outcome",
  "targetKey": "surface|console|auth|desktop|ready",
  "viewportId": "desktop",
  "state": "ready",
  "contextCheck": {
    "id": "interaction:surface|console|auth|desktop|ready",
    "passed": true
  },
  "checks": [
    {
      "id": "keyboard-traversal",
      "passed": true
    },
    {
      "id": "focus-visibility",
      "passed": true
    },
    {
      "id": "overflow-containment",
      "passed": true
    },
    {
      "id": "diagnostics-containment",
      "passed": true
    },
    {
      "id": "action-feedback",
      "passed": true
    }
  ],
  "passed": true
}
```

Build `targetKey` as `surface|<surfaceId>|<featurePack>|<viewportId>|<state>`, `domain-route|<routeId>|<resource>|<viewportId>|<state>`, or `shell|<surfaceId>|<viewportId>|<state>`. `contextCheck` must be the passing exact `interaction:<targetKey>` binding. Every outcome checks keyboard traversal, visible focus, overflow containment, and diagnostics containment; viewports at or below 767 CSS pixels also check responsive navigation and touch targets, `error` checks retry/recovery, and `ready` or `populated` checks action feedback. The checks appear in that order and `passed` equals their conjunction.

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

Provide the same complete target × viewport × state set as `screenshot`; every result uses a unique `artifactRef` pointing to the exact contextual interaction-outcome schema above. For each combination, `artifactRef` must equal the screenshot manifest's `interactionRef`, so two individually valid manifests cannot be cross-bound to different outcome files.

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

Capabilities exactly cover validated surface/pack expectations in a passing report; `actual` is `ready`, `partial`, or `unavailable`, and a pass requires `actual === expected`. Capability outcomes use the exact capability context above. `scenarios` uses the contextual live result grammar and covers every validated scenario on pass. `limitations` always exactly covers source-attested limitations; repeat each ID/status and every mitigation requirement in source order, with one limitation-context outcome pair per requirement. A blocking limitation always remains false and prevents a pass. A require-mitigation result passes only when every requirement passes. Set `verdict` to the journal transition, `pass` or `fail`. A fail report may include only the capability/scenario results needed to demonstrate failure, but every included result remains exact and the limitation set remains complete.

## Retention and journal integrity

Every load re-hashes retained evidence and references, rejects duplicate or incomplete passed evidence-type sets, reruns their exact semantic validators, reruns the pinned source preflight, and reruns the full Blocks checker for retained `blocks-check` proof. This semantic replay is the enforcement boundary: editing evidence and recomputing the journal's unkeyed hashes does not make an invalid artifact acceptable.

Journal schema 3 gives every start, terminal, and invalidation event one unique contiguous global `sequence`. Replay reconstructs all stage statuses in that order, requires prior stages to pass before a stage starts, requires each terminal to close the active attempt, requires the replayed workspace baseline at every start, and requires invalidation to list the exact non-pending downstream stages with their prior statuses and attempt counts. Per-attempt and invalidation `previousHash`/`eventHash` chains, the immutable-input root, and the whole-journal SHA-256 bind ordinary history and detect stale or accidental edits. They do not provide cryptographic authenticity against a writer who can rewrite the journal and recompute unkeyed hashes; never describe the journal as tamper-proof.
