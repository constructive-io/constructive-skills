# Payment lifecycle

What each Stripe event causes, and how to confirm it happened. The app subscribes
to none of this — the platform's webhook endpoint receives the events and applies
them.

## Events and effects

### `checkout.session.completed` — one-time

Grants the purchased plan's allowances on top of what the customer already has.

- Every `planLimits` entry raises that limit's permanent credits, and its ceiling
  with them
- Every `planMeterLimits` entry raises that meter balance's purchased credits and
  effective limit
- A ledger entry records each grant, with the checkout session id as the reason

A plan describing neither grants nothing. The payment still succeeds.

**Confirm:** the limit's `max` or the balance's `effectiveLimit` increased.

### `checkout.session.completed` — subscription

Records the mapping from the customer to the Stripe customer. The allowances
themselves are applied when the subscription event arrives, not here.

### `customer.subscription.created` / `.updated`

- Links the subscription to the plan it is for
- Applies the plan's allowances: limits get the plan's ceiling, meter balances
  the plan's allowance
- Records the subscription item used for metered usage reporting

The item is refreshed on update, because a plan change replaces it. Reporting
usage against a stale item would bill it to the plan the customer just left.

**Confirm:** the limit's `max` reflects the new plan; the subscription is active.

### `customer.subscription.deleted`

Marks the subscription inactive and ends it. Allowances the plan granted stop
applying; permanent credits bought separately are unaffected.

### `invoice.finalized` / `invoice.paid` / `invoice.voided`

Records the invoice, following it through its lifecycle. One row per invoice,
updated in place — the same invoice arriving again as `paid` updates the existing
record rather than adding a second.

`invoice.paid` additionally advances the subscription's period.

Recorded fields include amounts, status, billing reason, period, the hosted
invoice URL and the PDF link.

**Confirm:** the invoice appears in the customer's history with the expected
status.

### `charge.refunded`

Records the refund and reverses the credits the original purchase granted.

- The reversal is derived from the plan that was purchased, so it gives back
  exactly what was given
- A ledger entry records the reversal against the original grant
- A refund of a charge that granted no credits records the refund and touches no
  balance

**Confirm:** the balance returned to its pre-purchase value; a refund record
exists.

**Known defect** (`constructive-db#2841`): one meter is reversed per refund. A
pack granting several meters has the first reversed and the rest logged as
skipped, while the money is returned in full. Keep credit packs to a single meter
until this is fixed — see [troubleshooting.md](./troubleshooting.md).

## Idempotency

Every effect above is safe to receive more than once. Stripe redelivers events
routinely — on timeout, on non-2xx, and sometimes for no visible reason — and
redelivery never double-grants or double-revokes.

This is enforced where the write happens, not by remembering which events were
seen, so it holds even across a restart mid-processing.

Practical consequence: **do not build your own dedup on top.** If a grant appears
twice, the cause is two purchases, not two deliveries.

## Ordering

Stripe does not guarantee order. In practice this shows up as
`invoice.paid` arriving before `customer.subscription.created` on a first
subscription.

Each effect is written to be independent of the others, so out-of-order delivery
converges. What it does mean:

- Do not infer "the subscription is set up" from having seen an invoice
- Read the allowance itself rather than reconstructing state from events

## Verifying in development

Point the Stripe CLI at the local webhook endpoint and watch events arrive:

```bash
stripe listen --forward-to "localhost:8080/stripe?databaseId=<tenant-database-id>"
```

The secret it prints must be stored as the tenant's `stripe_webhook_secret`, or
deliveries are rejected as unsigned. See [setup.md](./setup.md).

The provider module keeps a record of every event it received, which is the first
place to look when an effect did not happen: if the event is not there, the
problem is delivery, not application.

## Cross-References

- **Which domain gets credited:** [credit-domains.md](./credit-domains.md)
- **Usage reporting:** [metered-usage.md](./metered-usage.md)
- **Nothing happened:** [troubleshooting.md](./troubleshooting.md)
- **What the events deliberately do not do:** [limitations.md](./limitations.md)
