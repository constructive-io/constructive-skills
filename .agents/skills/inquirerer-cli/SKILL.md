---
name: inquirerer-cli
description: "inquirerer CLI framework — interactive prompts, appStash state persistence, yanse terminal colors, and README formatting conventions. Use when building CLIs with inquirerer or formatting documentation. For pnpm workspace/publishing/monorepo management, see the constructive-pnpm skill instead."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# inquirerer CLI

Build interactive CLI tools with the inquirerer framework: prompts, appStash state persistence, yanse terminal colors, and documentation formatting.

## When to Apply

Use this skill when:
- Building interactive CLIs with `inquirerer`
- Formatting README and documentation files

**For pnpm workspace management, publishing, and monorepo configuration**, see the `constructive-pnpm` skill.

## inquirerer CLI Framework

Build interactive CLI tools with prompts, appStash state persistence, and yanse terminal colors.

See [inquirerer-cli.md](./references/inquirerer-cli.md) for the CLI framework guide.

## README Formatting

Consistent documentation formatting conventions for Constructive projects.

See [readme-formatting.md](./references/readme-formatting.md) for formatting rules.

## Reference Guide

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

- `constructive-pnpm` — PNPM workspace management, publishing, monorepo configuration
- `pgpm` — Uses pnpm workspaces for module management
- `constructive-starter-kits` — Boilerplate templates use these tools
