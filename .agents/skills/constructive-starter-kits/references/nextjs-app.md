---
name: constructive-boilerplate-nextjs-app
description: Set up and develop with the Constructive App frontend boilerplate — a Next.js application with authentication, organization management, invites, members, and a per-DB GraphQL SDK architecture. Use when scaffolding a new Constructive frontend application from the boilerplate.
---

Set up and develop with the Constructive App frontend boilerplate — a Next.js application with authentication, organization management, invites, members, and a per-DB GraphQL SDK architecture.

## When to Apply

Use this skill when:
- Setting up a new Constructive frontend application from the boilerplate
- Working with the constructive-app template (auth, orgs, invites, members)
- Needing to understand the project structure, routes, or configuration
- Running or customizing the Constructive App boilerplate

## Overview

The Constructive App boilerplate is a **frontend-only** Next.js application that connects to a Constructive backend using a **per-database architecture**. It provides production-ready authentication flows, organization management, invite handling, member management, and account settings — all powered by three generated GraphQL SDKs (admin, auth, app).

## Setup

### 1. Clone the Boilerplate

Use `pgpm init` with the `-w` flag to scaffold a workspace from the template. All required arguments must be provided to avoid interactive prompts:

```bash
pgpm init -w \
  --repo constructive-io/sandbox-templates \
  --template nextjs/constructive-app \
  --name <workspace-name> \
  --fullName "<Author Full Name>" \
  --email "<author@example.com>" \
  --repoName <workspace-name> \
  --username <github-username> \
  --license MIT \
  --moduleName <module-name>
```

**Required arguments for non-interactive mode (avoid asking for user input):**

| Argument | Description |
|----------|-------------|
| `--name` | Workspace directory name |
| `--fullName` | Author's full name |
| `--email` | Author's email |
| `--repoName` | Repository name (typically same as workspace name) |
| `--username` | GitHub username |
| `--license` | License (MIT, APACHE-2.0, BSD-3-CLAUSE, etc.) |
| `--moduleName` | Module/package name inside the workspace |

The boilerplate is created at `<workspace-name>/packages/<module-name>/`.

> **Interactive mode (for humans):** Prompt will be asking for the arguments missing from the required arguments list:
> ```bash
> pgpm init -w --repo constructive-io/sandbox-templates --template nextjs/constructive-app
> ```

#### Adding to an Existing Workspace

If you already have a pnpm workspace (a directory with `pnpm-workspace.yaml`), use `pgpm init` **without** the `-w` flag to clone the boilerplate as a new module inside it. Run this from the **workspace root**:

```bash
pgpm init \
  --repo constructive-io/sandbox-templates \
  --template nextjs/constructive-app \
  --moduleName <module-name>
```

**Required arguments for existing workspace:**

| Argument | Description |
|----------|-------------|
| `--moduleName` | Module/package name for the new boilerplate |

This creates the module at `packages/<module-name>/` within your existing workspace. The workspace-level arguments (`--name`, `--fullName`, `--email`, etc.) are **not needed** since the workspace already exists.

> **Note:** You must run this from the workspace root or a valid `packages/` subdirectory. If you are not inside a pnpm workspace, pgpm will error with "Not inside a PNPM workspace." Use the `-w` flag (see above) to create a new workspace and module together.

> **Interactive mode (for humans):**
> ```bash
> pgpm init --repo constructive-io/sandbox-templates --template nextjs/constructive-app
> ```

### 2. Install Dependencies

```bash
cd <workspace-name>/packages/<module-name>
pnpm install
```

### 3. Configure Environment

Create `.env.local` from `.env.example`:

```bash
# Database name — REQUIRED
# This single value derives all GraphQL endpoints:
#   admin-{db}.localhost:3000  → organizations, members, permissions
#   auth-{db}.localhost:3000   → users, authentication
#   app-public-{db}.localhost:3000 → your business data
NEXT_PUBLIC_DB_NAME=your-db-name

# Optional: Override the default API port (default: 3000)
# NEXT_PUBLIC_API_PORT=3000

# Optional: Override individual endpoints (bypasses DB_NAME derivation)
# NEXT_PUBLIC_ADMIN_ENDPOINT=http://admin-mydb.localhost:3000/graphql
# NEXT_PUBLIC_AUTH_ENDPOINT=http://auth-mydb.localhost:3000/graphql
# NEXT_PUBLIC_APP_ENDPOINT=http://app-public-mydb.localhost:3000/graphql
```

### 4. Generate GraphQL SDK

The SDK must be generated against a running backend with your per-DB endpoints:

```bash
pnpm codegen
```

