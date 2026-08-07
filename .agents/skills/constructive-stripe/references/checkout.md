# Checkout

`POST /api/billing/checkout` creates a Stripe-hosted checkout session and returns
its URL. It is served from the same host as the tenant's GraphQL endpoint, so the
tenant is inferred from the request — there is no tenant parameter.

## Request

```ts
const res = await fetch('/api/billing/checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    priceId: pricingId,
    successUrl: 'https://app.example.com/billing/done',
    cancelUrl:  'https://app.example.com/billing',
  }),
});
```

| Field | Required | Notes |
|-------|----------|-------|
| `priceId` | yes | Your `plan_pricing` row id. **Not** a Stripe `price_…` id |
| `successUrl` | yes | Where Stripe returns on success |
| `cancelUrl` | yes | Where Stripe returns on cancel |
| `entityType` | no | `user` (default) or `org` |
| `entityId` | no | The organization id when `entityType` is `org` |

`priceId` being your own id is deliberate: the Stripe price is an implementation
detail that the platform maintains, and it changes when a plan is re-synced.

## Response

```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_…" }
```

Redirect the browser there. Do not try to complete the session server-side —
Stripe-hosted checkout requires the browser.

## Errors

| Status | Meaning | Usual cause |
|--------|---------|-------------|
| 400 | Missing required fields | One of the three required fields absent |
| 401 | Unauthorized | No bearer token, or it did not authenticate |
| 403 | Only organization owner can subscribe | `entityType: 'org'` from a non-owner |
| 404 | Price not found | The pricing row has not synced to Stripe yet |
| 500 | Billing not configured | No `stripe_api_key` for this tenant |

A 404 shortly after creating a plan usually means the sync job has not finished.
It is enqueued when the pricing row is written and normally completes in
seconds.

## Selling to an organization

```ts
body: JSON.stringify({
  priceId, successUrl, cancelUrl,
  entityType: 'org',
  entityId: organizationId,
})
```

The caller must own the organization. Ownership is checked before the session is
created, so a non-owner never reaches Stripe.

What the purchase grants is credited to the **organization**, not to the person
who paid. This is usually what you want and occasionally surprising — a user who
buys seats for their org will not see their personal limit change.

## Subscription or credit pack

The session's mode follows the pricing's billing interval. You do not choose it
at checkout time:

| `billingInterval` | Session mode | Result |
|-------------------|--------------|--------|
| `one_time` | payment | Credit pack — grants on top of current allowances |
| `month`, `year`, … | subscription | Subscription — the plan's allowances become the customer's |

To sell the same plan both ways, give it two pricing rows.

## After the redirect

`successUrl` is reached as soon as Stripe accepts payment, which may be *before*
the platform has applied the purchase. Two consequences:

- Do not read the new allowance immediately on the success page and assume it is
  final. Poll, or show a pending state.
- Do not grant anything from the success page. The success URL is reachable by
  anyone who guesses it; only the webhook is proof of payment.

## What to poll

After returning from checkout, read the allowance the purchase should have
raised — the limit's `max` or the meter balance's `effectiveLimit` — and wait
for it to change. That is the same thing the customer is about to be blocked by,
so it is the honest signal.

## Cross-References

- **Which allowance a plan grants:** [credit-domains.md](./credit-domains.md)
- **What the webhook applies:** [lifecycle.md](./lifecycle.md)
- **When nothing changes:** [troubleshooting.md](./troubleshooting.md)
