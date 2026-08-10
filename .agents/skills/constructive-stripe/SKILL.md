---
name: constructive-stripe
description: "Stripe billing provider — checkout, subscriptions, credit packs, refunds, invoice history, metered usage, failed payments and dunning, and disputes. Use when asked to 'add Stripe', 'take payments', 'sell credits', 'create a checkout session', 'upgrade a plan', 'cancel a subscription', 'handle refunds', 'show invoice history', 'bill by usage', 'metered billing', 'usage-based pricing', 'report usage to Stripe', 'meter events'; when a payment failed — 'card declined', 'payment failed', 'past due', 'overdue subscription', 'dunning', 'grace period', 'downgrade after non-payment', 'expired card'; when money comes back — 'refund', 'refund failed', 'chargeback', 'dispute', 'customer disputed a charge'; or for symptoms like 'why didn't my limit go up after paying', 'credits not refunded', 'usage is not being billed', 'No active meter found for event name', 'cancelled but the customer still has paid limits', 'which credits does a purchase grant', or when wiring billing_provider_module to Stripe."
metadata:
  author: constructive-io
  version: "1.1.0"
---

# Constructive Stripe

## Before you build on this

Three things decide whether a deployment works, and none of them is visible
from the code:

1. **Disputes are not handled.** Five events, none received. A customer
   disputes a charge, the bank takes the money, and nothing in the platform
   reflects it — the evidence window passes unattended, which loses the case by
   default. Do not treat billing as complete without it.
   ([lifecycle.md](./references/lifecycle.md),
   [planning#1526](https://github.com/constructive-io/constructive-planning/issues/1526))

2. **Metered billing needs a Stripe meter that nothing creates.** Usage is
   reported to a meter *by event name*. If no active Stripe meter carries the
   local meter's slug, every report fails with `No active meter found for event
   name "…"` — the job retries, exhausts its attempts, and stops. Nothing else
   says so. ([metered-usage.md](./references/metered-usage.md))

3. **A limit pack bought before the resource is used grants nothing.** The
   `*_limits` row is created lazily, on first use; the trigger that folds
   credits in only ever `UPDATE`s. Buy 5 projects on a fresh account and the
   credit row is written, the webhook returns 200, the log says granted — and
   the allowance stays at the default. The credits are orphaned permanently.
   Sell limit packs only to accounts that have used the resource, or hold the
   entry point until
   [planning#1506](https://github.com/constructive-io/constructive-planning/issues/1506)
   lands. ([checkout.md](./references/checkout.md))

Everything else below is verified end to end against a real Stripe test account
in `constructive-hub/tests/billing`.

## What this covers

Taking money with Stripe and having the platform apply the result — raising a
limit, granting metered credits, reversing them on a refund, keeping an invoice
history, and reporting usage back for metered plans.

`constructive-billing` describes what limits, meters and credits *are*. This
skill describes how a **payment** turns into one of them.

## When to Apply

Use this skill when:

- Selling a plan upgrade or a one-time credit pack
- A purchase completed but the user's limit or balance did not change
- Deciding whether a plan should grant limits, meters, or both
- Refunds need to take back what a purchase gave
- Users should be able to see their invoices
- Pricing is usage-based and usage has to reach Stripe

## The one thing to get right first

**There are two credit systems, and a purchase only touches the one its plan
describes.** Picking the wrong one is the single most common reason a paying
customer stays blocked.

| | Limits domain | Meters domain |
|---|---|---|
| Counts | Discrete things — projects, seats, integrations | Consumption — API calls, storage, tokens |
| Plan describes it with | `planLimits` | `planMeterLimits` |
| A purchase raises | the limit's `max` | the balance's `effectiveLimit` |
| Enforced by | `LimitEnforce*` nodes | `checkBillingQuota` |
| Blocked user sees | `LIMIT_REACHED` | quota check returns false |

A plan may describe both; a purchase then grants both. A plan that describes
neither takes the customer's money and changes nothing.

See [credit-domains.md](./references/credit-domains.md).

## End to end

```
1. Define a plan + pricing               your catalog
2. Platform syncs it to Stripe           automatic, on write
3. App creates a checkout session        POST /api/billing/checkout
4. Customer pays                         Stripe-hosted page
5. Platform applies the purchase         automatic, on webhook
6. Limit raised / credits granted        customer unblocked
```

Steps 2 and 5 are the platform's. The app only does 1 and 3 — and reads the
result.

## Setup

Required before any of this works:

- `billing_provider_module` provisioned with `provider: 'stripe'`
- `billing_module` — without it there are no balances to credit
- `plans_module` — plans and pricing live here
- A `stripe_api_key` secret in the tenant's `billing` namespace
- A `stripe_webhook_secret` secret, matching the endpoint Stripe posts to

Secrets are stored through the platform's secrets API, which encrypts them on
write. See [setup.md](./references/setup.md) for the full checklist and the
failure each missing piece produces.

## Selling something

A plan's pricing carries a billing interval, and that interval decides what kind
of purchase it is:

| Interval | Purchase | Applied as |
|----------|----------|------------|
| `one_time` | Credit pack | A grant against the plan's limits and meters |
| `month` / `year` | Subscription | The plan's allowances become the customer's |

Create a checkout session for a pricing row:

```ts
const res = await fetch('/api/billing/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    priceId: pricingId,             // your plan_pricing row id, not a Stripe id
    successUrl: 'https://app.example.com/billing/done',
    cancelUrl:  'https://app.example.com/billing',
  }),
});

