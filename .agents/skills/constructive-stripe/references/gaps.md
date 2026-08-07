# Known limitations

Things the provider integration does not do yet, what breaks because of it, and
what to do instead. Each of these is a real constraint on what you can sell — not
a bug you can work around in your app.

## Metered pricing is not expressible in the catalog

Plan pricing carries a billing interval but no usage type, so a synced price is
always licensed — a fixed amount per period. There is no way to describe "charge
per unit consumed" in your catalog.

**Breaks:** the metered path cannot be driven from your own catalog. Usage
reporting has nothing to report against, because a licensed price accepts no
usage records.

**Instead:** create the metered price on the Stripe side and map it to a pricing
row, then subscribe customers to that. The rest of the metered path — recording,
reporting, the marker — works normally once the subscription exists.

**Consequence to plan around:** the catalog is no longer the single source of
truth for what a plan costs. Anyone changing prices has to know which ones live
outside it.

## A refund reverses one meter

A refund's record is keyed to the refund, and it carries one meter. A credit pack
whose plan describes several meters cannot be fully reversed by a single refund —
the first is reversed, the rest are logged as skipped.

**Breaks:** refunding a multi-meter pack returns the money but leaves the
customer holding most of what they bought.

**Instead:** keep credit packs to a single meter. Sell three packs rather than one
pack granting three meters.

**Why it is logged rather than silently partial:** reversing part of a purchase
without saying so is worse than not reversing it — the discrepancy surfaces later
as a balance nobody can explain.

## Subscription payments record no grant to reverse

A refund reverses what the purchase granted. A subscription payment grants
nothing directly — the plan's allowances come from the subscription, not from the
charge — so refunding one records the refund and touches no balance.

**Breaks:** refunding a subscription payment does not revoke the plan's
allowances. The customer keeps the entitlement they were refunded for.

**Instead:** cancel the subscription as well. Cancellation is what removes the
plan's allowances; the refund only returns money.

## Invoices are recorded, not reconciled

Invoice history is a record of what Stripe reported. Nothing checks that the
amounts agree with what the plan should have cost, and nothing reacts to an
invoice that stays unpaid beyond a failed-payment status change.

**Breaks:** dunning, grace periods, and "your card failed, fix it or lose access"
are not provided.

**Instead:** build that on the invoice records and subscription status. The data
is there; the policy is yours.

## Usage reporting is not scheduled for you

The reporting job exists and is registered, but nothing runs it on a cadence.

**Breaks:** metered usage accrues locally and is never billed.

**Instead:** schedule it. See
[metered-usage.md](./metered-usage.md) for choosing a cadence and
[`constructive-jobs`](../../constructive-jobs/SKILL.md) for scheduling.

## Hosted checkout cannot be completed headlessly

Stripe-hosted checkout requires a browser, in test mode as well as live. There is
no API call that completes a session.

**Breaks:** an end-to-end automated test cannot cover the payment itself.

**Instead:** test the two halves separately. Drive the checkout endpoint and
assert it returns a session; then exercise the effects with real charges created
through the payment APIs, which can be created and refunded without a browser.
That covers everything except the card entry.

## Flagging a gap

If a capability is only reachable by going around the documented surface — a
direct table write, a hand-built Stripe object — treat that as a gap worth
reporting rather than a pattern to spread. The workaround tends to outlive the
person who understood why it was needed.

## Cross-References

- **Usage reporting:** [metered-usage.md](./metered-usage.md)
- **Refund behaviour:** [lifecycle.md](./lifecycle.md)
- **Choosing a domain:** [credit-domains.md](./credit-domains.md)
