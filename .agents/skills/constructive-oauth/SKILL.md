---
name: constructive-oauth
description: "OAuth/SSO configuration and Identity Providers management — configure social login, manage identity providers, debug OAuth flows. Use when asked to 'configure OAuth', 'setup SSO', 'identity provider', 'GitHub login', 'social login', 'OAuth not working', or when working with authentication providers."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive OAuth

OAuth/SSO configuration and Identity Providers management.

## When to Apply

Use this skill when:
- Configuring OAuth identity providers (GitHub, Google, Apple, etc.)
- Debugging OAuth login flow (PROVIDER_NOT_CONFIGURED, EMAIL_NOT_VERIFIED)
- Managing auth settings (oauthEnabled, allowIdentitySignIn, etc.)
- Understanding identity providers and membership relationships

## Architecture Overview

```
Identity Providers (App-level)
    ├── github, google, apple... (social login)
    └── Shared across all users
```

**Current Design**: Identity providers are configured at app-level, shared by all users.

## Third-Party Provider Setup

### Callback URL Format

```
Platform:  https://auth.your-app.com/auth/callback/{provider}
Tenant:    https://auth-{tenant-slug}.your-app.com/auth/callback/{provider}
```

**Platform vs Tenant**: Each has its own OAuth App registration with matching callback URL.

### GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**

2. Configure:

   **Platform**:
   | Field | Value |
   |-------|-------|
   | Application name | Your App Name |
   | Homepage URL | `https://your-app.com` |
   | Authorization callback URL | `https://auth.your-app.com/auth/callback/github` |

   **Tenant**:
   | Field | Value |
   |-------|-------|
   | Application name | Your App Name - {Tenant} |
   | Homepage URL | `https://{tenant-slug}.your-app.com` |
   | Authorization callback URL | `https://auth-{tenant-slug}.your-app.com/auth/callback/github` |

3. Copy **Client ID** and generate **Client Secret**

### Google OAuth

1. Go to **Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID**

2. Configure:

   **Platform**:
   | Field | Value |
   |-------|-------|
   | Application type | Web application |
   | Authorized redirect URIs | `https://auth.your-app.com/auth/callback/google` |

   **Tenant**:
   | Field | Value |
   |-------|-------|
   | Application type | Web application |
   | Authorized redirect URIs | `https://auth-{tenant-slug}.your-app.com/auth/callback/google` |

3. Copy **Client ID** and **Client Secret**

### Apple Sign In

1. Go to **Apple Developer → Certificates, Identifiers & Profiles → Identifiers**

2. Create App ID with Sign In with Apple capability

3. Create Services ID:

   **Platform**:
   | Field | Value |
   |-------|-------|
   | Return URLs | `https://auth.your-app.com/auth/callback/apple` |

   **Tenant**:
   | Field | Value |
   |-------|-------|
   | Return URLs | `https://auth-{tenant-slug}.your-app.com/auth/callback/apple` |

### URL Patterns

OAuth flow uses the `auth` subdomain from `services_public.domains`:

```
Database schema:
  domain: "localhost" | "your-app.com"
  subdomain: "auth" | "auth-{tenant-slug}" | null
```

**Start OAuth Flow** (user clicks "Login with GitHub"):
```
https://{subdomain}.{domain}/auth/oauth/{provider_slug}?redirect_uri={success_url}

Platform:  https://auth.your-app.com/auth/oauth/github?redirect_uri=/dashboard
Tenant:    https://auth-{tenant-slug}.your-app.com/auth/oauth/github?redirect_uri=/dashboard
Local:     https://auth.localhost:3000/auth/oauth/github?redirect_uri=/dashboard
```

Query parameters:
- `redirect_uri`: URL to redirect after successful login (default: `/`)

