# Phase 3: Frontend + SDK

**Goal:** Scaffold a Next.js frontend from the Constructive sandbox template and wire it to the
generated SDK. The boilerplate's `pnpm codegen` produces the complete SDK (admin + auth + app) in
place — there is **no standalone SDK step** on the mainline path.

> **Mainline numbering note:** this is mainline **Phase 3 (Frontend + SDK)**. Its automated gate is
> `./scripts/verify-phase.sh 2.6` (the externally-visible number that `verify-phase.sh` aliases
> internally — do not change it).

> **Speedrun shortcut:** [speedrun.md](./speedrun.md) S3+S4 collapse this whole phase into
> `pgpm init … nextjs/constructive-app` + `node scripts/wire-app.mjs --app <app> --sub <sub>` + the four
> S4 one-liners + `pnpm codegen`. This file is the detailed reference / hand-edit fallback.

## Phase 2.6: Create Frontend (Phase 3 step)

**Goal:** Scaffold a Next.js frontend from the Constructive sandbox template and wire it to the generated SDK.

> **You must use `pgpm init` to scaffold this.** Use the `nextjs/constructive-app` template from `constructive-io/sandbox-templates`.

| Step  | Skill | Repo |
| ----- | ----- | ---- |
| 2.6.1 | Next.js app scaffolding — see the `constructive-io/constructive` repo | public |
| 2.6.2 | app scaffolding (`pgpm init`) — see the `constructive-io/constructive` repo | public |
| 2.6.3 | pnpm-module patterns — see the `constructive-io/constructive` repo | public |
| 2.6.4 | `constructive-data-modeling` skill | public |

### What the Boilerplate Provides

The base sandbox template (auth:email tier) provides out of the box:

- Auth flows (login, register, logout, password reset)
- Account management
- App shell with sidebar
- GraphQL SDK codegen configuration for **Platform SDK**
- Dev server (start it on the canonical app port `3081` — `pnpm dev --port 3081`, per [speedrun.md](./speedrun.md) S8)

**It ships NO org/invite/member admin layer** — that is **opt-in (b2b tier)**, delivered via the registry
org blocks (`org-create-card`/`org-members-list`/`org-roles-editor`/`org-settings-form`) once you provision
the org modules (detect b2b via `flows.json` `backend.modules` carrying the org-scoped
`memberships`/`hierarchy` tuples). **Do not rebuild auth or account flows** — the base template handles
those; **do not hand-build org/member UI** — install the org blocks instead.

### Steps

**1. Scaffold the App:**

```bash
pgpm init --no-tty \
  --repo constructive-io/sandbox-templates \
  --template nextjs/constructive-app \
  --moduleName app \
  --fullName "Your Name" --email "you@example.com" \
  --username your-gh-handle --repoName my-workspace --license MIT
```

