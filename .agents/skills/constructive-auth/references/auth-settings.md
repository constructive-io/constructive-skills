# Auth Settings Reference

Comprehensive reference for authentication and session configuration in the Constructive platform. All settings live on the `app_settings_auth` singleton table, provisioned by `sessions_module`.

**SDK gap:** `app_settings_auth` lives in the private auth schema and is **not** a generated ORM model in any target (`constructive-sdk`, `@constructive-db/sdk/auth`, `/api`) — there is no `db.appSettingsAuth`. Its values are set at provisioning by `sessions_module`/the auth blueprint preset and are read by the auth operations (`signIn`, `completeMfaChallenge`, `requestCrossOriginToken`, …). The tables below document what each field controls so you can reason about behavior; do not write ORM or SQL against them. What *is* ORM-exposed on the auth target: `auth.userSettingsSecurity` (per-user MFA state) and the auth mutations listed in `auth-flow.md`.

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



---

## Anonymous Sessions

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `allow_anonymous_sessions` | boolean | `true` | Enable anonymous sessions (useful for CSRF protection and shopping carts) |

Anonymous sessions create a session record with `user_id = NULL` and `is_anonymous = true`. They are commonly used for CSRF token issuance before login and shopping cart persistence.


---

## CAPTCHA / reCAPTCHA

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `enable_captcha` | boolean | `false` | Require CAPTCHA on sign-up and password-reset |
| `captcha_site_key` | text | `null` | Public reCAPTCHA site key |

The secret key should be stored as a `simple_secret` (not in `app_settings_auth`).


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


---

## Cross-Origin Token

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `allow_cross_origin_token` | boolean | `true` | Enable cross-origin session handoff tokens |

When enabled, the `request_cross_origin_token` / `sign_in_cross_origin` flow allows transferring a session from one domain to another (e.g. `app.example.com` → `admin.example.com`).


---

## rate_limit_meters_module

Billing-aware rate limit meters, distinct from the basic `rate_limits_module`. `rate_limit_meters_module` is a separate module included in the `full` preset; `sessions_module` does not provision it.

Creates three tables:
- `rate_limit_state` (private) — sliding window tracking per entity/actor/meter/window with three enforcement scopes
- `rate_limit_overrides` — per-entity/actor override limits
- `rate_window_limits` — plan-tier rate limits (FK to plans table)

Provides a `check_rate_limit` function that enforces sliding-window rate limits with billing-aware plan lookup.

**Gate:** `rate_limit_meters_module` — included in `full` preset.


Rate limit meters are provisioned as part of `databaseProvisionModule`. **SDK gap:** `rate_window_limits`, `rate_limit_overrides` and `rate_limit_state` have no generated ORM model (only the module's `rateWindowLimitsTableId`/`rateWindowLimitsTableName` wiring appears on `rateLimitMetersModule`); per-plan window limits cannot be configured through the SDK today.


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

**Gate:** `user_credentials_module` — resolve its presence from the current backend preset/module registry. It is part of the supported authentication-bearing presets (`auth:hardened`, `b2b:storage`, and `full`).

This module is used internally by `sign_up`, `sign_in`, `set_password`, `reset_password`, and `verify_password` functions. Application code typically does not interact with `user_secrets` directly.
