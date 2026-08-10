---
name: constructive-builder
description: Assemble and verify a Constructive tenant frontend from an already-provisioned tenant database using the current Blocks feature packs and Console Kit. Use when an agent must choose a strict Blocks composition, bind a secret-free tenant descriptor and session, install current roots, add application-owned metadata-driven routes, resume a journaled run, or prove capability, auth, CRUD, RLS, responsive, and visual behavior end to end.
---

# Constructive Builder

Assemble a tenant-scoped frontend and prove that it works. This skill orchestrates decisions, installation, integration, and acceptance; `constructive-blocks` owns registry roots, install plans, source limitations, Console runtime contracts, and local-consumption instructions.

## Keep the boundary exact

- Consume an already-provisioned Constructive tenant. Do not provision databases, choose PostgreSQL modules, run a scaffold engine, repair services, or patch `constructive-db`.
- Use one strict `frontend.composition`: a matching preset, the complete Console, the zero-pack Console core, selected Console modules, or individually mounted standalone packs. Builder validates composition rules; Blocks supplies each root and plan.
- Derive backend preset eligibility and preset-root matching from the pinned Blocks `backendPresetRouting` contract. `blank` has no preset root and instead permits explicit core/module composition; a custom backend also cannot claim a preset root. The complete `console-kit-nextjs` may target any preset or custom Constructive tenant because unsupported packs remain explicitly partial or unavailable.
- Accept only explicit, secret-free tenant descriptors. Never derive sibling hosts, add operator headers, put credentials in the brief, or treat `_meta`/introspection as authorization.
- Keep domain routes outside feature packs. Packs own platform capabilities; the application owns product-specific resources and workflows.
- Keep credentials in the session boundary, outside Zustand and props. A host Console session must carry the same `databaseId` as the descriptor and must own its declared CSRF and callback handlers.
- Preserve every applicable `sourceLimitations` record selected from the pinned composition, feature pack, surface, and runtime mode. A `blocking` record can never pass; `require-mitigation` records need retained passing evidence for every snapshot requirement. The current Console Data nested-store record is blocking until Blocks unifies Sheets state through the modular Console store, and every Data surface must prove the single-active-`SheetsProvider` mitigation while locale and logger remain process-wide.

## Require executable inputs

Start from [the canonical brief](./fixtures/app-brief.template.json) and [app-brief.md](./references/app-brief.md). Require:

1. An app identity and safe workspace path.
2. A tenant provenance discriminant: a backend preset from `backendPresetRouting` or a custom composition receipt plus capability handoff.
3. One strict frontend composition and its runtime session/binding handoff.
4. The exact primary tenant descriptor, explicit non-secret Auth CSRF policy when an Auth endpoint exists, and a second secret-free descriptor/session handoff for cross-tenant checks.
5. Application-owned domain routes, expected per-surface capability states, explicit actors, executable scenarios, and visual targets.
6. A pinned local Blocks worktree while the current release is branch-only.

Reject `flows`, `required_flows`, `registryRoot`, `registryRoots`, module unions outside `console-modules`, and Dashboard-era bindings. There is no compatibility mode.

## Run the harness

Resolve the loaded skill directory instead of assuming the current directory:

```bash
builder_skill_root=/absolute/path/to/constructive-builder
blocks_source=/absolute/path/to/pinned/blocks
```

1. **Validate and attest intent.** Write the report only under the app workspace's `.constructive/harness` directory. The validator checks the strict brief, all tenant descriptors, safe endpoint URLs, preset/composition alignment, source-attested readiness bindings, acceptance coverage, the portable Blocks plans, and the Blocks source preflight.

   ```bash
   node "$builder_skill_root/scripts/validate-brief.mjs" app-brief.json \
     --blocks-source "$blocks_source" \
     --output .constructive/harness/validation.json
   ```

2. **Initialize append-only run state.** Journal initialization accepts only that passing report and rechecks every input hash and workspace baseline.

   ```bash
   node "$builder_skill_root/scripts/harness-state.mjs" init \
     --validation .constructive/harness/validation.json \
     --state .constructive/harness/run-state.json
   ```

