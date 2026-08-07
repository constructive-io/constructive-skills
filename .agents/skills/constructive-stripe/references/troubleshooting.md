# Troubleshooting

Ordered by how often each cause turns out to be the real one.

## The customer paid and nothing changed

### 1. The plan describes nothing

A plan with no `planLimits` and no `planMeterLimits` is saleable and grants
nothing. The payment succeeds, the webhook runs, and there is nothing to apply.

**Check:** does the purchased plan list any limits or meter limits?

This is the most common cause by a wide margin, because a plan is perfectly valid
without them.

### 2. The purchase credited the other domain

A plan describing only meters will never raise a limit's ceiling, and vice
versa. Buying more of the wrong kind can be repeated indefinitely without
unblocking the customer.

**Check:** the customer is blocked by `LIMIT_REACHED` (limits) or by a quota
check (meters) — does the plan describe that same domain?

See [credit-domains.md](./credit-domains.md).

### 3. The webhook never arrived

The success URL is reached on payment, not on application. If the event was never
delivered, nothing was applied.

**Check:** the provider's webhook event record for the event. Absent means
delivery, not application.

Usual causes: `stripe_webhook_secret` missing or stale (deliveries are rejected
silently), or the endpoint is not reachable from Stripe.

A local forwarding session prints a new secret each time it starts. A stale one
rejects everything.

### 4. It was credited to the organization

An org purchase credits the organization. The user who paid sees no change to
their personal allowance — correctly.

**Check:** whether the checkout used `entityType: 'org'`.

### 5. You looked too early

The success page can render before the webhook has been applied. Poll the
allowance rather than reading it once.

---

## Checkout returns 404 "Price not found"

The pricing row has not synced to Stripe yet, or the sync failed.

Syncing is enqueued when the pricing row is written and normally completes in
seconds. A sync that keeps failing is usually the API key: if `stripe_api_key`
cannot be read, every Stripe call fails.

**Check:** does the pricing row have a recorded Stripe mapping?

---

## Checkout returns 500 "Billing not configured"

No readable `stripe_api_key` for this tenant.

If the secret exists but reads fail, suspect how it was written: secrets are
encrypted on write through the secrets API, and a direct table write stores
plaintext marked as encrypted, which fails on every read. Rewriting the same
value does not repair it — remove and re-add.

---

## Checkout returns 403 on an org purchase

The caller does not own the organization. Ownership is checked before the session
is created.

---

## Credits were not returned on a refund

### The purchase granted nothing

A refund reverses what the purchase granted. Refunding a subscription payment, or
a purchase of a plan describing no allowances, correctly touches no balance.

### The pack granted several meters

Only the first is reversed; the rest are logged as skipped. This is a known
limitation — see [gaps.md](./gaps.md). Prefer single-meter credit packs.

### The refund event never arrived

Same check as any missing webhook: look for the event in the provider's record.

---

## Usage is not reaching Stripe

### The subscription has no recorded subscription item

Balances whose subscription carries no item are skipped — there is nowhere to
report them. This is the normal state for a non-metered plan and is not an error.

### The price is not metered on the Stripe side

A licensed price accepts no usage. Note that plan pricing cannot yet express a
metered price, so the metered price must be created out of band — see
[gaps.md](./gaps.md).

### The reporting job is not scheduled

It does not run on its own. Usage accrues locally and is simply never reported.

**Check:** has the job run at all? A balance whose marker is far behind its usage
and never moves is the signature.

---

## The same grant appears twice

Two purchases, not two deliveries. Redelivery is handled where the write happens
and cannot double-grant.

**Check:** two distinct charges in Stripe.

---

## Cross-References

- **Which domain to credit:** [credit-domains.md](./credit-domains.md)
- **What each event does:** [lifecycle.md](./lifecycle.md)
- **Wiring:** [setup.md](./setup.md)
