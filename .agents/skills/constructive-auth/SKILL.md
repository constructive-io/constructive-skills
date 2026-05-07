---
name: constructive-auth
description: Client-side authentication guide - OAuth/SSO integration, redirect handling (returnUrl/errorUrl), cookies vs bearer tokens, multi-tenant auth, session management
compatibility: Constructive GraphQL Server
metadata:
  author: constructive-io
  version: "1.0.0"
---

# constructive-auth

How to integrate authentication from the client side (frontend, mobile, or API consumer).

## When to Apply

Use this skill when:
- Building a login page with OAuth providers (GitHub, Google, etc.)
- Implementing SSO redirect flows
- Handling authentication callbacks
- Working with session cookies or bearer tokens
- Building multi-tenant applications with isolated auth

## Quick Start

### 1. Redirect User to OAuth

```javascript
// Simple redirect
window.location.href = 'https://api.example.com/auth/github';

// With custom redirects
window.location.href = 'https://api.example.com/auth/github?returnUrl=/dashboard&errorUrl=/login?failed=true';
```

### 2. Handle Success

After successful auth, user is redirected to `returnUrl` with session cookie set automatically.

### 3. Handle Errors

On failure, user is redirected to `errorUrl` with query params:
```
/login?failed=true&error=auth_failed&message=User+denied+access&provider=github
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/providers` | GET | List enabled OAuth providers |
| `/auth/{provider}` | GET | Initiate OAuth flow |
| `/auth/{provider}/callback` | GET | OAuth callback (internal) |

## Parameters

### Initiate Auth (`/auth/{provider}`)

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `returnUrl` | No | `/` or `OAUTH_SUCCESS_REDIRECT` | URL to redirect on success |
| `errorUrl` | No | `/auth/error` or `OAUTH_ERROR_REDIRECT` | URL to redirect on failure |

### Error Redirect Query Params

| Param | Description |
|-------|-------------|
| `error` | Error code (e.g., `auth_failed`, `provider_not_found`) |
| `message` | Human-readable error message |
| `provider` | Provider that failed (e.g., `github`) |

## Authentication Methods

Constructive supports two authentication methods that can be used together:

### Cookie-Based (Automatic)

After OAuth success, a session cookie (`constructive_session`) is set automatically.

```javascript
// Cookie is sent automatically with same-origin requests
fetch('/graphql', {
  method: 'POST',
  credentials: 'include',  // Important for cross-origin
  body: JSON.stringify({ query: '{ currentUser { id } }' })
});
```

**Best for**: Web apps on same domain, SSR applications

### Bearer Token

For cross-origin or mobile apps, use the Authorization header.

```javascript
// Get token from your auth flow (stored after OAuth callback)
const token = localStorage.getItem('access_token');

fetch('https://api.example.com/graphql', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: '{ currentUser { id } }' })
});
```

**Best for**: Mobile apps, cross-origin SPAs, API integrations

### Priority

When both are present, Bearer token takes priority over cookie.

## Multi-Tenant Support

Each tenant (subdomain) has isolated OAuth configuration.

### How It Works

1. User visits `tenant-a.example.com/auth/github`
2. Server identifies tenant from subdomain
3. Loads tenant-specific OAuth credentials from database
4. Stores tenant info in encrypted OAuth state
5. Callback returns to same subdomain
6. Session cookie scoped to tenant

### Subdomain Routing

```
main-app.example.com     → Main database
tenant-a.example.com     → Tenant A database
tenant-b.example.com     → Tenant B database
```

### Localhost Development

For local development, use port-based or subdomain routing:
```
localhost:3000           → Main database
tenant-a.localhost:3000  → Tenant A database
```

## Error Codes

| Code | Description |
|------|-------------|
| `provider_not_found` | Provider not configured in database |
| `provider_disabled` | Provider exists but is disabled |
| `provider_not_configured` | Missing client_id or client_secret |
| `invalid_state` | CSRF validation failed or state expired |
| `missing_code` | OAuth provider didn't return auth code |
| `auth_failed` | Generic authentication failure |
| `tenant_not_found` | Could not resolve tenant from state |

## Examples

### React Login Button

```tsx
function LoginButton({ provider }: { provider: string }) {
  const handleLogin = () => {
    const returnUrl = encodeURIComponent(window.location.pathname);
    const errorUrl = encodeURIComponent('/login?error=true');
    window.location.href = `/auth/${provider}?returnUrl=${returnUrl}&errorUrl=${errorUrl}`;
  };

  return <button onClick={handleLogin}>Login with {provider}</button>;
}
```

### Check Available Providers

```typescript
async function getProviders(): Promise<string[]> {
  const res = await fetch('/auth/providers');
  const data = await res.json();
  return data.providers; // ['github', 'google', ...]
}
```

### Handle Error Redirect

```typescript
// On your error page
const params = new URLSearchParams(window.location.search);
const error = params.get('error');
const message = params.get('message');
const provider = params.get('provider');

if (error) {
  console.error(`Auth failed: ${message} (provider: ${provider})`);
}
```

## Cookie Settings

Session cookies are configured per-tenant via `authSettings`:

| Setting | Default | Description |
|---------|---------|-------------|
| `cookieSecure` | `true` in production | HTTPS only |
| `cookieSameSite` | `lax` | CSRF protection level |
| `cookieDomain` | auto | Domain scope |
| `cookiePath` | `/` | Path scope |
| `defaultSessionDuration` | `1 hour` | Session lifetime |
| `rememberMeDuration` | `30 days` | Extended session |

## References

- [authentication-flow](references/authentication-flow.md) - Detailed flow diagram
- [cross-origin-setup](references/cross-origin-setup.md) - CORS and cross-domain auth
