# OAuth Troubleshooting

## OAuth Callback Errors

### fetch failed

**Symptom:** `CALLBACK_FAILED` with message `fetch failed`

**Cause:** HTTP_PROXY/HTTPS_PROXY environment variables interfere with Node.js fetch.

**Fix:**
```bash
HTTP_PROXY="" HTTPS_PROXY="" NO_PROXY="*" pnpm start
```

### PROVIDER_NOT_CONFIGURED

**Symptom:** OAuth redirect fails immediately

**Check:**
```sql
SELECT slug, client_id, client_secret_id, enabled
FROM "{schema}-auth-private".identity_providers
WHERE slug = 'github';
```

**Requirements:**
- `client_id` set
- `client_secret_id` set (use `rotate_identity_provider_secret`)
- `enabled = true`

### IDENTITY_SIGN_IN_DISABLED

**Symptom:** OAuth succeeds but returns error

**Fix:**
```sql
UPDATE "{schema}-auth-private".app_settings_auth
SET allow_identity_sign_in = true,
    allow_identity_sign_up = true;
```

### GitHub "redirect_uri not associated"

**Cause:** OAuth App callback URL mismatch

**Fix:** Update GitHub OAuth App callback URL to:
```
http://auth.localhost:3000/auth/github/callback
```

For tenants:
```
http://auth-{subdomain}.localhost:3000/auth/github/callback
```

## Token Exchange Errors

### Invalid token or token expired

**Causes:**
1. Token already used (one-time only)
2. Token expired (5 min TTL)
3. Wrong endpoint (must match issuer)
4. JWT claims not persisted (server issue)

**Debug:**
```sql
-- Check recent sessions
SELECT id, user_id, created_at
FROM "{schema}-auth-private".sessions
ORDER BY created_at DESC LIMIT 5;
```

### JWT Claims Not Persisted

**Cause:** `set_config(..., true)` loses settings with connection pooling.

**Fix in oauth.ts:**
```typescript
// WRONG
await pool.query(`SELECT set_config('jwt.claims.user_agent', $1, true)`, [ua]);

// CORRECT - use dedicated client with session-level config
const client = await pool.connect();
try {
  await client.query(`SELECT set_config('jwt.claims.user_agent', $1, false)`, [ua]);
  // use same client for sign_in_identity
} finally {
  client.release();
}
```

## Database Queries

### Find Tenant Schema

```sql
SELECT schema_name FROM information_schema.schemata
WHERE schema_name LIKE '%auth-private';
```

### Find Tenant Auth Endpoint

```sql
SELECT d.name, dom.subdomain, dom.domain
FROM services_public.domains dom
JOIN metaschema_public.database d ON dom.database_id = d.id
WHERE dom.subdomain LIKE 'auth-%';
```

### Verify Provider Config

```sql
SELECT id, slug, client_id, client_secret_id, enabled
FROM "{schema}-auth-private".identity_providers;
```

## Server Logs

```bash
# Hub environment
pnpm log public-server

# Check log files
cat .local/logs/public-server.log | tail -100
```

Look for `[oauth]`, `[auth]`, or `[server]` prefixed messages.
