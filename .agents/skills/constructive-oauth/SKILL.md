# Constructive OAuth

OAuth identity sign-in with cross-origin token exchange for Constructive platform.

## Features

| Feature | Status |
|---------|--------|
| GitHub OAuth | ✅ Ready |
| Google OAuth | ✅ Ready |
| Apple OAuth | ✅ Ready |
| Cross-origin token exchange | ✅ Ready |
| Multi-tenant support | ✅ Ready |
| Device tracking | ✅ Ready |
| Rate limiting | ✅ Ready |
| Remember me | ✅ Ready |

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Frontend  │────▶│  Auth Server     │────▶│   OAuth      │
│  (SPA/App)  │     │  (Express)       │     │  Provider    │
└─────────────┘     └──────────────────┘     └──────────────┘
       │                    │
       │ signInCrossOrigin  │ sign_in_identity (DB)
       ▼                    ▼
┌─────────────┐     ┌──────────────────┐
│   API       │◀────│   PostgreSQL     │
│   Server    │     │   (sessions)     │
└─────────────┘     └──────────────────┘
```

## Same-Origin vs Cross-Origin

OAuth flow supports two credential modes depending on your deployment:

| Mode | When to Use | Credential |
|------|-------------|------------|
| **Cross-Origin** | Frontend and auth server on different domains | Bearer token (Authorization header) |
| **Same-Origin** | Frontend and auth server on same domain | Cookie (HttpOnly session) |

### Cross-Origin (Bearer Token)

Use when frontend (`app.example.com`) and auth server (`auth.example.com`) are on different origins:

1. OAuth callback returns a one-time `token` in URL
2. Frontend exchanges token via `signInCrossOrigin` mutation
3. Response contains `accessToken` for Bearer authentication
4. Store token in localStorage/sessionStorage
5. Include `Authorization: Bearer <token>` header on all API requests

**Pros:** Works across any origin, no CSRF concerns
**Cons:** Token management, must handle expiry/refresh

### Same-Origin (Cookie)

Use when frontend and auth server share the same origin or are on subdomains with shared cookies:

1. OAuth callback sets session cookie directly (HttpOnly)
2. No token exchange needed
3. Cookies sent automatically with `credentials: 'include'`
4. CSRF protection required (see `constructive-cookie-csrf`)

**Pros:** Simpler flow, automatic credential handling
**Cons:** Requires CSRF protection, same-origin constraints

**Note:** Cookie auth is partially implemented (see issue #749). Use cross-origin Bearer token flow for now.

---

## Quick Start (Cross-Origin)

### 1. Redirect to OAuth

```typescript
const authEndpoint = 'http://auth.localhost:3000';
const provider = 'github';
const callbackUrl = encodeURIComponent(window.location.origin + '/auth/callback');

localStorage.setItem('oauth_auth_endpoint', authEndpoint);
window.location.href = `${authEndpoint}/auth/${provider}?redirect_uri=${callbackUrl}`;
```

### 2. Handle Callback

```typescript
const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const error = params.get('error');

if (error) {
  console.error('OAuth failed:', error);
  return;
}
```

### 3. Exchange Token

```typescript
const authEndpoint = localStorage.getItem('oauth_auth_endpoint');

