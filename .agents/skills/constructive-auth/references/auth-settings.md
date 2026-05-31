# Auth Settings Reference

Comprehensive reference for authentication and session configuration in the Constructive platform. All settings live on the `app_settings_auth` singleton table, provisioned by `sessions_module`.

All examples below use the codegen'd ORM. No raw SQL.

---

## MFA / 2FA Framework

Seven toggles on `app_settings_auth` control multi-factor authentication:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `require_mfa` | boolean | `false` | Require all users to set up MFA |
| `allow_totp_mfa` | boolean | `true` | Allow TOTP authenticator app MFA |
| `allow_email_mfa` | boolean | `true` | Allow email code MFA |
| `allow_sms_mfa` | boolean | `false` | Allow SMS code MFA |
| `allow_backup_codes` | boolean | `true` | Allow backup code generation |
| `step_up_window` | interval | `30 minutes` | How long a step-up verification remains valid |
| `mfa_challenge_expiry` | interval | `5 minutes` | How long an MFA challenge token remains valid after password verification |

### Enabling MFA via ORM

```ts
import { db } from './orm';

// Enable mandatory MFA with TOTP + email, 15-min step-up window
await db.appSettingsAuth.update({
  where: { id: settingsId },
  data: {
    requireMfa: true,
    allowTotpMfa: true,
    allowEmailMfa: true,
    allowSmsMfa: false,
    allowBackupCodes: true,
    stepUpWindow: '15 minutes',
    mfaChallengeExpiry: '5 minutes'
  }
});
```

---

## Anonymous Sessions

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `allow_anonymous_sessions` | boolean | `true` | Enable anonymous sessions (useful for CSRF protection and shopping carts) |

Anonymous sessions create a session record with `user_id = NULL` and `is_anonymous = true`. They are commonly used for CSRF token issuance before login and shopping cart persistence.

```ts
await db.appSettingsAuth.update({
  where: { id: settingsId },
  data: { allowAnonymousSessions: false }
});
```

---

## CAPTCHA / reCAPTCHA

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `enable_captcha` | boolean | `false` | Require CAPTCHA on sign-up and password-reset |
| `captcha_site_key` | text | `null` | Public reCAPTCHA site key |

The secret key should be stored as a `simple_secret` (not in `app_settings_auth`).

```ts
await db.appSettingsAuth.update({
  where: { id: settingsId },
  data: {
    enableCaptcha: true,
    captchaSiteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI'
  }
});
```

---

## Cookie-Based Authentication

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `enable_cookie_auth` | boolean | `false` | Enable HTTP cookie-based authentication |
| `cookie_secure` | boolean | `true` | Secure flag (HTTPS only) |
| `cookie_samesite` | text | `'lax'` | SameSite attribute: `strict`, `lax`, or `none` |
| `cookie_domain` | text | `null` | Cookie domain scope (e.g. `.example.com`); NULL = request origin |
| `cookie_httponly` | boolean | `true` | HttpOnly flag (no JS access) |
| `cookie_max_age` | interval | `2 weeks` | Cookie Max-Age |
| `cookie_path` | text | `'/'` | Cookie path scope |

When `enable_cookie_auth = true`, the server sets a session cookie on sign-in instead of returning a bearer token in the response body. Requires `require_csrf_for_auth = true` for security.

```ts
await db.appSettingsAuth.update({
  where: { id: settingsId },
  data: {
    enableCookieAuth: true,
    cookieSecure: true,
    cookieSamesite: 'strict',
    cookieDomain: '.myapp.com',
    cookieHttponly: true,
    cookieMaxAge: '7 days',
    cookiePath: '/'
  }
});
```

---

## Session Management

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `session_idle_timeout` | interval | `null` | Idle timeout — sessions unused for this duration expire; NULL = no idle expiry |
| `max_sessions_per_user` | integer | `null` | Max concurrent sessions per user; NULL = unlimited |
| `allow_multiple_sessions` | boolean | `true` | Whether users can have multiple active sessions |
| `default_session_duration` | interval | `2 weeks` | Session expiration for standard logins |
| `remember_me_duration` | interval | `30 days` | Extended session duration for remember-me logins |
| `default_credential_duration` | interval | `1 hour` | Default bearer token credential expiration |

```ts
await db.appSettingsAuth.update({
  where: { id: settingsId },
  data: {
    sessionIdleTimeout: '2 hours',
    maxSessionsPerUser: 5,
    allowMultipleSessions: true,
    defaultSessionDuration: '1 week'
  }
});
```

---

## Cross-Origin Token

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `allow_cross_origin_token` | boolean | `true` | Enable cross-origin session handoff tokens |

When enabled, the `request_cross_origin_token` / `sign_in_cross_origin` flow allows transferring a session from one domain to another (e.g. `app.example.com` → `admin.example.com`).

```ts
await db.appSettingsAuth.update({
  where: { id: settingsId },
  data: { allowCrossOriginToken: false }
});
```

---

## rate_limit_meters_module

Billing-aware rate limit meters, distinct from the basic `rate_limits_module`. Provisioned by `sessions_module` in the `full` preset.

Creates three tables:
- `rate_limit_state` (private) — sliding window tracking per entity/actor/meter/window with three enforcement scopes
- `rate_limit_overrides` — per-entity/actor override limits
- `rate_window_limits` — plan-tier rate limits (FK to plans table)

Provides a `check_rate_limit` function that enforces sliding-window rate limits with billing-aware plan lookup.

**Gate:** `rate_limit_meters_module` — included in `full` preset.

### Configuring via ORM

Rate limit meters are provisioned as part of `databaseProvisionModule`. Once provisioned, configure window limits per plan:

```ts
// Set rate limits for a plan tier
await db.rateWindowLimits.create({
  data: {
    planId: planId,
    meterSlug: 'api_calls',
    windowPeriod: '1 hour',
    scope: 'actor',
    maxRequests: 1000,
    lockoutDuration: '15 minutes'
  }
});
```

---

## user_credentials_module

Bcrypt credential store (`user_secrets` table). Present in every auth preset but not separately documented.

Creates the `user_secrets` table with columns:
- `id` (uuid, primary key)
- `owner_id` (uuid, FK to users)
- `name` (text) — key name identifying the credential (e.g. `password_hash`)
- `value` (bytea) — bcrypt-hashed credential value
- `is_encrypted` (boolean)

A trigger automatically hashes plaintext values with bcrypt on insert/update.

**Gate:** `user_credentials_module` — included in all auth presets (`auth:email`, `auth:email+magic`, `auth:sso`, `auth:passkey`, `auth:hardened`, `b2b`, `b2b:storage`, `full`).

This module is used internally by `sign_up`, `sign_in`, `set_password`, `reset_password`, and `verify_password` functions. Application code typically does not interact with `user_secrets` directly.
