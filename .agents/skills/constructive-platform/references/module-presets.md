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

## Feature Flags / Toggles (future)

The shape reserves room for a `settings?` field to carry toggles like `app_settings_auth.allow_password_sign_up = false` or a read-only mode. Not implemented yet — presets today are module-list only.

## When to Pick Which

- Building a tool that already has auth (Clerk / Auth0 / Supabase Auth)? → `minimal`
- Shipping a consumer app this week? → `auth:email`, graduate to `auth:hardened` before launch
- Selling to teams / orgs? → `b2b`
- Demo / reference DB? → `full`
- Not sure? Start with `auth:email`, add modules as needed. Presets are a starting point, not a lock-in.
