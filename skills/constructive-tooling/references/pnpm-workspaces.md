# Constructive PNPM

PNPM monorepo workspaces, publishing with makage, and large-scale monorepo management following Constructive conventions. This skill covers the full lifecycle of TypeScript/JavaScript package development in PNPM workspaces.

## When to Apply

Use this skill when:
- **Creating workspaces:** Setting up new PNPM monorepos, configuring workspace structure
- **Managing packages:** Internal dependencies, filtering, selective builds, dependency updates
- **Publishing:** Building with makage, versioning with lerna, publishing to npm
- **Scaling:** Organizing large codebases, CI/CD patterns, build optimization

## Quick Start

```bash
# Create workspace
mkdir my-workspace && cd my-workspace
pnpm init

# Configure workspace
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'packages/*'
EOF

# Create a package
mkdir -p packages/my-lib/src
cd packages/my-lib && pnpm init

# Install dependencies
cd ../.. && pnpm install

# Build all packages
pnpm -r run build
```

## Workspace Structure

```text
my-workspace/
├── .eslintrc.json
├── .gitignore
├── .prettierrc.json
├── lerna.json
├── package.json            # private: true, pnpm -r scripts
├── packages/
│   ├── package-a/
│   │   ├── package.json
│   │   ├── src/
│   │   └── tsconfig.json
│   └── package-b/
│       ├── package.json
│       ├── src/
│       └── tsconfig.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Core Configuration

### Root package.json

```json
{
  "name": "my-workspace",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "pnpm -r run build",
    "clean": "pnpm -r run clean",
    "test": "pnpm -r run test",
    "lint": "pnpm -r run lint",
    "deps": "pnpm up -r -i -L"
  }
}
```

Key: root is always `private: true`, scripts use `pnpm -r` for recursive execution.

### Internal Dependencies

```json
{
  "dependencies": {
    "my-other-package": "workspace:*"
  }
}
```

When published, `workspace:*` is replaced with the actual version number.

## Publishing with Makage

Constructive publishes from `dist/` folder using makage to prevent tree-shaking into weird import paths.

### Package Configuration

```json
{
  "name": "my-package",
  "version": "0.1.0",
  "main": "index.js",
  "module": "esm/index.js",
  "types": "index.d.ts",
  "publishConfig": {
    "access": "public",
    "directory": "dist"
  },
  "scripts": {
    "clean": "makage clean",
    "build": "makage build",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "makage": "0.1.10"
  }
}
```

### Anti-Pattern: ESM-Only with Exports Map

**NEVER use the `exports` map pattern** — it breaks CommonJS consumers, exposes `dist/` in import paths, and is incompatible with dist-folder publishing.

### Anti-Pattern: Manual Build Scripts

**NEVER use manual build scripts** with rimraf/copyfiles — makage handles all of this automatically.

### Deep Nested Imports

Deep nested imports via file path are fully supported and recommended for tree-shaking:

```typescript
import { OrmClient } from '@my-org/sdk/api';
import { AdminClient } from '@my-org/sdk/admin';
```

## Publishing Workflow

```bash
# 1. Build and test
pnpm install && pnpm -r run build && pnpm -r run test

# 2. Version (interactive)
pnpm lerna version

# 3. Publish
pnpm lerna publish from-package
```

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm -r run build` | Build all packages |
| `pnpm -r run test` | Test all packages |
| `pnpm --filter <pkg> run <cmd>` | Run in specific package |
| `pnpm --filter <pkg>... run <cmd>` | Run in package and dependencies |
| `pnpm add <dep> --filter <pkg>` | Add dependency to package |
| `pnpm add <dep> -w` | Add dependency to root |
| `pnpm up -r -i -L` | Interactive dependency update |
| `pnpm lerna version` | Version packages |
| `pnpm lerna publish from-package` | Publish packages |

## Filtering and Selective Builds

```bash
pnpm --filter my-app run build           # Single package
pnpm --filter my-app... run build         # Package + dependencies
pnpm --filter "...[origin/main]" run build # Changed since main
pnpm --filter "!my-legacy" run build      # Exclude package
```

## Troubleshooting Quick Reference

| Issue | Quick Fix |
|-------|-----------|
| Package not found after publish | Ensure `publishConfig.directory` is `"dist"` |
| Types not found | Ensure `types` points to declaration file |
| ESM import errors | Ensure `module` points to ESM build |
| Dependency resolution issues | `pnpm store prune && rm -rf node_modules && pnpm install` |
| Workspace link issues | `pnpm why <package-name>` |

## Reference Guide

Consult these reference files for detailed documentation on specific topics:

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [constructive-pnpm-workspace.md](constructive-pnpm-workspace.md) | Workspace creation and configuration | Setting up a new monorepo, configuring pnpm-workspace.yaml, TypeScript config |
| [constructive-pnpm-publishing.md](constructive-pnpm-publishing.md) | Publishing with makage and lerna | Building packages, dist-folder pattern, versioning, npm publishing |
| [constructive-pnpm-monorepo-management.md](constructive-pnpm-monorepo-management.md) | Large monorepo management | Filtering, selective builds, dependency management, CI/CD patterns, hybrid workspaces |

## Cross-References

Related skills (separate from this skill):
- `pgpm` (`references/workspace.md`) — SQL module workspaces (PGPM uses pnpm under the hood)
- `pgpm` (`references/publishing.md`) — Publishing pgpm modules to npm
- `constructive-boilerplate-pgpm-init` — Workspace initialization templates
