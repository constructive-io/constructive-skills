---
name: constructive-headless
description: Connect an agent, script, or backend to hosted Constructive devnet without Airpage, discover databases or tenant APIs, and choose the right skill or headless harness for building and operating an app.
---

# Constructive Headless

## When to Apply

Use this skill to work with Constructive from Codex, Claude Code, a terminal, or CI. Start with the hosted devnet profile. Use the Constructive CLI harness when a task needs its typed build tools and approval flow.

## Connect

1. Read [devnet.env.example](devnet.env.example) for the public `launchql.dev` endpoints. Use the platform `auth` endpoint to verify identity and `api` to discover databases. Use the named `modules`, `agent`, and `compute` endpoints for their respective schemas.
2. Inject `CONSTRUCTIVE_DEVNET_PLATFORM_TOKEN` through the runner's secret store for platform calls. For tenant records, obtain the explicit tenant data and auth URLs from its provisioning result or trusted descriptor and inject `CONSTRUCTIVE_DEVNET_TENANT_TOKEN` for that realm. Record the target organization and database ID when the task is scoped to one. See [Constructive Principals](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-principals) for issuing scoped credentials.
3. Use a short-lived or read-only credential where appropriate. Send it as an HTTPS `Authorization: Bearer` header to its configured endpoints. Keep the credential out of the profile, prompts, and logs.

Airpage's standard tenant routes use `api-<name>.launchql.dev` and `auth-<name>.launchql.dev`. Tenant descriptors can also declare custom hosts. Use the explicit URL before sending credentials.

## Verify Access

Resolve the skill's directory before running the helper. It requires Bash, curl, jq, and HTTPS access to devnet.

```bash
skill_dir=/absolute/path/to/constructive-headless
bash "$skill_dir/scripts/devnet-check.sh" probe
bash "$skill_dir/scripts/devnet-check.sh" whoami
bash "$skill_dir/scripts/devnet-check.sh" databases
```

Start with `probe` to check GraphQL reachability. When `CONSTRUCTIVE_DEVNET_PLATFORM_TOKEN` is available, use `whoami` to verify identity before calling `databases`, which returns the first five visible databases plus pagination information. If the token is missing, report the required variable and which checks you completed. An empty list can reflect row-level permissions. For clients without a shell, use the [HTTP API examples](references/api-access.md).

## Choose the Next Guide

- [Capability map](references/capabilities.md) routes data, schema, frontend, auth, storage, publishing, compute, and agent tasks to their existing skills.
- [Headless harness and Airpage](references/harness.md) explains the terminal CLI, its devnet configuration, and how to build a first private table.
