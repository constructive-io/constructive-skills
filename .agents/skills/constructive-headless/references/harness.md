# Headless execution and Airpage

## Choose the host

| Goal | Use |
| --- | --- |
| Use your own Codex, Claude Code, CI job, or backend | The [devnet profile](../devnet.env.example), direct GraphQL or SDK, and the existing domain skills |
| Run Constructive's typed database, blueprint, policy, record, and codegen tools from a terminal | [`@agentic-kit/cli`](https://github.com/constructive-io/constructive/tree/main/agentic/cli), which runs the Pi harness and registers the shared tools |
| Embed those tools in another agent host | [`@agentic-kit/db-tools`](https://github.com/constructive-io/constructive/tree/main/agentic/db-tools) for the tool definitions and [`@agentic-kit/harness`](https://github.com/constructive-io/constructive/tree/main/agentic/harness) for host contracts, skill resolution, and gates. The host must supply credentials, workspace context, and a way to decide approvals. |
| Run Codex or Claude on an enrolled Constructive machine | The [`constructive-agent-cli` adapter](https://github.com/constructive-io/constructive/tree/main/agentic/agent-cli) speaks the machine runner's stdio and approval protocol. It serves machine-bound runs. |

## Try the published terminal harness

```bash
npx --yes --package=@agentic-kit/cli -- agent help
npx --yes --package=@agentic-kit/cli -- agent skills list
npx --yes --package=@agentic-kit/cli -- agent login
```

Choose `devnet` at login. This flow signs in to Constructive and creates a stored CLI API key. For CI or an isolated test, set `AGENT_HOME` to a dedicated state directory. The CLI accepts a separate model-provider credential through Pi. Use an interactive or approval-capable host for operations that ask for confirmation.

```bash
npx --yes --package=@agentic-kit/cli -- agent
npx --yes --package=@agentic-kit/cli -- agent -p '<prompt>'
```

For a runner with an existing scoped session, inject `CONSTRUCTIVE_USER_ID` and `CONSTRUCTIVE_ACCESS_TOKEN` together. The CLI accepts `CONSTRUCTIVE_API_KEY` as an optional additional credential. A bearer used for direct HTTP can be an API key alone. The CLI's environment path also needs the user ID and session access token. Set both CLI endpoints from the public profile. [CLI credential resolution](https://github.com/constructive-io/constructive/blob/main/agentic/cli/src/credentials.ts)

```bash
source "$skill_dir/devnet.env.example"
export CONSTRUCTIVE_API_ENDPOINT="$CONSTRUCTIVE_DEVNET_API_ENDPOINT"
export CONSTRUCTIVE_MODULES_ENDPOINT="$CONSTRUCTIVE_DEVNET_MODULES_ENDPOINT"
```

Pin skill sources when reproducibility matters via `AGENT_SKILLS_REPO` and `AGENT_SKILLS_PIN`.

For a program that drives Pi, `npx --yes --package=@agentic-kit/cli -- agent --mode rpc --no-session` accepts Pi RPC commands. The `0.19.51` wrapper emits plain-text startup messages on stdout before the RPC responses. Account for those lines when decoding its output.

## Match the available tools to the workflow

The terminal CLI loads a `constructive-skills` source and its local overlay. The Pi adapter registers the shared database tools. The [Constructive Harness workflow](../../constructive-harness/SKILL.md) expects a host that materializes the project templates and registers `run_preflight`. For the published terminal CLI, use the standalone walkthrough below. It uses the shared tools directly. [CLI tool registration](https://github.com/constructive-io/constructive/blob/main/agentic/cli/src/db-tools.ts)

The published CLI's shared toolset includes `provision_database`, `provision_blueprint`, `describe_schema`, `add_policies`, `add_records`, and `run_codegen`. Run `devnet-check.sh probe` to check network reachability. `describe_schema` reads the provisioned schema on the control plane. Inspect the tenant data endpoint separately to verify what it actually serves.

## Build a first private table

1. In a clean checkout, use the approval-capable CLI to run `provision_database` for a disposable devnet database. Record its database ID and explicit auth and data endpoints. Keep the generated environment binding with credentials out of version control.
2. Run `describe_schema`, then use `provision_blueprint` with the registered tool schema. This example fits a standalone personal expense log. Each user owns their own rows. For membership-scoped data, choose an owner policy that also enforces membership. [Policy types](../../constructive-security/references/authz-types.md)
3. Verify `expenses` on the served data endpoint. Use a tenant user to create and read a test row, then verify a second tenant user and an anonymous client cannot read it. Build the frontend after the tenant flow works. Record which host, endpoints, and operations passed.

Example `provision_blueprint` input for the terminal CLI tool schema:

```json
{
  "name": "private_expenses",
  "description": "A standalone personal expense log.",
  "definition": {
    "tables": [
      {
        "table_name": "expenses",
        "fields": [{ "name": "description", "type": "text", "is_required": true }],
        "policies": [{ "$type": "AuthzDirectOwner", "data": { "entity_field": "owner_id" } }]
      }
    ]
  }
}
```
