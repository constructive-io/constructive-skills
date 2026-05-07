# Authentication Flow

Detailed sequence of the OAuth/SSO authentication process.

## Flow Diagram

```
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────┐
│ Browser │     │ Constructive│     │ OAuth Provider│     │ Database │
└────┬────┘     └──────┬──────┘     └──────┬───────┘     └────┬─────┘
     │                 │                    │                  │
     │ GET /auth/github?returnUrl=/app     │                  │
     │────────────────>│                    │                  │
     │                 │                    │                  │
     │                 │ Query credentials  │                  │
     │                 │───────────────────────────────────────>
     │                 │                    │                  │
     │                 │ client_id, secret  │                  │
     │                 │<───────────────────────────────────────
     │                 │                    │                  │
     │                 │ Generate CSRF token│                  │
     │                 │ Encode state payload                  │
     │                 │ Set oauth_state cookie                │
     │                 │                    │                  │
     │ 302 Redirect to GitHub              │                  │
     │<────────────────│                    │                  │
     │                 │                    │                  │
     │ User authorizes │                    │                  │
     │─────────────────────────────────────>│                  │
     │                 │                    │                  │
     │ 302 /auth/github/callback?code=xxx&state=yyy           │
     │<─────────────────────────────────────│                  │
     │                 │                    │                  │
     │ GET /auth/github/callback?code=xxx&state=yyy           │
     │────────────────>│                    │                  │
     │                 │                    │                  │
     │                 │ Verify CSRF (cookie vs state)         │
     │                 │ Decode state payload                  │
     │                 │ Extract tenant info                   │
     │                 │                    │                  │
     │                 │ Exchange code for token               │
     │                 │───────────────────>│                  │
     │                 │                    │                  │
     │                 │ access_token + profile                │
     │                 │<───────────────────│                  │
     │                 │                    │                  │
     │                 │ Sign in or sign up │                  │
     │                 │───────────────────────────────────────>
     │                 │                    │                  │
     │                 │ user_id, session_token                │
     │                 │<───────────────────────────────────────
     │                 │                    │                  │
     │                 │ Set constructive_session cookie       │
     │                 │ Clear oauth_state cookie              │
     │                 │                    │                  │
     │ 302 Redirect to /app (returnUrl)    │                  │
     │<────────────────│                    │                  │
     │                 │                    │                  │
```

## State Payload Structure

The `state` parameter contains encrypted JSON:

```typescript
interface OAuthStatePayload {
  csrf: string;           // CSRF token (also stored in cookie)
  tenant: string;         // Database name
  privateSchema: string;  // Auth schema (e.g., "constructive_auth_private")
  encryptedSchema: string;// Secrets schema (e.g., "constructive_encrypted")
  returnUrl?: string;     // Success redirect
  errorUrl?: string;      // Error redirect
  authSettings?: {        // Cookie configuration
    cookieSecure?: boolean;
    cookieSameSite?: 'strict' | 'lax' | 'none';
    cookieDomain?: string;
    // ...
  };
}
```

## CSRF Protection

1. **Initiate**: Generate random CSRF token, store in `oauth_state` cookie
2. **Callback**: Extract CSRF from state param, compare with cookie
3. **Match**: Proceed with auth
4. **Mismatch**: Redirect to errorUrl with `invalid_state`

The `oauth_state` cookie expires in 10 minutes (STATE_COOKIE_MAX_AGE).

## Database Operations

### Sign In (Existing User)

```sql
SELECT * FROM "{schema}_auth_private".sign_in_identity(
  provider,      -- 'github'
  provider_id,   -- GitHub user ID
  details,       -- { email_verified, raw profile }
  email          -- User's email
);
```

Returns: `user_id`, `access_token`, `access_token_expires_at`, `device_token?`

### Sign Up (New User)

If sign_in fails with `IDENTITY_ACCOUNT_NOT_FOUND`:

```sql
SELECT * FROM "{schema}_auth_private".sign_up_identity(
  provider,
  provider_id,
  email,
  details
);
```

Returns: `user_id`, `access_token`, `access_token_expires_at`

## Error Handling

| Stage | Error | Redirect |
|-------|-------|----------|
| Before state decoded | Provider errors | `config.errorRedirect` |
| After state decoded | All other errors | `statePayload.errorUrl` |

This ensures errors before we can read the state still redirect somewhere sensible.

## Session Cookie

After successful auth:

```javascript
res.cookie('constructive_session', accessToken, {
  httpOnly: true,
  secure: true,           // or from authSettings
  sameSite: 'lax',        // or from authSettings
  domain: cookieDomain,   // tenant-specific
  path: '/',
  maxAge: sessionDuration // from authSettings or 1 hour default
});
```
