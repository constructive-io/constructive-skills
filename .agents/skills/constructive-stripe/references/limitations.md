# Known limitations

Things the provider integration does not do, what breaks because of it, and what
to do instead. Each of these is a standing constraint on what you can sell — a
line the integration draws deliberately, not work that is pending.

Two kinds of thing deliberately do **not** live here:

- **Defects** — something behaving wrong. Those belong in
  [troubleshooting.md](./troubleshooting.md), by symptom.
- **Capabilities not built yet** — metered pricing in the catalog, for instance,
  which is described where it bites in
  [metered-usage.md](./metered-usage.md).

If a constraint below ever stops being true, it is because the design changed.
Nothing here is waiting on a fix.

## Subscription payments record no grant to reverse

A refund reverses what the purchase granted. A subscription payment grants
nothing directly — the plan's allowances come from the subscription, not from the
charge — so refunding one records the refund and touches no balance.

**Breaks:** refunding a subscription payment does not revoke the plan's
allowances. The customer keeps the entitlement they were refunded for.

**Instead:** cancel the subscription as well. Cancellation is what removes the
plan's allowances; the refund only returns money.

**Why it is not automatic:** a refund carries no intent. Service failure,
accounting correction, and a customer leaving all arrive as the same event, and
only the first two should leave access intact. The caller knows which one it was;
the integration cannot.

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

**Why it is not chosen for you:** the cadence is a billing decision — how quickly
usage must appear on a customer's invoice — and it costs Stripe calls to get
wrong in either direction.

## Hosted checkout cannot be completed headlessly

Stripe-hosted checkout requires a browser, in test mode as well as live. There is
no API call that completes a session. This is Stripe's constraint, not the
integration's.

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

That is the one thing on this page that is genuinely open: a gap is something to
report, not a constraint to plan around.

## Cross-References

- **Something behaving wrong:** [troubleshooting.md](./troubleshooting.md)
- **Usage reporting:** [metered-usage.md](./metered-usage.md)
- **Refund behaviour:** [lifecycle.md](./lifecycle.md)
- **Choosing a domain:** [credit-domains.md](./credit-domains.md)