const { url } = await res.json();
window.location.href = url;         // Stripe-hosted checkout
```

Selling to an organization instead of the signed-in user:

```ts
body: JSON.stringify({ priceId, successUrl, cancelUrl,
                       entityType: 'org', entityId: organizationId })
```

Only the organization's owner may do this; anyone else gets 403.

See [checkout.md](./references/checkout.md).

## What happens after they pay

The app does not need to do anything. Each Stripe event has a defined effect:

| Event | Effect |
|-------|--------|
| `checkout.session.completed` (one_time) | Grants credits in whichever domains the plan describes |
| `checkout.session.completed` (subscription) | Records the customer mapping |
| `customer.subscription.created` / `.updated` | Applies the plan's allowances; tracks the item used for metered reporting |
| `customer.subscription.deleted` | Deactivates the subscription |
| `invoice.finalized` / `.paid` / `.voided` | Records the invoice; `paid` also advances the period |
| `charge.refunded` | Records the refund and reverses the credits it granted |

Every one of these is idempotent. Stripe redelivers, and redelivery never
double-grants or double-revokes.

See [lifecycle.md](./references/lifecycle.md) for what each effect writes and
how to verify it.

## Refunds

A refund reverses what the purchase granted — the customer's balance goes back
down, and a matching ledger entry records why.

Reversal is derived from the plan that was purchased, so a refund gives back
exactly what was given. A refund of a charge that granted nothing (a
subscription payment, say) records the refund and touches no balance.

**Limitation:** a refund reverses one meter. A credit pack describing several
meters cannot be fully reversed by a single refund — the platform reverses the
first and logs the ones it skipped. Prefer single-meter credit packs until this
is lifted.

## Invoices

Invoice history is recorded automatically, including the hosted URL and PDF
link, and follows the invoice through `draft → open → paid` or `void`. One row
per invoice, updated in place.

Read it like any other table through the ORM.

## Metered billing

For usage-based pricing, usage recorded locally is reported to Stripe on a
schedule and invoiced by Stripe at the end of the period.

Requirements:

- The subscription's price is metered on the Stripe side
- Usage is recorded through `db.mutation.recordUsage` (see `constructive-billing`)
- The reporting job runs — see [metered-usage.md](./references/metered-usage.md)

The platform only ever reports the difference since the last successful report,
and only moves that marker forward, so usage is neither double-billed nor lost
when a report fails.

**Not built yet:** plan pricing cannot express a metered price, so the
Stripe-side metered price must be created out of band. See
[metered-usage.md](./references/metered-usage.md).

## When a payment seems to do nothing

Work down this list — it is ordered by how often each one is the cause:

1. **Does the plan describe anything?** A plan with no `planLimits` and no
   `planMeterLimits` grants nothing.
2. **Right domain?** A plan describing only meters will never raise a
   `LIMIT_REACHED` limit, no matter how much is bought.
3. **Did the webhook arrive?** Check the provider's webhook event log for the
   event; a missing `stripe_webhook_secret` rejects deliveries silently.
4. **Is the entity right?** An org purchase credits the org, not the buyer.

[troubleshooting.md](./references/troubleshooting.md) has the symptom-to-cause
table.

## References

| File | Content |
|------|---------|
| [setup.md](./references/setup.md) | Modules, secrets, and what each missing piece breaks |
| [checkout.md](./references/checkout.md) | The checkout endpoint in full |
| [credit-domains.md](./references/credit-domains.md) | Limits vs meters, and how to choose |
| [lifecycle.md](./references/lifecycle.md) | Event-by-event effects and how to verify |
| [metered-usage.md](./references/metered-usage.md) | Usage reporting and its guarantees |
| [troubleshooting.md](./references/troubleshooting.md) | Symptom to cause, including known defects |
| [limitations.md](./references/limitations.md) | Standing constraints and what to do instead |

## Cross-References

- **Limits, meters, credits:** [`constructive-billing`](../constructive-billing/SKILL.md)
- **Plans and entitlements:** [`constructive-billing`](../constructive-billing/SKILL.md)
- **Background jobs:** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Secrets:** [`constructive-secrets-config`](../constructive-secrets-config/SKILL.md)
- **Organizations:** [`constructive-entities`](../constructive-entities/SKILL.md)
