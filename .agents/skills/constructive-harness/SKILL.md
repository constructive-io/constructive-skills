---
name: constructive-harness
description: The Constructive harness workflow — building an app under the harness host (desktop, CLI, or other adapters of @agentic-kit/harness). Covers project init (.constructive/ bootstrap), brief intake (BRIEF.md + feature_list.json), the build-orchestrator state machine, and the typed database/schema/codegen tools (provision_database, provision_blueprint, add_relation, add_policies, run_codegen, run_preflight, field/template/record tools). Load when working in a harness-driven Constructive project — at session start, when .constructive/ is missing or the brief is empty, when choosing the next build step, or before any database, schema, or codegen action.
metadata:
  author: constructive-io
  version: "1.0.0"
---

# constructive-harness — the harness build workflow

You're in a project driven by the Constructive harness: the host registers typed database tools and tracks build progress in `.constructive/feature_list.json`. This umbrella skill routes the whole workflow; read only the reference that matches the current state.

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
