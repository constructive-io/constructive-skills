# Harness runbook

Resolve the skill and pinned Blocks paths once. Every command then works from the app workspace rather than depending on the caller's current directory.

```bash
builder_skill_root=/absolute/path/to/constructive-builder
blocks_source=/absolute/path/to/pinned/blocks
```

## Freeze the source and brief

While Blocks is branch-only, validation requires a local source preflight. The canonical sibling `constructive-blocks` catalog and checker cannot be overridden. The source must remain at the exact clean tracked commit; a detached checkout of that commit is valid, the recorded branch is observational, and ignored generated registry artifacts do not affect the tracked-source gate.

```bash
node "$builder_skill_root/scripts/validate-brief.mjs" app-brief.json \
  --blocks-source "$blocks_source" \
  --output .constructive/harness/validation.json

node "$builder_skill_root/scripts/harness-state.mjs" init \
  --validation .constructive/harness/validation.json \
  --state .constructive/harness/run-state.json
```

Both output and state must remain beneath `.constructive/harness` through real directories. The commands reject absolute/parent traversal and symlink-parent escapes. Initialization re-hashes the brief, primary/isolation tenants, Blocks snapshot, selected plans, canonical source, metadata guidance, and complete workspace inventory.

## Execute stages in order

1. **brief** proves that the exact passing validation report is the frozen intent.
2. **tenant** proves all descriptors match the strict secret-free shape and their explicit endpoints are safely routable.
3. **install** retains selected compact plans, exact command output, installed sidecars, provenance for every npm dependency declared by those plans, and the full post-build Blocks checker result.
4. **domain** proves application routes use the attested 2026-07 `_meta` contract plus standard introspection.
5. **static** retains consumer typecheck and production-build output.
6. **live** proves Auth, every required capability/prerequisite, CRUD, and owner/peer/anonymous/revoked/cross-tenant behavior with exact source-contract machine reports.
7. **visual** retains a complete visual manifest plus screenshot and interaction artifacts for every target/view/state combination.
8. **acceptance** retains the independent evaluator's exact machine verdict for every capability, scenario, and applicable blocking/mitigation Blocks source limitation.

Start a stage before changing files. Passing requires every type listed below:

| Stage | Required evidence types |
| --- | --- |
| `brief` | `validation` |
| `tenant` | `tenant-contract`, `endpoint-check` |
| `install` | `install-plan`, `install-log`, `manifest`, `package-provenance`, `blocks-check` |
| `domain` | `source-check`, `meta-contract` |
| `static` | `typecheck`, `build` |
| `live` | `live-session`, `graphql`, `rls` |
| `visual` | `screenshot`, `interaction` |
| `acceptance` | `evaluator` |

Example:

```bash
state=.constructive/harness/run-state.json

node "$builder_skill_root/scripts/harness-state.mjs" start --state "$state" --stage tenant
node "$builder_skill_root/scripts/harness-state.mjs" pass --state "$state" --stage tenant \
  --evidence tenant-contract=.constructive/harness/evidence/tenant-contract.json \
  --evidence endpoint-check=.constructive/harness/evidence/endpoint-check.json
```

Evidence paths are workspace-relative regular files. The journal records their type, absolute path, SHA-256, size, and machine-report outcome references; every resume rechecks them and rejects missing, changed, or symlink-escaped artifacts.

Produce every artifact from [evidence-schemas.md](./evidence-schemas.md). It defines the exact keys, coverage sets, referenced request/UI/interaction outcomes, complete PNG requirements, and source/checker hashes accepted by the journal.

## Record failure and retry

A failure also needs at least one valid typed artifact:

```bash
node "$builder_skill_root/scripts/harness-state.mjs" fail --state "$state" --stage live \
  --reason "Cross-tenant read returned the owner's row." \
  --evidence rls=.constructive/harness/evidence/rls-failed.json

node "$builder_skill_root/scripts/harness-state.mjs" start --state "$state" --stage live
```

Attempts are append-only event streams. A retry creates a new attempt; it never overwrites prior duration, evidence, or failure reason. Current stage/run status is derived from start/pass/fail plus invalidation events rather than duplicated mutable flags. Event and whole-journal SHA-256 chains detect stale or accidental edits, but they are unkeyed and do not establish cryptographic authenticity. Exact semantic replay of every retained artifact is the enforcement boundary.

## Invalidate deliberate drift

Outside a running stage, the journal requires the workspace to match the last terminal baseline. If an intentional correction changes it, invalidate the earliest affected stage:

```bash
node "$builder_skill_root/scripts/harness-state.mjs" invalidate --state "$state" --stage static \
  --reason "The runtime integration changed after static proof."
```

Invalidation is the only mutation allowed to acknowledge out-of-stage workspace drift. It records the new content-inventory hash and resets the named/downstream statuses through derivation while preserving all attempt events. A changed brief, validation report, tenant input, Blocks contract, or pinned source requires a new validation and journal.

## Concurrency

Every mutation acquires `<state>.lock` atomically. If a writer crashes, inspect the lock's PID and timestamp before removing it; never delete a live writer's lock. `status` is read-only and still verifies inputs, retained evidence, and workspace continuity:

```bash
node "$builder_skill_root/scripts/harness-state.mjs" status --state "$state"
```

## Verify the skill itself

The package check requires the same canonical Blocks source gate:

```bash
node "$builder_skill_root/scripts/check.mjs" --blocks-source "$blocks_source"
```

The suite is limited to contract, state-machine, path, attestation, and security logic. Visual documentation components do not need unit tests.