3. **Install from current plans.** Activate `constructive-blocks`, query each validated root, retain the compact plan, follow the branch-only local-consumption recipe, and save the full post-build Blocks checker output during the install stage. Retain package-manager provenance for every npm dependency named by the attested plans and bind it to the pinned Blocks commit while `publicRegistryReady` is false; never silently resolve an unrelated public version. Builder owns composition validation; do not attribute multi-root rejection to Blocks.

4. **Bind runtime ownership.** For Console, implement exactly the briefed internal-auth or host-session discriminant, one pinned verification profile per surface/pack expectation, and every per-capability alternative ID selected from `consoleModuleBindings`. The chosen endpoint kind establishes routing, while the attested alternative, adapter verification group, and live assertion establish readiness. For standalone Data, pass the host's `SheetsConfig`, explicit data endpoint, session mode, and default/custom `execute` or adapter boundary, and mount only one active `SheetsProvider` per browser runtime. Data in `standalone-auth` session mode also requires an explicit Auth endpoint and exact tenant `databaseId`; reject that Data mode when the tenant requires Auth CSRF because Sheets has no CSRF bootstrap seam. Prefer embedded host sessions because the pinned standalone token behavior is source-attested separately. Every non-Data standalone pack uses `host-resources`: the host supplies resources, states, policies, actions, and session references, while the pack owns neither discovery nor endpoint resolution.

5. **Build domain routes through current metadata guidance.** Activate `constructive-frontend` and read `references/meta-forms.md`, then activate `constructive-orm` and read `references/query-meta-introspection.md`. Use this exact 2026-07 sequence from the locally attested Blocks `@constructive-io/data` package: execute `META_CONTRACT_INTROSPECTION_DOCUMENT`, call `assertMetaContract`, execute `META_DOCUMENT`, call `assertMetaQuery`, run standard GraphQL introspection against the same explicit endpoint, reconcile operations, then prove effective authority with authenticated requests. The validator derives and hashes both guidance files; the brief does not duplicate their names or version.

6. **Advance typed stages.** Follow [runbook.md](./references/runbook.md). Start a stage before changing the workspace, then pass or fail it with the required `type=relative/path` evidence. Live and evaluator evidence are exact machine-readable reports covering the validated tenant IDs, actors, scenarios, assertions, outcomes, and artifact references.

7. **Recover through evidence.** Use [recovery.md](./references/recovery.md). If deliberate edits occur outside a running stage, invalidate the affected stage; invalidation acknowledges the new reproducible workspace baseline without deleting attempt history.

## Definition of done

Finish only when every stage derives `passed` from its attempt events, every Console shell and installed `(surfaceId, featurePack)` pair has exact desktop/mobile visual coverage, every ready/partial required capability and prerequisite has live source-contract evidence, CRUD persists after reload, and owner/peer/anonymous/revoked/cross-tenant outcomes match the brief with request plus UI proof. A blocking limitation still prevents acceptance; a require-mitigation limitation passes only when the evaluator retains affirmative evidence for the snapshot's exact mitigation requirements.

## Resources

- [app-brief.md](./references/app-brief.md) — strict composition, tenant/session, capability, actor, and scenario grammar.
- [runbook.md](./references/runbook.md) — source preflight, typed stages, event journal, locking, and commands.
- [verification.md](./references/verification.md) — machine evidence and end-to-end proof requirements.
- [evidence-schemas.md](./references/evidence-schemas.md) — exact JSON, file-reference, structural PNG, and semantic replay contract for every stage proof type.
- [recovery.md](./references/recovery.md) — frontend-only failure classification and safe invalidation.
- [tenant-database.template.json](./fixtures/tenant-database.template.json) and [tenant-database.isolation.template.json](./fixtures/tenant-database.isolation.template.json) — exact secret-free descriptor examples.

Use data-modeling or security skills only when the user separately authorizes backend design. This harness verifies a tenant's behavior without changing its backend.
