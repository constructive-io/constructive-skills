---
name: constructive-auth
description: "Configure Constructive identity, sign-up, sign-in, recovery, sessions, MFA, devices, identity linking, CAPTCHA, rate limits, cookie auth, and service-level authentication behavior. Use for auth policy and backend capability questions. Use constructive-blocks for installing the Authentication feature pack or Console Kit auth module."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Auth

Configure identity, authentication, and session behavior. This skill owns auth semantics and settings; [`constructive-blocks`](../constructive-blocks/SKILL.md) owns the Authentication feature-pack UI, its standalone host contract, and the Console module's endpoint, session, discovery, and adapter boundaries.

## When to Apply

Use this skill when:

- Configuring sign-up, sign-in, recovery, magic link, OAuth, passkey, or phone behavior.
- Configuring MFA, backup codes, trusted devices, or device approval.
- Configuring cookie auth, anonymous sessions, CAPTCHA, cross-origin behavior, or rate limits.
- Linking identities or resolving account collisions.
- Understanding auth operation results, session claims, and service settings.

For product UI, activate `constructive-blocks` and install the Authentication pack or its Console module. Sign-up, sign-in, recovery, and account management are acceptance scenarios within that pack, not separate install units.

## Runtime Boundary

For the Console auth module or custom auth client, the host must supply the tenant's explicit semantic `auth` endpoint. A standalone Authentication pack receives already-loaded resources and semantic actions through its host contract, so it does not resolve that endpoint itself. In Blocks/frontend/application code, never construct an `auth-<database>` hostname, derive a sibling route from the data endpoint, or send a bearer token to an inferred origin — endpoint discovery is the provisioning/harness layer's job (that layer derives and pins the per-DB endpoints and hands them to the app via env/host contract).

Use the Blocks auth adapter for Console Kit. A standalone Authentication pack receives its resources, policy, actions, errors, and view state from the host and performs no endpoint or session discovery. For custom domain code, create an endpoint-scoped client from the explicit descriptor and keep credentials in the host session boundary. Do not place bearer tokens in component props, URLs, a process-wide client, or the Console Kit Zustand store.

See [auth-flow.md](./references/auth-flow.md) for the custom-client boundary and acceptance scenarios.

## Auth Settings

`app_settings_auth` controls authentication behavior exposed by the installed backend modules:

- **MFA:** `require_mfa`, supported factors, backup codes, step-up window, and challenge expiry.
- **Anonymous sessions:** `allow_anonymous_sessions` for explicitly designed pre-auth use cases.
- **CAPTCHA:** `enable_captcha` and the public site key.
- **Cookie auth:** `enable_cookie_auth` for browser session transport.
- **Cross-origin behavior:** service-level origin and token settings.
- **Rate limits:** installed rate-limit capability and meter configuration.

See [auth-settings.md](./references/auth-settings.md) for the settings reference.

## Devices

Device tracking can combine trusted-device recognition, MFA on a new device, and an approval gate. Treat the returned device token as a separate opaque credential from the access token.

See [device-settings.md](./references/device-settings.md) for the composition matrix and [service-settings.md](./references/service-settings.md) for service-level routing, RLS, WebAuthn, and public-key configuration.

## Identity Linking

Identity linking associates multiple authentication providers with one user while preserving collision and primary-method policy. `allow_link_by_email` controls whether a matching provider email may offer linking; `enforce_primary_auth_method` controls whether sign-in is restricted to the user's primary method.

See [identity-linking.md](./references/identity-linking.md) for operation behavior and error handling.

## References

| File | Content |
|---|---|
| [auth-flow.md](./references/auth-flow.md) | Explicit endpoints, session boundary, and auth acceptance scenarios |
| [auth-settings.md](./references/auth-settings.md) | MFA, anonymous sessions, CAPTCHA, cookie auth, and rate limits |
| [device-settings.md](./references/device-settings.md) | Device tracking, trusted devices, and approval gates |
| [service-settings.md](./references/service-settings.md) | Service-level auth, WebAuthn, CORS, and RLS configuration |
| [identity-linking.md](./references/identity-linking.md) | Identity linking and account collision behavior |

## Cross-References

- [`constructive-blocks`](../constructive-blocks/SKILL.md) — Authentication feature-pack installation and runtime.
- [`constructive-security`](../constructive-security/SKILL.md) — authorization, RLS, and step-up policy.
- [`constructive-entities`](../constructive-entities/SKILL.md) — memberships and invitations.
- [`constructive-principals`](../constructive-principals/SKILL.md) — API keys and delegated identities.