This runs `@constructive-io/graphql-codegen` using `graphql-codegen.config.ts` and outputs **three SDKs**:

| SDK | Output | Endpoint | Purpose |
|-----|--------|----------|---------|
| `admin` | `src/graphql/sdk/admin/` | `http://admin-{db}.localhost:3000/graphql` | Organizations, members, permissions, invites (44 tables) |
| `auth` | `src/graphql/sdk/auth/` | `http://auth-{db}.localhost:3000/graphql` | Users, emails, authentication (6 tables) |
| `app` | `src/graphql/sdk/app/` | `http://app-public-{db}.localhost:3000/graphql` | Your business data |

### 5. Start Development

```bash
pnpm dev
```

Opens at [http://localhost:3011](http://localhost:3011) by default.

## Backend Requirements

This boilerplate requires a running Constructive backend with per-DB endpoints. The easiest way is via **Constructive Hub**:

```bash
# Terminal 1: Start backend infrastructure
cd /path/to/constructive-hub
pnpm start

# Terminal 2: Start this frontend
cd /path/to/constructive-app
pnpm dev
```

Required backend services:

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Database with Constructive schema |
| GraphQL Server | 3000 | Per-DB endpoints (admin-*, auth-*, app-public-*) |
| GraphQL Server (Private) | 3002 | Admin operations |
| Job Service | 8080 | Background job processing |
| Email Function | 8082 | Email sending via SMTP |
| Mailpit SMTP | 1025 | Email server (development) |
| Mailpit UI | 8025 | View sent emails |

## Project Structure

```
src/
├── app/                        # Next.js App Router pages
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Home / org listing page
│   ├── login/                  # Login page
│   ├── register/               # Registration page
│   ├── forgot-password/        # Password reset request
│   ├── reset-password/         # Password reset form
│   ├── check-email/            # Email check prompt
│   ├── verify-email/           # Email verification
│   ├── invite/                 # Accept invite flow
│   ├── invites/                # Pending invites list
│   ├── account/                # Account management
│   │   └── settings/           # Account settings + theme
│   ├── settings/               # App settings
│   ├── users/                  # User management
│   ├── organizations/          # Organization listing page
│   └── orgs/
│       └── [orgId]/            # Org-scoped pages
│           ├── layout.tsx      # Org layout with sidebar
│           ├── activity/       # Org activity
│           ├── invites/        # Org invites management
│           ├── members/        # Org members management
│           └── settings/       # Org settings
├── components/
│   ├── ui/                     # UI components (26 files)
│   │   ├── stack/              # Stack card system (slide-in panels)
│   │   │   ├── stack-card.tsx
│   │   │   ├── stack-context.tsx
│   │   │   ├── stack-viewport.tsx
│   │   │   └── ...
│   │   ├── toast/              # Toast notifications
│   │   │   ├── toast-error.tsx
│   │   │   ├── toast-success.tsx
│   │   │   └── ...
│   │   ├── alert-dialog.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── table.tsx
│   │   └── ...
│   ├── auth/                   # Auth forms (login, register, reset, etc.)
│   ├── organizations/          # Org CRUD components
│   ├── invites/                # Invite management components
│   ├── members/                # Member management components
│   ├── account/                # Account settings components
│   ├── app-shell/              # Sidebar, navigation, layout shell
│   ├── layouts/                # Page layout wrappers
│   ├── settings/               # Settings UI
│   ├── shared/                 # Shared/reusable components
│   └── skeletons/              # Loading skeleton components
├── config/
│   └── branding.ts             # App name, logos, tagline, legal links
├── graphql/
│   ├── execute.ts              # GraphQL execution layer
│   ├── index.ts                # GraphQL exports
│   ├── typed-document.ts       # Typed document utilities
│   └── sdk/                    # Generated SDKs (via codegen)
│       ├── admin/              # Admin SDK (orgs, members, permissions)
│       │   ├── hooks/          # React Query hooks
│       │   ├── orm/            # ORM client
│       │   └── README.md
│       ├── auth/               # Auth SDK (users, emails)
│       │   ├── hooks/
│       │   ├── orm/
│       │   └── README.md
│       ├── app/                # App SDK (your business tables)
│       │   ├── hooks/
│       │   ├── orm/
│       │   └── README.md
│       └── README.md
├── hooks/                      # Shared React hooks
│   ├── use-character-limit.ts
│   ├── use-debounce.ts
│   ├── use-deferred-mutation.ts
│   ├── use-edit-value.ts
│   ├── use-file-upload.ts
│   ├── use-health-check.ts
│   ├── use-image-status.ts
│   ├── use-in-view.ts
│   ├── use-json-view-scroll.ts
│   ├── use-measure.ts
│   ├── use-mobile.ts
│   ├── use-mounted.ts
│   └── use-scroll-direction.ts
├── lib/
│   ├── auth/                   # Auth utilities and context
│   │   ├── auth-context.tsx
│   │   ├── auth-errors.ts
│   │   ├── route-guards.tsx
│   │   ├── token-manager.ts
│   │   └── ...
│   ├── gql/                    # GraphQL hooks and query factories
│   │   ├── hooks/
│   │   │   ├── admin/          # Admin hooks (orgs, invites, members)
│   │   │   └── auth/           # Auth hooks (login, register, etc.)
│   │   ├── error-handler.ts
│   │   └── query-error-boundary.tsx
│   ├── navigation/             # Route and navigation helpers
│   │   ├── sidebar-config.ts
│   │   ├── use-entity-params.ts
│   │   └── use-sidebar-navigation.ts
│   ├── permissions/            # Permission checking utilities
│   ├── constants/              # App constants
│   ├── logger/                 # Logging utilities
│   ├── runtime/                # Runtime configuration
│   │   ├── config-core.ts
│   │   ├── env-sync.ts
│   │   ├── get-runtime-config.ts
│   │   └── runtime-config.types.ts
│   ├── motion/                 # Animation configuration
│   ├── utils/                  # General utilities
│   ├── validation/             # Zod schemas and validation
│   ├── query-client.ts         # React Query client
│   ├── schema-context.tsx      # Schema context provider
│   └── slot.tsx                # Slot utility
├── store/                      # Client state management (Zustand)
│   ├── app-store.ts            # Main app store
│   ├── auth-slice.ts           # Auth state slice
│   ├── env-slice.ts            # Environment state slice
│   └── preferences-slice.ts    # User preferences slice
├── app-config.ts               # App-wide configuration
└── app-routes.ts               # Route definitions
```

## SDK Imports

The template provides path aliases for the three SDKs:

```typescript
// Your business data
import { useBoardsQuery, useCreateBoardMutation } from '@sdk/app';

// Users and authentication
import { useCurrentUserQuery, useSignInMutation } from '@sdk/auth';

// Organizations, members, permissions
import { useOrganizationsQuery, useOrgMembersQuery } from '@sdk/admin';
```

## Customization

### Branding

Edit `src/config/branding.ts` to customize:

```typescript
export const branding: BrandingConfig = {
  name: 'airpage',                    // App name
  tagline: 'powered by Constructive', // Tagline below brand name
  
  logo: '/logo.svg',                  // Logo mark (collapsed sidebar, auth)
  wordmark: '/wordmark.svg',          // Full wordmark (expanded sidebar)
  logoDark: null,                     // Dark mode logo override
  wordmarkDark: null,                 // Dark mode wordmark override
  
  companyName: 'Constructive',        // Legal footer company name
  legalLinks: [                       // Auth footer links
    { label: 'Disclaimer', href: '...' },
    { label: 'Privacy Policy', href: '...' },
  ],
  
  homePath: '/',                      // Logo link destination
};
```

### Adding UI Components

Components use the Constructive shadcn registry:

```bash
npx shadcn@latest add @constructive/<component>
```

Registry URL is configured in `components.json`. Components use Base UI primitives, Tailwind CSS 4, and cva for variants.

### GraphQL SDK Regeneration

After backend schema changes, regenerate the SDKs:

```bash
pnpm codegen
```

Config in `graphql-codegen.config.ts` derives endpoints from `NEXT_PUBLIC_DB_NAME`.

## Features

- **Authentication** — Login, register, logout, password reset, email verification
- **Organizations** — Create and manage organizations
- **Invites** — Send and accept organization invites
- **Members** — Manage organization members and roles
- **Account Management** — Profile, email verification, account deletion
- **App Shell** — Sidebar navigation, theme switching, responsive layout
- **Stack Cards** — Slide-in panel system for create/edit flows
- **Permissions** — Role-based access control for org features
- **State Management** — Zustand store with auth, env, and preferences slices

## Troubleshooting

- **GraphQL errors on startup**: Ensure the Constructive backend is running and `NEXT_PUBLIC_DB_NAME` in `.env.local` is correct
- **Empty SDK directory**: Run `pnpm codegen` with the backend running to generate the SDKs
- **Password reset emails not arriving**: Requires the full backend stack (job service + email function). Check Mailpit UI at `http://localhost:8025`
- **Port conflicts**: The frontend runs on port 3011 by default. The backend GraphQL server uses port 3000
- **SDK import errors**: Ensure path aliases (`@sdk/admin`, `@sdk/auth`, `@sdk/app`) are configured in `tsconfig.json`
