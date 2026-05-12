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

## Quick Start

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

## Related

- Issue #735 - Server-Side Auth Implementation Plan
- `constructive-cookie-csrf` - Cookie auth and CSRF (partial)
