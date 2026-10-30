# Constructive Cookie & CSRF

Cookie-based authentication and CSRF protection for Constructive platform.

## Status

Per issue #749, cookie lifecycle and CSRF enforcement are **partially implemented**.

| Component | Status |
|-----------|--------|
| CSRF middleware (`@constructive-io/csrf`) | ✅ Done |
| CSRF middleware wired to server | ✅ Done |
| Cookie setting on sign-in | 🚧 Not wired |
| Anonymous session creation | 🚧 Not implemented |
| CSRF + DB validation | 🚧 Not connected |

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   Browser   │────▶│  Auth Server     │────▶│  PostgreSQL  │
│             │     │  (Express)       │     │  (sessions)  │
└─────────────┘     └──────────────────┘     └──────────────┘
     │                     │
     │ csrf_token cookie   │ session cookie
     │ X-CSRF-Token header │
```

## How CSRF Works

**Double Submit Cookie pattern:**
1. Server sets `csrf_token` cookie (JS-readable)
2. Client reads cookie, sends value in `X-CSRF-Token` header
3. Server validates header matches cookie

## Middleware Configuration

In `server.ts`:

```typescript
const csrf = createCsrfMiddleware({
  cookieOptions: {
    httpOnly: false,  // SPA clients read via document.cookie
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
});
```

The middleware:
- Sets `csrf_token` cookie on all responses
- Validates `X-CSRF-Token` header on mutations
- Skips validation for Bearer token auth
- Skips validation for anonymous requests (no session cookie)

## Current Gap

**Middleware layer** and **Database layer** are not connected:

- Middleware sets `csrf_token` cookie
- Database `sign_in` function expects anonymous session in `sessions` table with matching `csrf_secret`
- No mechanism creates this anonymous session

## Database Settings

```sql
-- Check CSRF settings
SELECT require_csrf_for_auth, enable_cookie_auth
FROM "{schema}-auth-private".app_settings_auth;

-- Disable CSRF requirement (workaround)
UPDATE "{schema}-auth-private".app_settings_auth
SET require_csrf_for_auth = false;

-- Enable cookie auth
UPDATE "{schema}-auth-private".app_settings_auth
SET enable_cookie_auth = true;
```

## Client Usage (When Fully Implemented)

```typescript
// Read CSRF token from cookie
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

// Include in requests
fetch('/graphql', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': getCookie('csrf_token'),
  },
  body: JSON.stringify({ query: '...' })
});
```

## Recommendation

Use **Bearer token auth** for now:
- Not vulnerable to CSRF (requires Authorization header)
- Fully working with cross-origin flow
- Store token in localStorage/sessionStorage

## Key Files

| File | Purpose |
|------|---------|
| `graphql/server/src/server.ts` | CSRF middleware wiring |
| `graphql/server/src/middleware/cookie.ts` | Cookie utilities |
| `packages/csrf/src/middleware.ts` | CSRF double-submit logic |

## Related

- Issue #749 - Cookie Lifecycle & CSRF Enforcement
- Issue #735 - Server-Side Auth Implementation Plan
- `constructive-oauth` - OAuth identity sign-in (uses Bearer tokens)
