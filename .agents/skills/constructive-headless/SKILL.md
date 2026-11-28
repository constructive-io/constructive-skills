---
name: constructive-headless
description: Connect an agent, script, or backend to hosted Constructive devnet without Airpage, discover databases or tenant APIs, and choose the right skill or headless harness for building and operating an app. Also use it to work as an agent with the `constructive` CLI ("constructive --llms", "constructive status", "run as the agent", "--as", "CONSTRUCTIVE_AGENT", "setup agent", "constructive mcp"), where the person approves every change.
---

# Constructive Headless

## When to Apply

Use this skill to work with Constructive from Codex, Claude Code, a terminal, or CI. Start with the hosted devnet profile. Use the `constructive` CLI when it is on the PATH, and the terminal harness when a task needs its Pi build workflow.

## Install This Skill

```bash
npx skills add constructive-io/constructive-skills --skill constructive-headless -a claude-code
```

Use `-a codex` or `-a cursor` for those hosts, and add `-y` to skip the prompts. The `skills` CLI needs Node.js 22.20 or later.

## Connect

1. Read [devnet.env.example](devnet.env.example) for the public `launchql.dev` endpoints. Use the platform `auth` endpoint to verify identity and `api` to discover databases. Use the named `modules`, `agent`, and `compute` endpoints for their respective schemas.
2. Inject `CONSTRUCTIVE_DEVNET_PLATFORM_TOKEN` through the runner's secret store for platform calls. To obtain a first platform token, sign in via `npx --yes --package=@agentic-kit/cli -- agent login` (choose `devnet`), create an API key in the dashboard, or call `signIn` followed by `createApiKey` / `mintAccessToken` on `CONSTRUCTIVE_DEVNET_AUTH_ENDPOINT`. For tenant records, obtain the explicit tenant data and auth URLs from its provisioning result or trusted descriptor and inject `CONSTRUCTIVE_DEVNET_TENANT_TOKEN` for that realm. Record the target organization and database ID when the task is scoped to one. See [Constructive Principals](../constructive-principals/SKILL.md) for issuing scoped credentials.
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

## With the Constructive CLI

The `constructive` CLI (`@constructive-io/cli`, also installed as `cnc`) describes its own commands, so this skill does not list them.

1. **Act as your agent, from the first command.** Before you run anything, read the project's `.env`. A command acts as the signed-in person unless it says `--as <name>`. When the project's `.env` names an agent (`CONSTRUCTIVE_AGENT=<name>`), add `--as <name>` to every command you run, so that it uses the agent's own key and only what the person allowed the agent. The agent has its own key, which lasts 30 days. The CLI uses the key to get a short-lived token, keeps that token, and uses it again until it ends. Whoever holds the key can act as the agent until the key ends, the person renews it, or `agent remove` deletes the agent. When you report a result, say which identity ran it. `login`, `logout`, and the `context` and `agent` commands act as the person and refuse `--as`, so leave them to the person.
2. **Ask the CLI.** Run `constructive --llms` for the command index, and `constructive <command> --schema` for the JSON Schema of one command's input and output. `constructive <command> --help` gives its flags and examples, and `constructive help <topic>` explains environment, exit-codes, output, approval, agents, rules and files (`man constructive` has all of it on one page). Without a terminal, every command prints one JSON envelope, except `server`, `explorer` and `codegen`, which take their own flags and print their own output. In the envelope, `meta.next` lists the commands to run next: run each `argv` after you fill in its `placeholders`.
3. **Start with `constructive status`** (with `--as <name>` when the project names an agent). It names the backend, the account, the database bound to the directory, and the agent the project names. Its `meta.next` gives the command for whatever is missing.
4. **Read before you change.** Run `constructive schema show`, and `constructive access explain <table>` for a table's rules, before you change anything.
5. **Get the person's approval for each change.** A change prints its plan first. Without a terminal, it stops with exit 3 and puts the plan in `error.details.plan` and its id in `error.details.planId`. Show the plan to the person, and only after they approve it, run the step in `meta.next`: the same command with `--approve <id>`. It applies that plan and no other; if anything changed since, it stops with `plan-changed` and the new plan, which the person must see. `--dry-run` prints the plan and its id, and changes nothing. Do not use `--yes` for a person's approval: it applies whatever the plan is now.
6. **Give each new table a rule.** `table add` needs at least one `--rule`. Without one, it stops with exit 2, and its hint gives an owner-only example to copy. `constructive access types` lists the rule types in plain words.
7. **Let the MCP host ask.** `constructive mcp` marks each tool that writes, so that a host that supports it asks the person before every call. For a host that cannot ask, serve it with `--read-only`.

The person sets up a project once with `constructive setup agent`. It adds the agent, writes its name to `.env`, and gives each agent host its MCP entry. It does not install this skill.

## Choose the Next Guide

- [Capability map](references/capabilities.md) routes data, schema, frontend, auth, storage, publishing, compute, and agent tasks to their existing skills.
- [Headless harness and Airpage](references/harness.md) explains the terminal CLI, its devnet configuration, and how to build a first private table.
