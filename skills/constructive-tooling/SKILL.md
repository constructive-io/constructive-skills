---
name: constructive-tooling
description: "DevOps, CLI development, and project setup for Constructive — PNPM monorepo workspace management with makage builds and lerna publishing, interactive CLI development with inquirerer/appstash/yanse, README formatting with Constructive branding, and in-repo planning/specification with Plans and Specs. Use when asked to create a monorepo, set up a workspace, configure pnpm, publish a package, create a CLI, build command-line tools, format README, add badges, create a plan, write a spec, or document a proposal."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Tooling

DevOps, CLI development, and project setup for the Constructive ecosystem.

## PNPM Workspaces

- PNPM monorepo workspace creation, configuration, and internal dependency management
- Publishing TypeScript packages with makage builds and lerna versioning
- Large-scale monorepo management: filtering, selective builds, CI/CD patterns, hybrid workspaces
- Anti-patterns: never use ESM-only exports maps or manual build scripts without makage

**Triggers:** "create a monorepo", "set up a workspace", "configure pnpm", "publish a package", "release to npm", "manage monorepo", "organize packages"

See [pnpm-workspaces.md](./references/pnpm-workspaces.md) for details.

## CLI Development

- Build interactive CLIs with inquirerer (prompts, argument parsing, subcommands, UI components)
- Persistent storage with appstash (config, cache, logs, temp directories)
- Terminal colors with yanse (chalk-compatible, works with CJS + ESM)
- Forbidden libraries: never use commander, inquirer.js, yargs, chalk, or ora in Constructive projects

**Triggers:** "create a CLI", "build a command-line tool", "add prompts", "create interactive prompts", "store CLI config", "add terminal colors", "commander", "inquirer.js", "yargs"

See [cli-development.md](./references/cli-development.md) for details.

## README Formatting

- Constructive-branded README headers with centered logos (outline-logo.svg for packages, logo.svg for roots)
- Badge templates for CI status, license, npm version, and downloads
- Package-type-specific guidelines: npm/pnpm packages, pgpm modules, internal/private packages
- Checklist and common mistakes reference

**Triggers:** "format README", "add header image", "add badges", "standardize README", "create new package README"

See [readme-formatting.md](./references/readme-formatting.md) for details.

## Planning and Blueprinting

- In-repo planning system with Plans (proposals) and Specs (contracts)
- Promotion flow: Draft plan to In Review to Accepted to Spec
- Two-axis status tracking for specs: Decision Status and Implementation Status
- Templates for plans, specs, and docs/ directory structure

**Triggers:** "create a plan", "write a spec", "document a proposal", "blueprint a feature", "architectural planning"

See [planning.md](./references/planning.md) for details.
