---
name: constructive-harness
description: The Constructive harness workflow for hosts that supply the project templates and feature verification scripts. Covers project init, brief intake, build orchestration, and typed database/schema/codegen tools (provision_database, provision_blueprint, add_relation, add_policies, run_codegen). Load when choosing the next build step in a harness-driven project or before using its database, schema, or codegen tools.
metadata:
  author: constructive-io
  version: "1.0.0"
---

# constructive-harness — the harness build workflow

The workflow below requires a host that supplies the project templates and verification scripts for `.constructive/feature_list.json`. The published terminal CLI registers the shared tools but does not supply that bundle. If it is missing, skip the template-based init, file-writing brief intake, and orchestrator steps. Before provisioning a schema, capture the app summary, entities, fields, and relationships in your working notes from the user's request; ask for any missing details needed to define the schema. Use [references/tools.md](references/tools.md) for the tools registered by your host.

## Which reference to read

| Current state | Read |
|---|---|
| `.constructive/` missing in the project | [references/init.md](references/init.md) — lay down the harness skeleton, hand back |
| `.constructive/BRIEF.md` still the template stub | [references/brief-intake.md](references/brief-intake.md) — collect the brief, write BRIEF.md + per-entity feature rows |
| Deciding what to do next in a build | [references/build-orchestrator.md](references/build-orchestrator.md) — the `feature_list.json` state machine: pick the next feature, verify, mark status |
| Before any database/schema/codegen action, or choosing which tool fits a purpose | [references/tools.md](references/tools.md) — the typed tools, harness rule IDs, and the script-docs → tools bridge |

Typical flow: init → brief intake → orchestrator loop (each iteration: pick feature → tools reference for backend steps → verify → record).

## Ground rules (apply across all references)

- The typed tools are the ONLY supported path for database and schema work — never hand-write provisioning code, raw GraphQL mutations, blueprint plumbing, or ad hoc SQL.
- Mutating tools prompt the user for confirmation through the host automatically; never pre-ask in chat, and never re-issue a declined call in the same run.
- Backend processes are a remote dependency: never start/restart/kill/install them. A backend outage blocks only backend-dependent features — keep working everything else.
- Build state lives in `.constructive/` in the project directory; harness-internal data (skills, caches) is the host's concern, not yours.

## Related skills (canonical domain knowledge — link, don't restate)

- `constructive-blueprints` — blueprint/node-type semantics behind `provision_blueprint`
- `constructive-security` / `constructive-access-control` — Authz* policy semantics behind `add_policies`
- `constructive-gotchas` — platform-wide rule IDs (TS-001, CODEGEN-001, THRASH-001, …) cited by tool messages
- `constructive-troubleshooting` — symptom → fix recipes when a step fails
- `constructive-secrets-config` — secrets/KMS/API-key surface, email/site config, `.env` key map
- `constructive-frontend`, `constructive-data-modeling`, and the other domain skills for feature work
