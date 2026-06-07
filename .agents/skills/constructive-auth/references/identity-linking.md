# Identity Linking & Account Collision Resolution

## Overview

Identity linking lets users attach multiple auth providers (Google, Facebook, GitHub, phone, password) to a single account. One method is **primary** (creates sessions), the rest are **linked** (connected but don't sign in by default).

Two toggles control the system:

| Toggle | Scope | Default | Effect |
|--------|-------|---------|--------|
| `allow_link_by_email` | Per identity provider | `false` | When an unknown OAuth identity's email matches an existing user, offer linking instead of failing |
| `enforce_primary_auth_method` | App-wide (`auth_settings`) | `true` | Only the user's primary auth method can create sessions |

## Sign-In Identity Flow (OAuth Callback)

When a user signs in with an OAuth provider, `sign_in_identity(service, identifier, details)` runs this decision tree:

```mermaid
flowchart TD
    A[OAuth callback] --> B{Provider enabled?}
    B -- No --> C[❌ IDENTITY_PROVIDER_NOT_CONFIGURED]
    B -- Yes --> D{Connected account exists<br/>for service + identifier?}
    D -- Yes --> E{enforce_primary_auth_method?}
    E -- "No (off)" --> F[✅ Sign in — create session]
    E -- "Yes (on)" --> G{Is identity the user's<br/>primary auth method?}
    G -- Yes --> F
    G -- No --> H[❌ PRIMARY_AUTH_METHOD_MISMATCH]
    D -- No --> I{allow_link_by_email<br/>on this provider?}
    I -- No --> J[❌ IDENTITY_ACCOUNT_NOT_FOUND]
    I -- Yes --> K{Email from OAuth details<br/>matches existing user?}
    K -- No --> J
    K -- Yes --> L[❌ IDENTITY_LINK_AVAILABLE]

    style C fill:#fee,stroke:#c33
    style H fill:#fee,stroke:#c33
    style J fill:#fee,stroke:#c33
    style L fill:#fef,stroke:#93c
    style F fill:#efe,stroke:#3c3
```

### Error code summary

| Error | Meaning | Frontend action |
|-------|---------|----------------|
| `IDENTITY_PROVIDER_NOT_CONFIGURED` | Provider slug doesn't exist or is disabled | Show "provider unavailable" |
| `PRIMARY_AUTH_METHOD_MISMATCH` | User's primary method is different (e.g. password) | Prompt to sign in with primary method |
| `IDENTITY_ACCOUNT_NOT_FOUND` | No account linked and no email match (or linking disabled) | Redirect to sign-up |
| `IDENTITY_LINK_AVAILABLE` | Email matches an existing account — linking is possible | Prompt: "Sign in with your existing method to link this provider" |

## Link Identity Flow (Attach Provider to Existing Account)

After the frontend receives `IDENTITY_LINK_AVAILABLE`, the user signs in with their existing method, then calls `link_identity(service, identifier, details)`:

```mermaid
flowchart TD
    A[link_identity called] --> B{User authenticated?<br/>current_user_id IS NOT NULL}
    B -- No --> C[❌ NOT_AUTHENTICATED]
    B -- Yes --> D{Step-up auth valid?<br/>recent password/MFA verification}
    D -- No --> E[❌ STEP_UP_REQUIRED]
    D -- Yes --> F{Provider enabled?}
    F -- No --> G[❌ IDENTITY_PROVIDER_NOT_CONFIGURED]
    F -- Yes --> H{service + identifier<br/>already linked to any user?}
    H -- Yes --> I[❌ IDENTITY_ALREADY_LINKED]
    H -- No --> J[INSERT connected_account<br/>owner_id = current user]
    J --> K[✅ return true]

    style C fill:#fee,stroke:#c33
    style E fill:#fee,stroke:#c33
    style G fill:#fee,stroke:#c33
    style I fill:#fee,stroke:#c33
    style K fill:#efe,stroke:#3c3
```

## End-to-End Linking Scenario

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant API as Auth API
    participant DB as Database

    Note over U: User has account via email+password.<br/>Tries to sign in with Facebook.

    U->>FE: Click "Sign in with Facebook"
    FE->>API: sign_in_identity('facebook', 'fb-123', details)
    API->>DB: Lookup connected_accounts(facebook, fb-123)
    DB-->>API: NOT FOUND
    API->>DB: Lookup emails WHERE email = 'user@example.com'
    DB-->>API: Found — owner_id = user-456
    API->>DB: Lookup identity_providers WHERE slug = 'facebook'
    DB-->>API: allow_link_by_email = true
    API-->>FE: ❌ IDENTITY_LINK_AVAILABLE

    FE->>U: "Account exists. Sign in with password to link Facebook."
    U->>FE: Enter password
    FE->>API: sign_in('user@example.com', password)
    API-->>FE: ✅ accessToken

    FE->>API: link_identity('facebook', 'fb-123', details)
    Note over API: Checks: authenticated ✓<br/>step-up (recent password) ✓<br/>provider enabled ✓<br/>not already linked ✓
    API->>DB: INSERT connected_accounts(user-456, facebook, fb-123)
    API-->>FE: ✅ true

    Note over U: Future Facebook logins work via sign_in_identity
```

## Data Model

```mermaid
erDiagram
    users ||--o{ emails : "has many"
    users ||--o{ connected_accounts : "has many (linked providers)"
    users ||--o{ phone_numbers : "has many"
    users ||--o{ sessions : "has many"
    users ||--|| user_settings_security : "has one"
    identity_providers ||--o{ connected_accounts : "provider config"
    app_settings_auth ||--|| app_settings_auth : "singleton"

    users {
        uuid id PK
    }
    emails {
        uuid id PK
        uuid owner_id FK
        text email
        boolean is_primary
        boolean is_verified
    }
    connected_accounts {
        uuid id PK
        uuid owner_id FK
        text service "provider slug"
        text identifier "provider user ID"
        jsonb details "OAuth profile data"
        boolean is_verified
    }
    phone_numbers {
        uuid id PK
        uuid owner_id FK
        text phone
        boolean is_verified
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text auth_method "password|identity|sms|magic_link|webauthn"
        timestamptz last_password_verified "step-up window"
    }
    user_settings_security {
        uuid id PK
        uuid user_id FK
        text primary_auth_method "auto-set on sign-up"
    }
    identity_providers {
        uuid id PK
        text slug UK "google|facebook|github|..."
        text kind "oidc|oauth2|saml"
        boolean enabled
        boolean allow_link_by_email "toggle: offer linking on email match"
    }
    app_settings_auth {
        uuid id PK
        boolean enforce_primary_auth_method "toggle: lock to primary method"
    }
```

## Configuration

### Enable linking for a provider

```sql
-- Allow Google sign-ins to offer linking when email matches existing account
UPDATE auth_private.identity_providers
SET allow_link_by_email = true
WHERE slug = 'google';
```

### Disable primary auth enforcement (allow any linked method to sign in)

```sql
UPDATE auth_private.app_settings_auth
SET enforce_primary_auth_method = false;
```

## SDK Usage

```typescript
import { createClient as createAuthClient } from '@constructive-db/sdk/auth';

const auth = createAuthClient({ endpoint });

// 1. Try OAuth sign-in
try {
  const result = await auth.mutation.signInIdentity({
    input: { service: 'facebook', identifier: fbUserId, details: fbProfile }
  }).execute();
  // Success — user is signed in
} catch (err) {
  if (err.message.includes('IDENTITY_LINK_AVAILABLE')) {
    // 2. Prompt user to sign in with existing method
    const signIn = await auth.mutation.signIn({
      input: { email, password }
    }).execute();

    // 3. Link the new provider
    await auth.mutation.linkIdentity({
      input: { service: 'facebook', identifier: fbUserId, details: fbProfile }
    }).execute();
    // Facebook is now linked — future logins work
  }
}
```
