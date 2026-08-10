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

Ends the paid subscription **and opens a free one**, so the customer falls back
to whatever the product gives away. Permanent credits bought separately are
unaffected.

The second half is not ceremony. The cascade behind `plan_subscriptions` runs
`apply_plan(NEW.plan_id)` on insert and update and never consults `is_active`,
so deactivating a subscription re-applies the plan being left — a cancelled paid
account would keep every paid allowance. Only a row for a different plan moves
them.

"Free" is resolved as the cheapest active plan, preferring one named `free`. A
catalog with no zero-priced plan is left alone and logged: allowances stay
where they were.

**Confirm:** exactly one active subscription afterwards, on the free plan.

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

**Known defect** (`constructive-planning#1507`): one meter is reversed per refund. A
pack granting several meters has the first reversed and the rest logged as
skipped, while the money is returned in full. Keep credit packs to a single meter
until this is fixed — see [troubleshooting.md](./troubleshooting.md).

### `charge.refund.updated`

A refund is not final when it is created. It can fail days later — a closed
account, a cancelled card — and the credits were already clawed back on the
strength of `charge.refunded`. Left alone the customer has neither the money
nor the allowance.

On `status = 'failed'` the reversal is undone: the meter credits are restored,
the limit credits mirrored back, and `billing_refunds.status` moved to `failed`
so the guard stops a redelivery from restoring twice.

All of it happens in one transaction, and deliberately. With the compensation
and the status update apart, a compensation that did not happen would still
mark the record settled — and every redelivery would then be a no-op, leaving
the credits gone permanently. The restoring inserts also check their row count:
`INSERT … SELECT` writes nothing when the meter is gone, and a zero-row insert
is not an error.

**Confirm:** the balance returns to its post-purchase value; the refund row
reads `failed`.

### `invoice.payment_failed` — and what follows

Recording the invoice is the start, not the end. Stripe retries a failed charge
several times over about two weeks and then moves the subscription to
`past_due`, which syncs into `billing_subscriptions`.

Acting on it is a scheduled sweep, `billing:sweep_overdue`, because "the grace
period has passed" is not something Stripe announces. Subscriptions that have
been overdue longer than the grace period — **seven days** by default — are
ended and replaced with a free subscription, exactly as cancellation does.

Paying clears it: `invoice.paid` moves the status back to `active`, and the
sweep then has nothing to match. That recovery is applied on the invoice rather
than waiting for `customer.subscription.updated`, because the sweep runs on a
clock and a customer who has just paid must not be downgraded a moment later.

**Confirm:** the allowance survives the grace period, falls to the free tier
after it, and is restored by paying.

### Disputes — not handled at all

Five events, none of them received:

```
charge.dispute.created           opened; funds held; the evidence clock starts
charge.dispute.updated           evidence submitted, moved under review
charge.dispute.closed            won or lost
charge.dispute.funds_withdrawn   money actually leaves
charge.dispute.funds_reinstated  won, money comes back
```

A customer disputes a charge with their bank, the money is taken, and nothing
in the platform reflects it — the allowance does not move, and the evidence
window passes unattended, which loses the case by default.

This is the only remaining place where money is already gone and no record of
it exists. Do not treat a deployment as complete without it:
[constructive-planning#1526](https://github.com/constructive-io/constructive-planning/issues/1526).

Recording a dispute through `record_refund` works — the dedup key holds if the
dispute id goes in `external_refund_id` — and is the wrong shape. A dispute has
an evidence deadline, a status machine and a fee, and `evidence_due_by`, the
field an operator most needs, has nowhere to live in a refunds row.

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

**A green test is not proof the handler ran.** Two features here passed their
assertions while never executing — a build that was not the one being served,
in both cases. When something new passes on the first attempt, confirm the
handler's own log line appears before believing it.

### The end-to-end suite

Every event above is exercised against a real Stripe test account in
`constructive-hub/tests/billing` (branch `feat/stripe-integration`):

```bash
pnpm start && pnpm test:billing
```

Some of its assertions fail deliberately — they are anchors for filed defects
and turn green when those are fixed. `HANDOFF.md` beside the suite says which,
and why.

## Cross-References

- **Which domain gets credited:** [credit-domains.md](./credit-domains.md)
- **Usage reporting:** [metered-usage.md](./metered-usage.md)
- **Nothing happened:** [troubleshooting.md](./troubleshooting.md)
- **What the events deliberately do not do:** [limitations.md](./limitations.md)
