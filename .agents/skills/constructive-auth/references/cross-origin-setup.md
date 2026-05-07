# Cross-Origin Setup

How to configure OAuth authentication for cross-origin scenarios (API on different domain than frontend).

## Scenarios

| Scenario | Cookie Works? | Solution |
|----------|---------------|----------|
| Same domain (`app.example.com` + `api.example.com`) | Yes | Set `cookieDomain: .example.com` |
| Different domains (`myapp.com` + `api.example.com`) | Limited | Use Bearer tokens |
| Mobile app | No | Use Bearer tokens |
| Localhost dev | Yes | Don't set cookieDomain |

## Same Domain (Subdomain Setup)

### Configuration

```sql
-- Set cookie domain to share across subdomains
UPDATE constructive_auth_private.app_settings_auth
SET cookie_domain = '.example.com';
```

### Frontend

```javascript
// Cookie sent automatically
fetch('https://api.example.com/graphql', {
  method: 'POST',
  credentials: 'include',  // Required for cross-subdomain cookies
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ currentUser { id } }' })
});
```

### CORS Setup

Server must allow credentials:

```javascript
// Express CORS config
app.use(cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true
}));
```

## Different Domains (Bearer Token)

When frontend and API are on completely different domains, cookies won't work reliably due to third-party cookie restrictions.

### Option 1: Popup Flow

```typescript
// Frontend: Open popup for OAuth
function loginWithPopup(provider: string) {
  const popup = window.open(
    `https://api.example.com/auth/${provider}?returnUrl=/auth/callback`,
    'oauth',
    'width=600,height=700'
  );

  // Listen for message from popup
  window.addEventListener('message', (event) => {
    if (event.origin !== 'https://api.example.com') return;
    const { token } = event.data;
    localStorage.setItem('access_token', token);
    popup?.close();
  });
}
```

```html
<!-- Callback page on API domain -->
<script>
  // Extract token from cookie or response
  const token = getCookie('constructive_session');
  window.opener.postMessage({ token }, 'https://myapp.com');
  window.close();
</script>
```

### Option 2: Redirect with Token

```typescript
// returnUrl includes token in hash (more secure than query)
const returnUrl = 'https://myapp.com/auth/callback';

// On callback page
const hash = new URLSearchParams(window.location.hash.slice(1));
const token = hash.get('token');
localStorage.setItem('access_token', token);
```

### Using Bearer Token

```typescript
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

## Mobile Apps

Mobile apps should always use Bearer tokens.

### React Native Example

```typescript
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Deep link scheme: myapp://
const CALLBACK_URL = 'myapp://auth/callback';

async function loginWithOAuth(provider: string) {
  const apiUrl = 'https://api.example.com';
  const returnUrl = encodeURIComponent(CALLBACK_URL);

  // Open browser for OAuth
  await Linking.openURL(`${apiUrl}/auth/${provider}?returnUrl=${returnUrl}`);
}

// Handle deep link callback
Linking.addEventListener('url', async (event) => {
  const url = new URL(event.url);
  if (url.pathname === '/auth/callback') {
    const token = url.searchParams.get('token');
    await AsyncStorage.setItem('access_token', token);
  }
});
```

## Localhost Development

For localhost, don't set `cookieDomain` - let the browser handle it:

```sql
-- For development, leave cookie_domain NULL
UPDATE constructive_auth_private.app_settings_auth
SET cookie_domain = NULL;
```

Cookies will be scoped to exact hostname (e.g., `localhost` or `tenant.localhost`).

## SameSite Cookie Considerations

| SameSite | Cross-Origin Cookies | Security |
|----------|---------------------|----------|
| `strict` | Blocked | Highest |
| `lax` | Allowed for top-level navigation | Default |
| `none` | Allowed (requires `secure`) | Lowest |

For OAuth redirects, `lax` is recommended - it allows the callback redirect to include cookies while still protecting against CSRF.

```sql
UPDATE constructive_auth_private.app_settings_auth
SET cookie_same_site = 'lax';
```

## Troubleshooting

### Cookie Not Sent

1. Check `credentials: 'include'` in fetch
2. Check CORS `Access-Control-Allow-Credentials: true`
3. Check `cookieDomain` matches
4. Check `sameSite` setting
5. Check if third-party cookies are blocked

### Token Expiration

Default session: 1 hour. For longer sessions:

```sql
UPDATE constructive_auth_private.app_settings_auth
SET default_session_duration = '24 hours';
```

Or implement token refresh:

```typescript
async function refreshToken() {
  const deviceToken = localStorage.getItem('device_token');
  const res = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${deviceToken}` }
  });
  const { access_token } = await res.json();
  localStorage.setItem('access_token', access_token);
}
```
