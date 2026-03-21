---
name: constructive-tooling
description: "Developer tools — pnpm workspace management (monorepo configuration, publishing, dependency management), inquirerer CLI framework (interactive prompts, appStash, yanse colors), and README formatting conventions. Use when configuring pnpm workspaces, building CLIs with inquirerer, or formatting documentation."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Tooling

Developer tools for Constructive projects: pnpm workspace management, CLI building, and documentation formatting.

## When to Apply

Use this skill when:
- Configuring pnpm workspaces and monorepo settings
- Managing workspace dependencies and publishing
- Building interactive CLIs with `inquirerer`
- Formatting README and documentation files

## pnpm Workspace Management

Configure and manage pnpm monorepo workspaces — `pnpm-workspace.yaml`, dependency management, publishing with Lerna.

See [pnpm-workspace.md](./references/pnpm-workspace.md) for workspace configuration.

## inquirerer CLI Framework

Build interactive CLI tools with prompts, appStash state persistence, and yanse terminal colors.

See [inquirerer-cli.md](./references/inquirerer-cli.md) for the CLI framework guide.

## README Formatting

Consistent documentation formatting conventions for Constructive projects.

See [readme-formatting.md](./references/readme-formatting.md) for formatting rules.

## Reference Guide

### pnpm

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [pnpm-workspace.md](./references/pnpm-workspace.md) | pnpm workspace overview | Setting up monorepo, workspace configuration |
| [pnpm-monorepo-management.md](./references/pnpm-monorepo-management.md) | Monorepo management | Cross-package dependencies, workspace protocol |
| [pnpm-publishing.md](./references/pnpm-publishing.md) | Publishing packages | Lerna versioning, npm publishing |

### CLI

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [inquirerer-cli.md](./references/inquirerer-cli.md) | inquirerer CLI framework | Building interactive CLI tools |
| [inquirerer-cli-building.md](./references/inquirerer-cli-building.md) | CLI building patterns | Command structure, argument parsing |
| [inquirerer-appstash.md](./references/inquirerer-appstash.md) | appStash state management | Persisting CLI state between runs |
| [inquirerer-yanse.md](./references/inquirerer-yanse.md) | yanse terminal colors | Colored output, styling |
| [inquirerer-anti-patterns.md](./references/inquirerer-anti-patterns.md) | Anti-patterns to avoid | Common mistakes in CLI building |

### Documentation

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [readme-formatting.md](./references/readme-formatting.md) | README conventions | Formatting standards, structure |

## Cross-References

- `pgpm` — Uses pnpm workspaces for module management
- `constructive-starter-kits` — Boilerplate templates use these tools