const response = await fetch(`${authEndpoint}/graphql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `
      mutation SignInCrossOrigin($input: SignInCrossOriginInput!) {
        signInCrossOrigin(input: $input) {
          result {
            id
            userId
            accessToken
            accessTokenExpiresAt
            isVerified
            totpEnabled
          }
        }
      }
    `,
    variables: {
      input: { token, credentialKind: 'bearer' }
    }
  })
});

const { accessToken, userId } = (await response.json()).data.signInCrossOrigin.result;
```

### 4. Use Access Token

```typescript
fetch('http://api.localhost:3000/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({ query: '{ currentUserId }' })
});
```

## Server Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OAUTH_SECRET` | **Yes** | Secret for signing OAuth state (CSRF protection) |

**Required in all environments.** Server throws error if not configured.

```bash
# Generate a secure secret
openssl rand -base64 32

# Set in environment
export OAUTH_SECRET="your-generated-secret"
```

---

## Configure Identity Provider

### 1. Create OAuth App

**GitHub:** https://github.com/settings/developers
- Callback URL: `http://auth.localhost:3000/auth/github/callback`

**Google:** https://console.cloud.google.com/apis/credentials
- Redirect URI: `http://auth.localhost:3000/auth/google/callback`

### 2. Configure Database

```sql
-- Set client_id and enable
UPDATE "{schema}-auth-private".identity_providers
SET client_id = 'your-client-id', enabled = true
WHERE slug = 'github';

-- Set client secret
SELECT "{schema}-auth-private".rotate_identity_provider_secret(
  'provider-uuid',
  'your-client-secret'
);

-- Enable identity sign-in
UPDATE "{schema}-auth-private".app_settings_auth
SET allow_identity_sign_in = true,
    allow_identity_sign_up = true;
```

## Query Available Providers

No authentication required:

```graphql
query {
  identityProviders {
    nodes {
      slug
      kind
      displayName
      enabled
    }
  }
}
```

## Multi-Tenant

Each tenant has its own auth endpoint and providers:

```typescript
const tenantAuthEndpoint = `http://auth-${tenantSubdomain}.localhost:3000`;
```

Find tenant endpoint:
```sql
SELECT dom.subdomain, dom.domain
FROM services_public.domains dom
JOIN metaschema_public.database d ON dom.database_id = d.id
WHERE dom.subdomain LIKE 'auth-%';
```

## References

- `references/troubleshooting.md` - Common issues and fixes

## Key Files

| File | Purpose |
|------|---------|
| `graphql/server/src/middleware/oauth.ts` | OAuth callback handling |
| `graphql/server/src/middleware/auth.ts` | Authentication middleware |
| `packages/oauth/src/index.ts` | OAuth provider configuration |

---

## Device Tracking

OAuth sign-in automatically tracks user devices when `devices_module` is provisioned.

### How It Works

1. First login → new device record created, `device_token` returned
2. Subsequent logins with `device_token` → existing device reused, `last_seen_at` updated
3. Invalid/missing `device_token` → new device created

### Cross-Origin Device Token

For cross-origin flows, device token is passed via OAuth state (not cookies):

```typescript
// Include device_token in OAuth initiate URL
const deviceToken = localStorage.getItem('device_token');
let oauthUrl = `${authEndpoint}/auth/${provider}?redirect_uri=${callbackUrl}`;
if (deviceToken) {
  oauthUrl += `&device_token=${encodeURIComponent(deviceToken)}`;
}

// Save device_token from callback
const params = new URLSearchParams(window.location.search);
const newDeviceToken = params.get('device_token');
if (newDeviceToken) {
  localStorage.setItem('device_token', newDeviceToken);
}
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `auth_user_devices` | Device records per user |
| `app_settings_device` | Device tracking settings |

### Settings

```sql
SELECT * FROM "{schema}_auth_private".app_settings_device;
-- enable_device_tracking: true
-- max_devices_per_user: 50
-- device_trust_duration: 30 days
-- require_mfa_new_device: false
```

---

## Rate Limiting

OAuth endpoints have two layers of rate limiting:

### Layer 1: Express Middleware

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/:provider` (initiate) | 10 requests | 1 minute |
| `/:provider/callback` | 30 requests | 1 minute |

Skipped in development/test environments (`NODE_ENV`).

### Layer 2: Database (sign_in_identity)

| Type | Limit | Window | Lockout |
|------|-------|--------|---------|
| IP only | 250 attempts | 15 min | 30 min |
| IP + User-Agent | 50 attempts | 15 min | 15 min |
| User/account | 10 attempts | 15 min | 15 min |
| Login | 5 failures | - | 15 min |

### Why Two Layers?

```
Express rate limit → Protects OAuth providers (GitHub/Google API limits)
Database rate limit → Protects sign_in_identity (brute force prevention)
```

Express layer blocks requests before hitting OAuth provider APIs.

---

## Remember Me

OAuth sign-in uses `remember_me=true` by default, extending session duration.

### Duration Settings

```sql
SELECT remember_me_duration, default_session_duration
FROM "{schema}_auth_private".app_settings_auth;
-- remember_me_duration: 30 days
-- default_session_duration: 14 days
```

### Cookie and Session Sync

Both cookie `Max-Age` and database session `expires_at` use `remember_me_duration` when enabled, ensuring they stay synchronized.

---

## Related

- Issue #735 - Server-Side Auth Implementation Plan
- `constructive-cookie-csrf` - Cookie auth and CSRF (partial)
- PR #1141 - OAuth identity sign-in implementation
- PR #1163 (constructive-db) - Device tracking unit tests
