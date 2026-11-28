---
name: cnc-execution-engine
description: Run raw GraphQL against Constructive APIs, and manage backend contexts and sign-in, with the cnc (constructive) CLI. Use when asked to "run a query", "execute GraphQL", "set up an API context", "sign in from the CLI", "switch backends", or when working with Constructive GraphQL APIs from a terminal.
compatibility: Node.js 22+, @constructive-io/cli (constructive-io/constructive)
metadata:
  author: constructive-io
  version: "2.0.0"
---

# CNC Execution Engine

`cnc` and `constructive` are the same binary (`@constructive-io/cli`). The examples use `constructive`, as its help and its next steps do. This page covers backend contexts, sign-in and raw GraphQL. For the exact commands of the installed version, ask the CLI: `constructive --llms` lists every command, `constructive <command> --help` shows its flags and examples, and `constructive <command> --schema` prints its input and output as JSON Schema. To work as an agent in a project, follow [With the Constructive CLI](../../constructive-headless/SKILL.md#with-the-constructive-cli).

## When to Apply

Use this page when:
- Running a GraphQL query or mutation against a Constructive backend from a terminal
- Adding, switching or removing backend contexts (dev, staging, prod)
- Signing in from the command line, or checking the session
- Finding a type or a field in the schema of a plane

## Quick Start

```bash
# Sign in: the password is prompted on a terminal. This stores the session and makes the backend the active context.
constructive login --api-endpoint https://api.example.com/graphql --email you@example.com

# Check the backend, the account and the bound database, then run a query
constructive status
constructive api query 'query { __typename }'
```

From a script or an agent, the password comes from stdin, never as a flag value:

```bash
printf %s "$PASSWORD" | constructive login --email you@example.com --password-stdin
```

## Contexts

A context is one backend: its api, auth, modules, agent and compute endpoints. Contexts are kept in the shared Constructive store (see [Store](#store)), so every Constructive program on the machine sees the same ones.

| Command | What it does |
|---------|--------------|
| `constructive context list` | List the contexts. One that lacks a plane shows `missing`, and `repair` names the command that fixes it. |
| `constructive context add <api-endpoint>` | Store a backend under the name of its domain (`api.example.com` is `example.com`), or under `--name`. For an api host that starts with `api.`, the other planes are derived (`auth.example.com`, …); for any other host, give each with `--auth-endpoint`, `--modules-endpoint`, `--agent-endpoint` and `--compute-endpoint`. It does not make the context active. |
| `constructive context use <name>` | Make a context the active one |
| `constructive context remove <name>` | Sign out of its stored session first, as `logout` does, then delete the context and the session. While agents of the person are filed under the context, it removes nothing (`context-in-use`), and its next steps remove each agent first. |

Any command takes `--context <name>` to use another context for one run, without switching. A context added again under the same name is replaced and keeps its session. A context that holds a session other endpoints issued is left as it is (`context-in-use`) until you sign out of it with `logout --context <name>`.

## Sign-in

| Command | What it does |
|---------|--------------|
| `constructive login --email <email>` | Sign in with email and password, make an API key that lasts 30 days, store it under the context, end the password sign-in, and make the backend the active context. `--api-endpoint` names the backend (default: `CONSTRUCTIVE_API_ENDPOINT`, else the context's). `--password-stdin` reads the password from stdin. |
| `constructive whoami` | Show the signed-in account, asking the backend once whether it accepts the credential. Exit 4 with `signed-out` or `credential-rejected` when no usable credential is stored. |
| `constructive status` | Show the backend, the account, the database bound to the directory, and the version the backend's server runs. It never fails for a missing piece: the data says what is missing, and `meta.next` names the command for it. |
| `constructive logout` | Revoke the API key at the backend that issued it, and remove the stored session, also when the key cannot be revoked. The person's agents keep their own keys; `agent remove <name>` ends one. |

Sign in again before the key ends: `whoami` and `status` warn when it ends within a week. No command takes a token as a flag value, and none prints a token.

## Raw GraphQL

`api query` and `api mutate` send a GraphQL document to a plane of the session backend, with the session credential.

| Command | What it does |
|---------|--------------|
| `constructive api query <query>` | Run a query. It only reads, so it runs at once. |
| `constructive api mutate <query>` | Run a mutation or a subscription. It is a change: it stops (exit 3) with the plan: the endpoint, the account, each root field with its arguments, and the variables, until it is approved. |
| `constructive api search <term>` | List the types and fields whose names hold the term, by introspection |
| `constructive api describe <name>` | Show a type with its fields (`Database`), a field (`Database.name`), or a root field (`databases`) |

The query is the text, `@file.graphql`, or `-` for stdin. `--variables` takes a JSON object, `@file.json` or `-`; give a secret in a variable through `-` or `@file`, never as text on the command line. `--operation-name` picks one operation of several. `--plane api|auth|modules|agent|compute` picks the plane (default: `api`).

```bash
constructive api query 'query { databases(first: 5) { nodes { id name } } }'
constructive api query @database.graphql --variables '{"id":"550e8400-e29b-41d4-a716-446655440000"}'
constructive api query 'query { currentUserId }' --plane auth
constructive api describe Database

constructive api mutate @change.graphql --dry-run   # the plan; nothing is sent
constructive api mutate @change.graphql --approve <id>  # after the person approves the plan; the id is in meta.next
```

## Output Format

On a terminal a command prints text, with a `Next:` block. Otherwise, or with `--json`, it prints one JSON envelope on stdout: `{"ok":true,"data":...,"meta":{...}}` on success, `{"ok":false,"error":{"code":...,"message":...,"hint":...},"meta":{...}}` on failure. `meta.next` lists the commands to run next; run each by its `argv`, after filling in its `placeholders`. `server`, `explorer` and `codegen` take their own flags and print their own output.

| Exit | Meaning |
|------|---------|
| 0 | Done |
| 1 | Failed: `error.code` says why, and `meta.next` holds the commands that help |
| 2 | Bad or missing input (a flag, a value or a command): nothing was changed |
| 3 | The change needs approval: nothing was changed, and the plan is in `error.details.plan`, its id in `error.details.planId` |
| 4 | Sign in first: the credential is missing, expired or rejected |
| 130 | Interrupted (Ctrl-C) |

## Common Workflows

### Working with Multiple Backends

```bash
# Each sign-in stores its backend as a context named after its domain, and makes it active
constructive login --api-endpoint https://api.dev.example.com/graphql --email you@example.com
constructive login --api-endpoint https://api.example.com/graphql --email you@example.com
constructive context list

constructive context use dev.example.com
constructive api query 'query { databases(first: 5) { nodes { id } } }'
constructive api query 'query { databases(first: 5) { nodes { id } } }' --context example.com
```

### Scripting

```bash
#!/bin/bash
# Query the databases of the active context and save the envelope
constructive api query 'query { databases(first: 100) { nodes { id name createdAt } } }' --json > databases.json
```

## Older cnc Commands

The older `cnc` commands are gone. Contexts and tokens stored under `~/.cnc` are not read or moved, so add each backend again.

| Older command | Now |
|---------------|-----|
| `cnc context create <name> --endpoint <url>` | `constructive context add <api-endpoint> --name <name>`, or `constructive login --api-endpoint <url>` |
| `cnc context current` | `constructive context list` or `constructive status` |
| `cnc context delete <name>` | `constructive context remove <name>` |
| `cnc auth set-token <token>` | `constructive login` (email and password; the CLI makes the key), or `CONSTRUCTIVE_USER_ID`, `CONSTRUCTIVE_ACCESS_TOKEN` and `CONSTRUCTIVE_API_ENDPOINT` for CI |
| `cnc auth status` | `constructive whoami` or `constructive status` |
| `cnc auth logout` | `constructive logout` |
| `cnc execute --query <q>` or `--file <path>` | `constructive api query <document>` or `constructive api mutate <document>`, with `@file` or `-` for stdin |

## Store

The store is `~/.constructive/`, or `<dir>/.constructive/` when `CONSTRUCTIVE_STASH_DIR=<dir>` is set. It holds the contexts, the active context, and the stored sessions and agent keys, in a directory that only your user can open. Change it through the commands, not by hand.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Not sure what is missing | `constructive status`: its data names the missing piece, and `meta.next` names the command for it |
| `signed-out` (exit 4) | `constructive login` |
| `credential-rejected` (exit 4) | The backend refused the stored credential: `constructive login` again |
| A context lacks a plane | `constructive context list` names the missing planes and the repair command |
| `context-in-use` (exit 1) | Run the steps in `meta.next` (`logout --context <name>`, or `agent remove <agent> --context <name>`), then the same command again |
| A change stopped with exit 3 | The plan is in `error.details.plan`: show it to the person, and once they approve it, run the `--approve <id>` step in `meta.next` |
| `plan-changed` (exit 3) | The plan changed after the person saw it: show them the new plan, then run its new `--approve <id>` step |
| `invalid-input` | Run the same command with `--schema` to see the input it takes |

## Environment Variables

These take the place of the stored session and context, for one run or a CI job. A variable that is wrong or missing stops every command with a message that names it.

| Variable | Description |
|----------|-------------|
| `CONSTRUCTIVE_API_ENDPOINT` | The backend to use; the other planes are derived from an `api.` host unless their own variable is set |
| `CONSTRUCTIVE_AUTH_ENDPOINT`, `CONSTRUCTIVE_MODULES_ENDPOINT`, `CONSTRUCTIVE_AGENT_ENDPOINT`, `CONSTRUCTIVE_COMPUTE_ENDPOINT` | Set one plane; each needs `CONSTRUCTIVE_API_ENDPOINT` |
| `CONSTRUCTIVE_USER_ID` and `CONSTRUCTIVE_ACCESS_TOKEN` | An account for CI; set both, with an optional `CONSTRUCTIVE_API_KEY`. They need `CONSTRUCTIVE_API_ENDPOINT`, so the credential goes only to the backend named next to it. |
| `CONSTRUCTIVE_STASH_DIR` | Moves the store out of the home directory, for tests and isolated runs, and turns off the update check |

A stored session goes only to the backend it was issued for. It never goes to a backend that `CONSTRUCTIVE_API_ENDPOINT` names, unless that variable names exactly the context's backend.

## References

- `constructive --llms` for the command index, `constructive <command> --help`, and `constructive <command> --schema`
- [constructive-headless](../../constructive-headless/SKILL.md) for working as an agent with the CLI: `--as`, plans and approvals, and MCP
- `cnc server`, `cnc explorer` and `cnc codegen`: [server-config.md](./server-config.md)
- The CLI's README: [packages/cli](https://github.com/constructive-io/constructive/tree/main/packages/cli) in constructive-io/constructive
- Related skill: [`constructive-codegen`](../../constructive-codegen/SKILL.md) for generating typed hooks and ORM
