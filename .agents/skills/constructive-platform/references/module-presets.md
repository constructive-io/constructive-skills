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
  modules: (string | [string, Record<string, unknown>])[];  // module names or [name, options] tuples
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
| `b2b` | auth:hardened + orgs + invites + permissions + levels + profiles + hierarchy + user_settings | Multi-tenant SaaS |
| `b2b:storage` | b2b + file upload infrastructure (buckets, files, RLS) + user_settings | B2B with file uploads |
| `full` | everything — i18n, user_settings, storage, billing, notifications | Reference / demo DBs / greenfield |

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
    // modules is jsonb at the SQL layer; pass the preset modules directly
    modules: JSON.stringify(preset.modules),
    options: {},
    bootstrapUser: false, // set true if you also want an owner/user seeded
  },
  select: { id: true, databaseId: true, status: true },
}).execute();
```

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

Provisions AI agent infrastructure — threads, messages, tasks, prompts, resources, agents, personas. Supports jsonb tuple options:

| Configuration | Description |
|--------|-------------|
| `"agent_module"` | Bare install — threads, messages, tasks, prompts |
| `["agent_module", {"has_plans": true}]` | Adds `agent_plan` table, tasks belong to plans (thread → plan → task hierarchy), approval workflow fields |
| `["agent_module", {"has_resources": true}]` | Adds unified `agent_resource` table (kind: skill/knowledge/convention) with auto-chunking (ProcessChunks) and vector embeddings |
| `["agent_module", {"has_agents": true}]` | Adds `agent` + `agent_persona` tables. Implies `has_resources` (agents need resources to reference) |
| `["agent_module", {"has_plans": true, "has_resources": true, "has_agents": true}]` | Full agent stack — plans, resources, agent registry, personas |

**Resource configuration** (optional, via `resources` array):
```json
["agent_module", {"has_resources": true, "resources": [{"dimensions": 1536, "chunk_size": 500, "chunk_strategy": "sentence"}]}]
```
Defaults: 768 dimensions, 1000 chunk_size, 200 chunk_overlap, `"paragraph"` strategy, `["tsvector"]` search indexes.

**Scoping:** Supports `scope` option (`"app"`, `"org"`, etc.) for entity-level provisioning. The `generate:constructive` reference DB uses `["agent_module", {"has_plans": true, "has_resources": true, "has_agents": true, "scope": "org"}]`.

**Included in:** `full` preset (via `['all']` sentinel). Not included in other presets by default — add the desired variant to your module list.

**Note:** The old `has_knowledge` and `has_skills` flags are replaced by `has_resources`. The unified `agent_resource` table covers both via the `kind` column.

### `user_settings_module`

Creates a skeleton 1:1 `user_settings` table per user (`AuthzDirectOwner` RLS, SELECT + UPDATE only) in `users_public`. Other modules extend it by adding columns via `metaschema.create_field()`:

- `notifications_module` adds `notifs_enabled`, `notifs_default_digest_frequency`, `notifs_quiet_hours_*`, `notifs_default_channels`
- `i18n_module` will add `preferred_language`
- `user_auth_module` will add MFA preference columns

**Included in:** `b2b`, `b2b:storage`, `full` presets. Must be installed before `notifications_module` so that notification settings auto-resolve.

### `i18n_module`

Provisions app-level internationalization config:

- **`i18n_private` schema** — contains `app_settings_i18n` singleton (default_language, supported_languages, fallback_chain, is_enabled)
- **`i18n_public` schema** — public helpers
- Required for `DataI18n` blueprint nodes (translation tables)

**Included in:** `full` preset. Add `'i18n_module'` to your module list to enable in other presets.

## When to Pick Which

- Building a tool that already has auth (Clerk / Auth0 / Supabase Auth)? → `minimal`
- Shipping a consumer app this week? → `auth:email`, graduate to `auth:hardened` before launch
- Selling to teams / orgs? → `b2b`
- Demo / reference DB? → `full`
- Not sure? Start with `auth:email`, add modules as needed. Presets are a starting point, not a lock-in.
