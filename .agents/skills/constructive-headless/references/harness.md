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

Choose `devnet` at login. This flow signs in to Constructive and creates a stored CLI API key. For CI or an isolated test, set `AGENT_HOME` to a dedicated state directory. The CLI accepts a separate model-provider credential through Pi. Use `agent` for interactive work and `agent -p '<prompt>'` for one-shot execution. Use an interactive or approval-capable host for operations that ask for confirmation.

For a runner with an existing scoped session, inject `CONSTRUCTIVE_USER_ID` and `CONSTRUCTIVE_ACCESS_TOKEN` together. The CLI accepts `CONSTRUCTIVE_API_KEY` as an optional additional credential. A bearer used for direct HTTP can be an API key alone. The CLI's environment path also needs the user ID and session access token. Set both CLI endpoints from the public profile. [CLI credential resolution](https://github.com/constructive-io/constructive/blob/main/agentic/cli/src/credentials.ts)

```bash
source "$skill_dir/devnet.env.example"
export CONSTRUCTIVE_API_ENDPOINT="$CONSTRUCTIVE_DEVNET_API_ENDPOINT"
export CONSTRUCTIVE_MODULES_ENDPOINT="$CONSTRUCTIVE_DEVNET_MODULES_ENDPOINT"
```

Pin skill sources when reproducibility matters via `AGENT_SKILLS_REPO` and `AGENT_SKILLS_PIN`.

For a program that drives Pi, `agent --mode rpc --no-session` accepts Pi RPC commands. The `0.19.51` wrapper emits plain-text startup messages on stdout before the RPC responses. Account for those lines when decoding its output.

## Match the available tools to the workflow

The terminal CLI loads a `constructive-skills` source and its local overlay. The Pi adapter registers the shared database tools. For a terminal build, follow the [Constructive Harness](https://github.com/constructive-io/constructive-skills/tree/main/.agents/skills/constructive-harness) workflow once those tools are registered. When moving a workflow from Airpage, check which tool calls and local project or chat features it depends on. Those capabilities depend on the host as well as the installed skills. [CLI tool registration](https://github.com/constructive-io/constructive/blob/main/agentic/cli/src/db-tools.ts)

The published CLI's shared toolset includes `provision_database`, `provision_blueprint`, `describe_schema`, `add_policies`, `add_records`, and `run_codegen`. If the host lacks `run_preflight`, run `devnet-check.sh probe` for network reachability and check the local CLIs your build needs. `describe_schema` reads the provisioned schema on the control plane. Inspect the tenant data endpoint separately to verify what it actually serves.

To qualify an Electron-free build, start from an empty checkout, provision a disposable devnet database with the supported typed tools, verify the served schema and one scoped CRUD flow, then build or publish the app as requested. Keep the generated environment binding with credentials out of version control. Record which host, skill revision, endpoints, and operations passed. Test any required Airpage-specific behavior separately.