**Callback URL** (configure in provider's developer console):
```
https://{subdomain}.{domain}/auth/callback/{provider_slug}

Platform:  https://auth.your-app.com/auth/callback/github
Tenant:    https://auth-{tenant-slug}.your-app.com/auth/callback/github
Local:     https://auth.localhost:3000/auth/callback/github
```

**Note**: For tenant-specific subdomains, you may need to register a wildcard callback URL or multiple callback URLs in the provider's console.

## REST API Endpoints

API endpoints are accessed via the `auth` subdomain. The subdomain determines which tenant database to operate on:

```
Base URL: https://{auth-subdomain}.{domain}

Platform:  https://auth.your-app.com
Tenant:    https://auth-{tenant-slug}.your-app.com
Local:     https://auth.localhost:3000
```

### Identity Providers

```
GET    {base}/identity-providers              # List all providers
GET    {base}/identity-providers/:slug        # Get single provider
PATCH  {base}/identity-providers/:slug        # Update provider config
POST   {base}/identity-providers/:slug/rotate-secret   # Rotate client secret
```

### Auth Settings

```
GET    {base}/app-settings-auth               # Get auth settings
PATCH  {base}/app-settings-auth               # Update auth settings
```

**Example** (local development):
```http
GET https://auth.localhost:3000/identity-providers
GET https://auth.localhost:3000/app-settings-auth
```

## Configuration Flow

### 1. Create Identity Provider

```http
POST /identity-providers
Content-Type: application/json

{
  "slug": "github",
  "kind": "oauth2",
  "displayName": "GitHub",
  "enabled": true,
  "clientId": "<GITHUB_CLIENT_ID>",
  "pkceEnabled": true
}
```

### 2. Set Client Secret

```http
POST /identity-providers/github/rotate-secret
Content-Type: application/json

{
  "clientSecret": "<GITHUB_CLIENT_SECRET>"
}
```

### 3. Configure Auth Settings

```http
PATCH /app-settings-auth
Content-Type: application/json

{
  "oauthEnabled": true,
  "oauthRequireVerifiedEmail": false,
  "allowIdentitySignIn": true,
  "allowIdentitySignUp": true
}
```

### 4. Test Login

```
1. Start:    GET https://auth.localhost:3000/auth/oauth/github
2. Redirect: → GitHub authorization page
3. Callback: → https://auth.localhost:3000/auth/callback/github
4. Result:   → Session cookie set, user logged in
```

## Auth Settings Reference

| Field | Type | Description |
|-------|------|-------------|
| `oauthEnabled` | boolean | Enable OAuth login globally |
| `oauthRequireVerifiedEmail` | boolean | Require verified email from IdP |
| `allowIdentitySignIn` | boolean | Allow existing users to sign in via OAuth |
| `allowIdentitySignUp` | boolean | Allow new user registration via OAuth |
| `oauthStateMaxAge` | interval | OAuth state token expiry |
| `oauthErrorRedirectPath` | string | Redirect path on OAuth error (default: `/auth/error`) |

### Redirect Behavior

| Scenario | Redirect To |
|----------|-------------|
| Success | `redirect_uri` query parameter (default: `/`) |
| Error | `oauthErrorRedirectPath` setting (default: `/auth/error`) |

**Configure error redirect**:
```http
PATCH https://auth.localhost:3000/app-settings-auth
Content-Type: application/json

{
  "oauthErrorRedirectPath": "/login?error=oauth"
}
```

Error redirect includes query params: `?error={code}&provider={slug}&error_description={msg}`

Example error redirect:
```
/login?error=oauth&error=EMAIL_NOT_VERIFIED&provider=github&error_description=Email+not+verified
```

## Common Issues

### PROVIDER_NOT_CONFIGURED

**Cause**: Provider not configured or cache not refreshed

**Debug**:
```sql
SELECT slug, enabled, client_id, client_secret_id
FROM <private_schema>.identity_providers
WHERE slug = 'github';
```

**Solution**: 
- Ensure both `client_id` and `client_secret_id` are not NULL
- Wait 5 minutes for cache expiry, or restart GraphQL server

### EMAIL_NOT_VERIFIED

**Cause**: `oauth_require_verified_email = true` but user email not verified

**Solution**:
```http
PATCH /app-settings-auth
Content-Type: application/json

{ "oauthRequireVerifiedEmail": false }
```

### Cache Not Refreshing

**Key Code** (`create-loader.ts`):
```typescript
const cache = new LRUCache({
  ttl: opts.ttlMs ?? DEFAULT_TTL_MS,
  updateAgeOnGet: false,  // Important: false = TTL from first set
});
```

- `updateAgeOnGet: true` → TTL resets on every read, never expires
- `updateAgeOnGet: false` → TTL starts from first set, expires after 5 min

**Identity providers loader TTL**: 5 minutes (`ttlMs: 5 * 60_000`)

## Key Files

| File | Description |
|------|-------------|
| `graphql/server/src/middleware/identity-providers.ts` | REST API middleware |
| `graphql/server/src/middleware/app-settings-auth.ts` | Auth settings middleware |
| `graphql/server/src/middleware/oauth.ts` | OAuth callback handler |
| `packages/express-context/src/loaders/identity-providers.ts` | Provider loader |
| `packages/express-context/src/loaders/create-loader.ts` | Loader factory |
| `constructive-db/.../identity_providers_module.sql` | DB schema generator |

## Known Issues

### rotate_identity_provider_platform_secret Function Bug

**Problem**: INSERT to platform_secrets missing `database_id` column

**Workaround**: Use direct SQL to insert secret

```sql
INSERT INTO constructive_store_private.platform_secrets 
  (database_id, namespace_id, algo, key_id, value)
VALUES (
  '<DATABASE_ID>',
  '<NAMESPACE_ID>',
  'pgp',
  '<KEY_ID>',
  pgp_sym_encrypt(encode('<CLIENT_SECRET>', 'hex'), '<KEY_ID>')
);

UPDATE <private_schema>.identity_providers
SET client_secret_id = '<SECRET_ID>'
WHERE slug = 'github';
```

## Login Flow

```
OAuth Login
    ↓
sign_in_identity / sign_up_identity
    ↓
Create user (users table)
    ↓
Create app_membership (membership_type=1)
    ↓
Session cookie set → User logged in
```

## Cross-References

- **Authentication basics:** [`constructive-auth`](../constructive-auth/SKILL.md)
- **Permissions & RLS:** [`constructive-security`](../constructive-security/SKILL.md)
- **Multi-tenant entities:** [`constructive-entities`](../constructive-entities/SKILL.md)
