# Module Presets

Curated bundles of Constructive modules for common app shapes. Presets are metadata only — the TS object carries docs and the module list; passing `preset.modules` to `provision_database_modules(v_modules => ...)` is what installs them.

## Where They Live

- **TS source:** `constructive/packages/node-type-registry/src/module-presets/` (one file per preset)
- **Package export:** `@constructive-io/node-type-registry` → `allModulePresets`, `getModulePreset(name)`, `ModulePreset`
- **Narrative reference (which modules are optional vs load-bearing):** `constructive-db/docs/architecture/module-presets.md`

## Preset Shape

```ts
interface ModulePreset {
  name: string;          // 'auth:email', 'b2b', ...
  display_name: string;
  summary: string;       // one-line "what is this"
  description: string;   // longer narrative: when / why / tradeoffs
  good_for: string[];    // concrete "use this if..."
  not_for: string[];     // concrete "don't use this if..."
  modules: string[];     // flat module name list
  includes_notes?: Record<string, string>;  // per-module rationale
  omits_notes?: Record<string, string>;     // per-skipped-module rationale
  extends?: string[];    // informational: "composes from these presets"
}
```

## Catalog

| Preset | Shape | Typical Use |
|--------|-------|-------------|
| `minimal` | users + sessions + rls + secrets | Upstream identity (no server-side auth) |
| `auth:email` | email/password, single tenant | Hobby / first-week MVP / internal tools |
| `auth:email+magic` | auth:email + magic-link / email-OTP | Passwordless consumer apps |
| `auth:sso` | auth:email + OAuth + connected accounts | B2B / federation |
| `auth:passkey` | auth:email + WebAuthn | Phishing-resistant auth |
| `auth:hardened` | rate limits + SSO + passkeys + SMS + magic links | Production consumer auth |
| `b2b` | auth:hardened + orgs + invites + permissions + levels + profiles + hierarchy | Multi-tenant SaaS |
| `full` | `['all']` sentinel | Reference / demo DBs / greenfield |

## Usage

Look up the preset, then insert a `databaseProvisionModule` row via the ORM. The BEFORE-INSERT trigger creates the database and installs the modules listed in `modules`:

```ts
import { getModulePreset } from '@constructive-io/node-type-registry';
import { db } from './orm'; // codegen'd ORM for the public target

const preset = getModulePreset('auth:email');
// preset.modules → ['users_module', 'sessions_module', 'emails_module', ...]

const row = await db.databaseProvisionModule.create({
  data: {
    databaseName: 'my_app',
    domain: 'example.com',
    subdomain: 'app',
    // modules is text[] at the SQL layer; serialize the preset as a PG array literal
    modules: `{${preset.modules.join(',')}}`,
    options: {},
    bootstrapUser: false, // set true if you also want an owner/user seeded
  },
  select: { id: true, databaseId: true, status: true },
}).execute();
```

`preset.includes_notes` and `preset.omits_notes` carry per-module rationale — use them to render CLI help, scaffolder prompts, or docs.

## Notable Standalone Modules

Some modules can be added individually to any preset. These are not bundled into a specific preset but provide opt-in capabilities:

### `realtime_module`

Provisions shared infrastructure for realtime subscriptions:

- **`subscriptions_public` schema** — houses per-table subscriber tables created by the `DataRealtime` node type
- **Partitioned `change_log` table** — durable, time-partitioned event stream for change tracking. Uses PostgreSQL native range partitioning with automatic partition lifecycle management (creation, rotation, cleanup)
- **`emit_change()` trigger function** — called by statement-level triggers on source tables to record changes and emit NOTIFY signals

**Included in:** `full` preset (via `['all']` sentinel). Not included in other presets by default — add `'realtime_module'` to your module list to enable.

**Runtime toggle:** `database_settings.enable_realtime` and `api_settings.enable_realtime` control whether the server activates realtime processing. API setting takes precedence over database setting.

See [realtime-subscriptions.md](./realtime-subscriptions.md) for the full SDK guide on using `DataRealtime` in blueprints.

### `devices_module`

Provisions device tracking, trusted device MFA bypass, and device approval gate:

- **`app_settings_device` singleton** — six settings controlling device behavior (`enable_device_tracking`, `enable_trusted_devices`, `device_trust_duration`, `require_mfa_new_device`, `require_device_approval`, `max_devices_per_user`)
- **`auth_user_devices` table** — per-user device records (token hash, IP, user agent, trust/approval status)
- **`approve_device` procedure** — validates email approval tokens for the device approval flow

**Included in:** `full` preset (via `['all']` sentinel). Not included in other presets by default — add `'devices_module'` to your module list to enable.

**Settings toggles:** All features are off by default (`enable_device_tracking = true` enables passive tracking only). Enable `enable_trusted_devices` for MFA bypass, `require_device_approval` for email approval gate, `require_mfa_new_device` to force MFA on new devices.

See [device-settings.md](./device-settings.md) for the full composition matrix and SDK usage.

### `agent_module`

Provisions AI agent infrastructure — threads, messages, tasks, prompts. Supports colon-separated presets to enable optional features:

| Preset | `has_plans` | `has_knowledge` | Description |
|--------|-------------|-----------------|-------------|
| `agent_module` | false | false | Bare install — threads, messages, tasks, prompts |
| `agent_module:plans` | true | false | Adds `agent_plan` table, tasks belong to plans (thread → plan → task hierarchy), approval workflow fields |
| `agent_module:knowledge` | false | true | Adds `agent_knowledge` + chunks table with pgvector HNSW + BM25 indexes for RAG |
| `agent_module:full` | true | true | Plans + knowledge combined |

**Included in:** `full` preset (via `['all']` sentinel). Not included in other presets by default — add the desired variant to your module list.

**Note:** `:knowledge` and `:full` require `pg_textsearch` for BM25 indexes. The `generate:constructive` reference DB uses `:plans` (no BM25 dependency).

## Feature Flags / Toggles (future)

The shape reserves room for a `settings?` field to carry toggles like `app_settings_auth.allow_password_sign_up = false` or a read-only mode. Not implemented yet — presets today are module-list only.

## When to Pick Which

- Building a tool that already has auth (Clerk / Auth0 / Supabase Auth)? → `minimal`
- Shipping a consumer app this week? → `auth:email`, graduate to `auth:hardened` before launch
- Selling to teams / orgs? → `b2b`
- Demo / reference DB? → `full`
- Not sure? Start with `auth:email`, add modules as needed. Presets are a starting point, not a lock-in.
