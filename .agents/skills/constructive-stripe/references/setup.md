# Setup

What has to exist before a payment can be applied, and the symptom each missing
piece produces.

## Modules

| Module | Why | Missing it means |
|--------|-----|------------------|
| `billing_provider_module` (`provider: 'stripe'`) | Owns the Stripe mapping and the webhook record | Nothing is wired at all |
| `billing_module` | Owns meter balances and the ledger | Meter credits have nowhere to land; refunds record but reverse nothing |
| `plans_module` | Owns plans and pricing | No catalog to sell from |
| `limits_module` | Owns limits | A plan's `planLimits` grant nothing |

`billing_module` must be provisioned before `plans_module` — the plan cascade
looks for it while installing and silently skips the parts that depend on it if
it is not there yet.

## Secrets

Two secrets live in the tenant's `billing` namespace:

| Name | Used for |
|------|----------|
| `stripe_api_key` | Calling Stripe: syncing the catalog, creating sessions, reporting usage |
| `stripe_webhook_secret` | Verifying that a delivery really came from Stripe |

Store them through the platform's secrets API, which encrypts on write.

**Do not write the secrets table directly.** Encryption happens on the way in; a
direct write stores the value in the clear while marking it encrypted, and every
later read fails with a decryption error. Worse, rewriting the same value does
not repair it — the repair path is to remove and re-add.

Symptoms:

| Symptom | Cause |
|---------|-------|
| Catalog never syncs to Stripe | `stripe_api_key` missing or unreadable |
| Checkout returns 500 "Billing not configured" | same |
| Deliveries rejected, no events recorded | `stripe_webhook_secret` missing or stale |

The webhook secret is per-endpoint. It changes when you restart a local
forwarding session, and a stale one rejects everything silently — the events
simply never appear.

## Webhook endpoint

Stripe must post to the platform's webhook endpoint with the tenant's database id
as a query parameter, so the delivery can be routed to the right tenant:

```
https://<host>/stripe?databaseId=<tenant-database-id>
```

Locally, the Stripe CLI provides this:

```bash
stripe listen --forward-to "localhost:8080/stripe?databaseId=<tenant-database-id>"
```

## Pin the API version

Every `new Stripe()` passes an explicit `apiVersion`, and all of them agree:

| | |
|---|---|
| SDK | `stripe@22.4.0` |
| API version | `2026-07-29.dahlia` |

Pinning is not tidiness. Several handlers read fields that later versions moved,
and the checkout route creates the sessions the receiver later reads — a version
split between them would be a shape mismatch across a process boundary. Left to
the SDK default, a dependency bump would change what Stripe returns without
changing a line of code.

Note that **webhook payloads are serialised at the account's default version**,
not the one pinned in code. If they differ by a major, what arrives is not the
shape the handlers expect. Check the account's default before configuring a real
endpoint.

`subscriptionItems.createUsageRecord` was removed in SDK v18 — usage now goes
through Billing Meter Events, which are addressed to a customer and a meter
event name. See [metered-usage.md](./metered-usage.md).


Take the `whsec_…` it prints and store it as `stripe_webhook_secret` for that
tenant.

## Catalog

Plans and pricing are yours to define; syncing them to Stripe is not. Writing a
plan or a pricing row enqueues a sync job that creates or updates the
corresponding Stripe product and price, then records the mapping.

Consequences:

- `priceId` in a checkout request is **your** pricing row id, never a Stripe id
- A pricing row is not sellable until its sync completes — checkout returns 404
  until then
- Editing a plan re-syncs it; the Stripe id may change and that is fine

## Verifying the wiring

Before debugging a payment, confirm the setup end to end:

1. A plan and pricing exist, and the pricing has a recorded Stripe mapping
2. A checkout request for that pricing returns a URL rather than 404 or 500
3. Completing a payment produces an event in the provider's webhook record
4. The allowance the plan describes changed

Each step failing points at a different piece: 1 at the sync job, 2 at the API
key, 3 at the webhook secret, 4 at the plan describing nothing — see
[troubleshooting.md](./troubleshooting.md).

## Cross-References

- **Secrets API:** [`constructive-secrets-config`](../../constructive-secrets-config/SKILL.md)
- **Provisioning modules:** [`constructive-blueprints`](../../constructive-blueprints/SKILL.md)
- **Selling:** [checkout.md](./checkout.md)
