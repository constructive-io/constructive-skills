# Authentication runtime and acceptance

Use the Authentication feature pack or Console Kit auth module for Constructive's standard sign-up, sign-in, recovery, account, and session UI. The standalone feature pack renders the resources and actions supplied by its host. The Console module's Blocks adapter discovers operations from the explicit `auth` endpoint and keeps credentials inside its database-scoped session boundary.

## Endpoint contract

For the Console module or a custom auth client, provisioning or the host application must provide a secret-free tenant descriptor with an explicit `auth` endpoint. A standalone Authentication pack instead receives resources and semantic actions from its host and does not consume this descriptor directly.

```ts
const database = {
  id: 'tenant_database_id',
  endpoints: {
    auth: 'https://tenant-auth.example.com/graphql',
    data: 'https://tenant-data.example.com/graphql'
  }
};
```

The URL is data, not a naming convention. Do not derive it from the database name, replace a subdomain, or assume the auth and data services share an origin.

## Custom client

Use a generated auth client only when a bespoke application flow needs it. Create the client for one explicit endpoint and identity scope; do not export a module-global configured client for a multi-tenant UI.

```ts
import { createClient as createAuthClient } from '@constructive-db/sdk/auth';

export function createTenantAuthClient(authEndpoint: string) {
  return createAuthClient({ endpoint: authEndpoint });
}
```

Confirm the exact sign-up, sign-in, recovery, and factor operations with standard GraphQL introspection. Named operations vary with the backend capabilities exposed at that endpoint, so copied operation lists are advisory.

## Credential boundary

- Keep bearer tokens in the host session closure and chosen session storage policy, never in component props or Zustand.
- Bind a session to the tenant database ID and reject a descriptor/session mismatch.
- Send a credential only to the explicit tenant endpoints selected by the adapter.
- Clear identity-scoped data before another user inherits the same mounted console.
- Store a returned device token separately from the access token and treat it as an opaque secret.

The generated client may accept request-scoped headers for custom code. Prefer a fresh request/client binding over mutating shared headers when tenants or identities can change concurrently.

## Acceptance scenarios

An auth implementation is proven through scenarios, not by the presence of a registry item or GraphQL field:

1. Sign up with a fresh identity and surface structured validation errors.
2. Complete any verification, MFA, or device gate required by the configured tenant.
3. Sign in and bind the returned identity to the same database ID.
4. Reload and verify the chosen persistence policy restores or rejects the session correctly.
5. Sign out and confirm identity-scoped state is cleared.
6. Sign back in and verify authenticated data obeys the user's RLS visibility.
7. Reject invalid, revoked, expired, and cross-tenant credentials without falling back to an operator route.

When a mail provider or external identity provider is not present, report that scenario as unverified rather than treating a rendered control as an end-to-end pass.