> **No branch pin needed — `main` is the tiered base now.** The auth:email tiering (the b2b org UI is
> opt-in via the registry org blocks; the template ships no dangling org route pages / `@sdk/admin` org
> hooks) is **MERGED to `sandbox-templates` main** (PR #25). So `pgpm init` against the GitHub default
> branch scaffolds the correct tiered template — the app codegens + builds clean with zero dangling org
> imports.
>
> **`--from-branch` is now an OPTIONAL explicit pin only.** Older guidance made `--from-branch feat/blocks`
> mandatory (back when `main` still shipped the full b2b org UI, whose ~24 `@sdk/admin` org symbols an
> `auth:email` codegen never emitted → 54 "Export X doesn't exist" `next build` errors). That branch is
> merged, so the flag is **redundant** on a normal build — drop it. Use `--from-branch <branch>` ONLY if
> you deliberately need to build against a specific in-flight template branch (the flag name is exactly
> `--from-branch` — `--ref`/`--branch` are silently ignored by `pgpm init`).

> **Important:**
> - **`pgpm init` unpacks the Next app into a NESTED `packages/app/`** (its `package.json` `name` is
>   **`constructive-boilerplate`**): `src/`, `tsconfig.json`, `next.config.ts`, `components.json`,
>   `package.json`, `.env*` all live **inside `packages/app/`**, alongside the `packages/provision`
>   sibling. The pnpm WORKSPACE ROOT (with `pgpm.json` + `pnpm-workspace.yaml`) is the parent. Below,
>   **`<app>`** = the app dir (`packages/app`). (An older scaffold put the app at the repo root; the toolkit
>   scripts — `verify-phase.sh` `app_rel()`, `wire-app.mjs` — auto-detect EITHER, so either layout verifies.)
> - **Same `--no-tty` + full-params rule as Phase 2.1** (the 🚨 callout in [phase-2-data-model.md](./phase-2-data-model.md)
>   / PGPM-001): `--yes` alone hangs with `ERR_USE_AFTER_CLOSE`. Pass `--no-tty` and fill every template
>   variable as a flag.

**2. Workspace registration — nothing to do.** The workspace-root `pnpm-workspace.yaml` already ships a
`packages/*` glob, which registers BOTH `packages/app` (the app) and `packages/provision`. Leave it as-is:

```yaml
packages:
  - 'packages/*'   # registers packages/app (the app) AND packages/provision
```

**3. Write Environment Configuration** — write `NEXT_PUBLIC_DB_NAME` to **BOTH `<app>/.env` and
`<app>/.env.local`** (copy the shipped `<app>/.env.example` → `<app>/.env.local` first). The single
scripted command `node scripts/wire-app.mjs --app <app> --sub <db>` writes the full per-DB env block to
both for you:

```bash
# Write the SAME line to both files in <app> (= packages/app):
#   <app>/.env          ← the codegen config loader reads this
#   <app>/.env.local    ← Next.js dev/runtime reads this
NEXT_PUBLIC_DB_NAME=<db>
```

> ⚠️ **`pnpm codegen` reads `.env`, not only `.env.local`.** The template's `graphql-codegen.config.ts`
> resolves `NEXT_PUBLIC_DB_NAME` via `@next/env`'s `loadEnvConfig(process.cwd())`, which (called with no
> `dev` arg) loads files in the order `.env.local`, `.env.production`, **`.env`** — and the value can be
> picked up from `.env`. If you write the var to `.env.local` only and codegen still throws
> `NEXT_PUBLIC_DB_NAME is required`, it is reading `.env`. **Write the line to both files** so codegen and
> the running app agree. (`.env` is the load-bearing one for codegen; `.env.local` is what `pnpm dev`
> reads. Keeping them identical avoids the whole class of "works in dev, fails in codegen" confusion.)

`NEXT_PUBLIC_DB_NAME` derives the per-DB endpoints automatically. Here `<sub>` is the
**subdomain == the database name with underscores** (e.g. db `my_app` → `my_app`):
- `admin-<sub>.localhost:3000` - Organizations, members, permissions
- `auth-<sub>.localhost:3000` - Users, authentication
- `api-<sub>.localhost:3000` - **Your business data (app DATA endpoint)** — it is `api-<sub>`,
  **NOT** `app-public-<sub>`. App-data reads/writes route on `api-<sub>`.

> 🚨 **The Host header drives routing — a URL override alone still 404s.** The server picks the
> per-DB schema from the **HTTP `Host` header**, not the path. Pointing codegen/runtime at a bare
> `api-<sub>.localhost:3000/graphql` URL is necessary but not sufficient: the request's `Host` must
> also be `api-<sub>.localhost`. The current template's `graphql-codegen.config.ts` **already honors
> `CODEGEN_APP_HOST` / `CODEGEN_APP_ENDPOINT`** (its `app` target defaults to `api-<DB_NAME>.localhost`
> for URL **and** Host), so the S3 env is enough; `wire-app.mjs` verifies the config still honors it and
> FAILS if not. For runtime use `NEXT_PUBLIC_APP_ENDPOINT` / `getAppEndpoint()` (see
> [blocks-onramp.md](./blocks-onramp.md)). Discover the real per-DB endpoints from
> `services_public.domains` (do not assume `app-public-`). If unsure, `curl` the candidate with an
> explicit `Host:` header and check for your table in the schema before trusting it. (F2.) See the
> endpoint map in [infra-setup.md](./infra-setup.md) and [architecture-overview.md](./architecture-overview.md).

**4. Codegen prerequisite is already DECLARED — install once, then run** (avoid "Unknown argument filter" error):

`node scripts/wire-app.mjs` (S3) already DECLARED `@constructive-io/graphql-codegen@latest` (the
`latest` dist-tag) in `<app>/package.json` `devDependencies` — and, for a blocks app,
`@constructive-io/ui` + `@simplewebauthn/browser` in `dependencies` — so you do **NOT** run a separate
`pnpm add` for them. The single `pnpm install` in step 5 below materializes them all in ONE resolve of
the heavy `@constructive-io/*` + graphile tree (separate `pnpm add` rounds re-resolve that whole tree
each time — the dominant warm-time sink). Just run codegen after that install:

