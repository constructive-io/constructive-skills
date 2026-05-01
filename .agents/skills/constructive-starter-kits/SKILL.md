---
name: constructive-starter-kits
description: "Scaffold new Constructive projects using pgpm init — workspace/module templates (PGPM and PNPM variants), Next.js app boilerplate, custom template repositories, and boilerplate authoring. Use when asked to create a new project, scaffold a workspace, set up a Next.js app, or author custom boilerplate templates."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Starter Kits

All project scaffolding templates for Constructive, powered by `pgpm init`. Create workspaces, modules, and full-stack applications from boilerplate templates.

## When to Apply

Use this skill when:
- Scaffolding a new workspace or module with `pgpm init`
- Setting up a Constructive Next.js frontend application
- Using custom template repositories
- Authoring new boilerplate templates
- Setting up non-interactive `pgpm init` for CI/CD

## Quick Start

```bash
# Create a PGPM workspace + module
pgpm init -w

# Create a Next.js app from template
pgpm init -w --repo constructive-io/sandbox-templates --template nextjs/constructive-app

# Create a pure TypeScript workspace
pgpm init workspace --dir pnpm
```

## Available Templates

| Template | Command | Description |
|----------|---------|-------------|
| PGPM workspace | `pgpm init workspace` | Monorepo with pgpm.json, migrations support |
| PGPM module | `pgpm init` | Database module with pgpm.plan, .control file |
| PNPM workspace | `pgpm init workspace --dir pnpm` | Pure PNPM workspace (no pgpm files) |
| PNPM module | `pgpm init --dir pnpm` | Pure TypeScript package |
| Next.js App | `pgpm init -w --repo constructive-io/sandbox-templates -t nextjs/constructive-app` | Full-stack Constructive frontend |

## Reference Guide

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [references/pgpm-init.md](references/pgpm-init.md) | `pgpm init` command reference | Using templates, flags, non-interactive mode, custom repos |
| [references/nextjs-app.md](references/nextjs-app.md) | Constructive Next.js app boilerplate | Setting up frontend app, project structure, auth flows, SDK generation |
| [references/authoring-templates.md](references/authoring-templates.md) | Custom boilerplate authoring | Creating `.boilerplate.json`, placeholder system, question config, resolvers |

## Cross-References

- `pgpm` — Database migrations and module management (what you do after scaffolding)
- `constructive-graphql` — Code generation and SDK usage (used by the Next.js app boilerplate)
- `constructive-platform` — Platform core, deployment, server configuration
