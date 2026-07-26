# Verification contract

Each layer proves a different claim. A registry install proves code placement, metadata proves schema facts, introspection proves executable shape, and authenticated requests prove grants and RLS. Keep those claims separate.

## Static and install proof

Run every command from the selected compact Blocks plan, then the consumer typecheck and production build. The install stage must retain:

- the exact attested plan for each selected root;
- output for every exact local preparation and install command from the branch-only local-consumption recipe;
- every unique planned consumer file, resolved through literal, project-root, or exact `components.json` alias semantics and content-matched to its pinned generated registry source;
- installed `.constructive/feature-packs/*.json` manifests that deep-equal the immutable plan manifests;
- package-manager receipts for every unique npm dependency declared by the attested plans, bound through an immutable external-resolution snapshot or pinned first-party Blocks artifact, the exact `pnpm-lock.yaml` resolution field, a retained integrity-matching tarball, and the exact installed package tree;
- the retained stdout and result of the full post-build `constructive-blocks` checker, which verifies ignored aggregate bytes and prebuilt compact inspector plans.

The source preflight used during brief validation is deliberately narrower and cannot replace post-build proof.

[evidence-schemas.md](./evidence-schemas.md) is the producer contract for every required stage type. Its key sets, result coverage, referenced artifacts, commands, source hashes, and pass/fail relationships are enforced exactly; prose summaries in this file do not relax them.

## Metadata and capability proof

For domain routes, activate `constructive-frontend` and follow `references/meta-forms.md`, then activate `constructive-orm` and follow `references/query-meta-introspection.md`. Against the explicit data endpoint:

1. Execute `META_CONTRACT_INTROSPECTION_DOCUMENT` from `@constructive-io/data` and call `assertMetaContract`.
2. Execute `META_DOCUMENT` and call `assertMetaQuery` for contract `2026-07`.
3. Run standard GraphQL introspection against the same endpoint.
4. Reconcile public roots, arguments, inputs, enums, filters, ordering, pagination, and payloads before building an operation.
5. Use authenticated reads and writes to establish effective authority.

For Console packs, compare runtime readiness with every exact `consoleModuleBindings` alternative selected in the brief, including prerequisite contracts. The resolved surface/pack expectation stores its verification profile and adapter sources/requirements once; each live assertion carries the compact selected alternative ID, verification-profile ID, endpoint, and evidence contract. Required fields, paired roots, and metadata/introspection requirements therefore cannot collapse into endpoint-kind or root-name inference. For standalone Data, prove the host's `SheetsConfig`, explicit data endpoint, exact tenant database ID, CSRF-compatible session mode, and default/custom execute/adapter contract. For other standalone packs, prove the host resource/policy/action state. An unexpected degraded state fails acceptance.

## Machine live evidence

The `live` stage accepts three exact JSON kinds:

- `constructive.builder-live-session-evidence` covers every auth scenario.
- `constructive.builder-graphql-evidence` covers every feature and CRUD scenario.
- `constructive.builder-rls-evidence` covers every RLS scenario.

Each has `schemaVersion: 1`, the exact primary plus isolation `tenantIds`, and `results`. A result names one validated `scenarioId`, exactly repeats its `actorIds`, and provides every expected assertion as:

```json
{
  "id": "operation:update:deny",
  "passed": true,
  "contract": null,
  "requestRef": ".constructive/harness/evidence/requests/peer-update.json",
  "uiRef": ".constructive/harness/evidence/ui/peer-update.json"
}
```

`contract` is null for CRUD, RLS, observations, and other assertions without a Blocks binding. Auth and Console feature assertions instead repeat the exact resolved `{ role, capability, alternativeId, verificationProfileId, endpointKind, evidence }` object selected from the pinned binding; changing an alternative, profile, coordinate, required field, evidence type, or endpoint makes the machine report invalid. Both references must be real workspace-contained files with the exact scenario/assertion/actor/tenant context key and assertion check ID. The journal validates every reference use, so a generic successful request or UI artifact cannot prove another assertion. It rejects missing, changed, symlink-escaped, duplicated, unexpected, failed, or incomplete pass evidence. A fail transition uses the same exact kind, may cover only the failed subset, and must contain at least one failed assertion.

CRUD proof includes create/read/update/delete plus reload persistence through the declared application route. RLS proof includes exact outcomes for same-tenant owner, distinct same-tenant peer, anonymous, revoked session, and a real second tenant descriptor/session. Any denied mutation needs a follow-up read proving storage remained unchanged; a hidden control or empty list is not enough.

## Visual proof

Inspect every `acceptance.visual.targets[]` entry at desktop and mobile using the resolved immutable viewport definitions. The `screenshot` evidence is an exact `constructive.builder-visual-evidence` manifest with one result for every target × viewport × state and fields `{ target, viewport, state, passed, screenshotRef, interactionRef }`; `viewport` repeats the full `{ id, width, height, deviceScaleFactor, colorScheme }` object. Screenshot and interaction paths are unique per contextual result, and the separate `interaction` manifest must bind each combination to the same exact outcome path named by `interactionRef`. Each outcome separates its passing `interaction:<targetKey>` context binding from explicit behavior checks: keyboard traversal, visible focus, overflow and diagnostics containment for every result; responsive navigation and touch targets at widths up to 767 CSS pixels; retry/recovery for `error`; and action feedback for `ready` or `populated`. Screenshots receive structural PNG evidence checks for a valid signature, one leading IHDR, supported non-interlaced color/bit-depth, indexed palette presence, consecutive non-empty IDAT, terminal IEND, CRCs, exact-size inflation, filters 0–4, and exact viewport pixel dimensions. The browser capture supplies rendering conformance.

## Evaluator evidence

The independent evaluator writes `constructive.builder-acceptance-evidence` with `schemaVersion: 1`, exact `tenantIds`, `capabilities`, `scenarios`, `limitations`, and `verdict`.

Each capability repeats its validated `(surfaceId, featurePack, expected)`, records `actual`, `passed`, and request/UI references. A passing report requires `actual === expected` for every pack. A failing report may record a valid mismatched actual state with `passed: false`, so unexpected degradation remains executable evidence instead of an unrepresentable error.

Scenario entries use the same exact result grammar as live evidence and cover every validated scenario. Limitation entries contain exact `id`, `status`, `passed`, and ordered `requirements`. Each requirement exactly repeats its stable snapshot ID and records `{ "id", "passed", "requestRef", "uiRef" }`; missing, failed, reordered, duplicated, or invented requirements invalidate a pass. A `blocking` limitation must remain false and prevents a pass verdict. A `require-mitigation` limitation is true only when every retained requirement result passes. Failed acceptance may record either kind false. The current Console Data nested-store limitation is blocking; every Data surface also proves that only one `SheetsProvider` is active while locale and logger remain process-wide. Fail-closed routing and false-ready discovery limitations use requirement-level evidence when their source contract allows it.

Give the evaluator only the validated brief, running URL, safe account/session references, and required artifacts. Do not supply the builder transcript or preferred verdict.