```bash
# Run in <app> (= packages/app, where graphql-codegen.config.ts + .env live), AFTER step 5's pnpm install.
pnpm codegen   # reads NEXT_PUBLIC_DB_NAME from .env (and .env.local) — set both (step 3)
```

> ⚠️ **Must use codegen 4.21.2+** (older 4.9.0 throws `Unknown argument "filter"`). The declared
> `latest` dist-tag resolves to a current 4.21.2+ — the same version `pnpm add -D
> @constructive-io/graphql-codegen@latest` used to fetch; consolidating it into the up-front
> declaration only changes WHEN it installs, not which version.

This generates three SDKs (under `<app>/src/graphql/sdk/`):
- `<app>/src/graphql/sdk/admin/` - Admin operations
- `<app>/src/graphql/sdk/auth/` - Auth operations (6 tables)
- `<app>/src/graphql/sdk/app/` - Your business tables

**4a. Pin `graphql` to ONE version via a pnpm override (codegen prerequisite — F14).** This is a
**Phase 3 step**, not a Phase 4 one: the generated SDK and the codegen toolchain both depend on
`graphql`, and a second copy in the tree triggers the classic *"Cannot use GraphQLObjectType … from
another module or realm"* (dual-`graphql`) error — which surfaces as soon as you build the app with
the generated SDK, well before any blocks are installed. Set the override now so codegen and the app
build against a single `graphql`. In the **workspace root** `package.json`:

```jsonc
{
  "pnpm": {
    "overrides": {
      "graphql": "^16.9.0"   // pin to ONE version; match what the generated SDK uses
    }
  }
}
```

Set the override now; the single `pnpm install` in step 5 dedupes it. Confirm afterwards with `pnpm why
graphql` → exactly one resolved copy. (If you run the Blocks on-ramp, `@constructive-io/ui` also rides
this same single `graphql` — the on-ramp references this override rather than re-introducing it.)

**5. ONE install (materializes everything), then start:**

After the graphql override (4a) is set and wire-app (S3) has declared the codegen + blocks deps, run a
**single** `pnpm install` from the workspace root — it materializes ALL of them (graphql-codegen, and
for a blocks app `@constructive-io/ui` + `@simplewebauthn/browser`) in one resolve. Do **not** run
separate `pnpm add` rounds for those — that is the consolidation that keeps warm time under budget.

```bash
pnpm install         # from the workspace root — ONE install; materializes the deps wire-app declared
pnpm why graphql     # verify exactly one resolved graphql copy (the 4a override deduped)
pnpm codegen         # in <app> — now that graphql-codegen is installed (step 4)
pnpm dev             # in <app> (or `pnpm --filter constructive-boilerplate dev` from the workspace root)
```

### Phase 2.6 Checklist (Boilerplate only)

- **2.6.0** Consulted [troubleshooting.md](./troubleshooting.md) for Phase 2.6 (search for "Phase 2.6")
- **2.6.1** App was scaffolded via `pgpm init`
- **2.6.2** App scaffolded at `packages/app` (package `constructive-boilerplate`); the workspace-root `pnpm-workspace.yaml` `packages/*` glob already registers it alongside `packages/provision` — nothing to add (the toolkit auto-detects packages/app OR a root-level app)
- **2.6.3** `NEXT_PUBLIC_DB_NAME=<db>` written to **both** `.env` and `.env.local` (codegen reads `.env`; `pnpm dev` reads `.env.local`)
- **2.6.4** Codegen ran successfully (admin: 44 tables, auth: 6 tables, app: your tables)
- **2.6.4a** `graphql` pinned to ONE version via a workspace `pnpm.overrides` (`pnpm why graphql` → one copy) — codegen prerequisite (F14)
- **2.6.5** `pnpm install` succeeds
- **2.6.6** App starts without build errors (`pnpm dev` returns 200)
- **2.6.7** Run automated verification: `./scripts/verify-phase.sh 2.6`

> **After the `2.6` gate passes (Rule 7):** set `packages.app.path` + `frontend.env_written` (and the
> `codegen.*` fields) in the run-state, then `git commit` (tag `green-phase-3`).
