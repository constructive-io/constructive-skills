---
name: constructive-auth
description: "Identity, login, sessions, MFA, devices, identity linking — auth flow (sign-up/sign-in/JWT), auth settings (MFA, anonymous sessions, CAPTCHA, cookie auth, rate limits), device settings (tracking, trusted devices, approval gate), identity linking (link_identity, account collision resolution, allow_link_by_email, primary auth method), and service-level auth config. Use when asked to 'sign up', 'sign in', 'auth flow', 'MFA', 'magic link', 'passkeys', 'device approval', 'trusted devices', 'session management', 'cookie auth', 'anonymous sessions', 'CAPTCHA', 'rate limits', 'bootstrap user', 'JWT', 'link identity', 'identity linking', 'account collision', 'allow_link_by_email', 'primary auth method', 'connected accounts', or when working with authentication."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Auth

Identity, authentication, and session management for Constructive apps.

## When to Apply

Use this skill when:
- Implementing sign-up / sign-in flows (email+password, magic link, OAuth, passkeys)
- Configuring MFA (TOTP, email OTP, SMS, backup codes)
- Managing device tracking, trusted devices, and device approval gates
- Configuring session behavior (cookie auth, cross-origin tokens, expiry)
- Setting up rate limiting and CAPTCHA
- Understanding the JWT structure and auth endpoints
- Linking multiple identity providers to a single account
- Handling account collision (OAuth email matches existing user)

## Auth Flow

```
1. Sign up    → authDb.mutation.signUp({ input: { email, password } })
2. Sign in    → authDb.mutation.signIn({ input: { email, password } })
                 → returns { accessToken, userId }
3. Use token  → Authorization: Bearer <accessToken>
```

```typescript
import { createClient as createAuthClient } from '@constructive-db/sdk/auth';

const authDb = createAuthClient({ endpoint: 'http://auth.localhost:3000/graphql' });

// Sign up
await authDb.mutation.signUp(
  { input: { email, password } },
  { select: { ok: true, errors: true } }
).execute();

// Sign in
const result = await authDb.mutation.signIn(
  { input: { email, password } },
  { select: { result: { select: { accessToken: true, userId: true } } } }
).execute();
const { accessToken, userId } = result.signIn.result;
```

See [auth-flow.md](./references/auth-flow.md) for full endpoint details, JWT structure, and bootstrap user setup.

## Auth Settings

`app_settings_auth` singleton table controls all authentication behavior:

- **MFA framework:** `require_mfa`, `allow_totp_mfa`, `allow_email_mfa`, `allow_sms_mfa`, `allow_backup_codes`, `step_up_window`, `mfa_challenge_expiry`
- **Anonymous sessions:** `allow_anonymous_sessions` for CSRF/cart flows
- **CAPTCHA:** `enable_captcha` + `captcha_site_key`
- **Cookie auth:** `enable_cookie_auth` for browser-based sessions
- **Cross-origin:** `cross_origin_token` for multi-domain setups
- **Rate limits:** `rate_limit_meters_module` for throttling

See [auth-settings.md](./references/auth-settings.md) for the full settings reference.

## Device Settings

`devices_module` provisions device tracking with three independent toggles:

| Toggle | Effect |
|--------|--------|
| `enable_trusted_devices` | Recognized devices skip MFA |
| `require_mfa_new_device` | Force MFA on unrecognized devices |
| `require_device_approval` | Block sign-in until email approval |

Toggles compose independently — all three can be on simultaneously.

See [device-settings.md](./references/device-settings.md) for the composition matrix and SDK usage.

## Service-Level Auth Config

Service settings control CORS, database connections, API routing, RLS, WebAuthn, and public key configuration at the service level.

See [service-settings.md](./references/service-settings.md) for the full service settings reference.

## Authentication Methods

| Method | Required Modules |
|--------|-----------------|
| Email + password | `user_auth_module` + `emails_module` |
| Magic link | `session_secrets_module` + `emails_module` |
| OAuth / SSO | `identity_providers_module` + `connected_accounts_module` |
| Passkeys (WebAuthn) | `webauthn_credentials_module` + `webauthn_auth_module` |
| Phone / SMS | `phone_numbers_module` |

## Identity Linking

Users can **link** multiple auth providers (Google, Facebook, password, phone) to one account. One method is **primary** (signs in by default); others are linked for identity purposes.

Two toggles control the system:
- **`allow_link_by_email`** (per provider) — offer linking when OAuth email matches an existing account
- **`enforce_primary_auth_method`** (app-wide) — lock sign-in to the user's primary method

See [identity-linking.md](./references/identity-linking.md) for the full flow diagrams, error codes, data model, and SDK usage.

## References

| File | Content |
|------|---------|
| [auth-flow.md](./references/auth-flow.md) | Auth endpoints, JWT structure, bootstrap user |
| [auth-settings.md](./references/auth-settings.md) | MFA, anonymous sessions, CAPTCHA, cookie auth, rate limits |
| [device-settings.md](./references/device-settings.md) | Device tracking, trusted devices, approval gate |
| [service-settings.md](./references/service-settings.md) | CORS, database, API, RLS, WebAuthn, pubkey settings |
| [identity-linking.md](./references/identity-linking.md) | Identity linking flow diagrams, account collision resolution, toggles, data model |

## Cross-References

- **Module presets (which auth modules are included):** [`constructive-blueprints`](../constructive-blueprints/SKILL.md)
- **Security policies (Authz* types):** [`constructive-security`](../constructive-security/SKILL.md)
- **Entity memberships and invites:** [`constructive-entities`](../constructive-entities/SKILL.md)
- **Read-only API keys (`accessLevel`):** [`constructive-security` → read-only-access.md](../constructive-security/references/read-only-access.md)
- **API keys & agent identities (principals):** [`constructive-principals`](../constructive-principals/SKILL.md)
