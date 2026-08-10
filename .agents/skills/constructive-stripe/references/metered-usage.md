# Metered usage

Usage-based pricing: the customer is invoiced for what they actually consumed.
Usage is recorded locally as it happens and reported to Stripe on a schedule;
Stripe invoices the total at the end of the period.

## The shape

```
db.mutation.recordUsage(…)      usage accrues locally, immediately
        ↓
reporting job (scheduled)        reports the difference since last time
        ↓
Stripe                           invoices the period's total
```

Recording is synchronous and authoritative — a quota check right after
`recordUsage` sees the new value. Reporting is asynchronous and exists only for
billing.

## Requirements

| Requirement | Why |
|-------------|-----|
| **A Stripe meter whose `event_name` equals the local meter slug** | Usage is reported to a meter *by name*. Nothing creates these — see below |
| The Stripe price is metered and references that meter | A licensed price has no usage to report against |
| An active subscription on that price | Otherwise there is no billing relationship to accrue against |
| A `billing_customers` mapping for the entity | Usage is addressed to a **customer**, not a subscription item |
| Usage recorded through `recordUsage` | Nothing else advances the balance |
| The reporting job runs | Nothing reports on its own |

Balances the reporter cannot resolve to a provider customer are counted as
failed rather than skipped: the usage is real, the marker stays put, and the
next run retries once the customer exists.

### The Stripe meter is a prerequisite nothing creates

Reporting is done with **Billing Meter Events**, which are addressed by event
name. If no active Stripe meter carries that name, every report fails:

```
No active meter found for event name "api_calls"
```

The egress path syncs plans, prices, customers and subscriptions. **It does not
sync meters.** Each locally defined meter needs a Stripe meter created by hand
with a matching `event_name` before any usage can be billed, and missing one is
silent — the job retries until it exhausts its attempts and then stops.

That gap is
[constructive-planning#1505](https://github.com/constructive-io/constructive-planning/issues/1505).

## What gets reported

The **difference** since the last successful report, not the running total.
After a report succeeds, a marker advances to the amount that was reported.

Two properties follow, both of which matter:

**Usage recorded mid-report is not lost.** The marker advances to the value that
was actually reported, not to whatever the balance says at that moment. Usage
that accrued while the report was in flight is still ahead of the marker and is
picked up next run.

**A failed report costs nothing.** The marker only moves after Stripe accepts, so
a failure leaves the same difference to be retried. Reporting the same usage
twice would double-bill; this is why the marker is not advanced optimistically.

The marker also only ever moves forward, so a delayed or duplicated report of an
older value cannot rewind it.

**Meter events carry their own idempotency.** Each report is sent with an
`identifier` derived from the entity, meter and reported total, and Stripe
deduplicates on it for at least 24 hours. A retried job or two workers racing
therefore report once by construction, not only by the marker.

## Scheduling

The reporting job is not scheduled automatically. Decide the cadence from how
quickly usage must appear on the customer's invoice — hourly is a reasonable
default; more often mostly adds Stripe calls without changing the invoice.

A missed run is harmless: the next one reports the accumulated difference. Only a
run that never happens before the period closes loses billing for that period.

## Verifying

1. Record some usage, then read the balance — it moved
2. Run the reporting job
3. Read the balance again — the marker now matches the usage
4. Check the subscription item's usage on the Stripe side — it matches
5. Run the job again — nothing is reported, the marker does not move

Step 5 is the one worth keeping in a test. It is what proves the customer will
not be billed twice for the same usage.

## Not built yet: metered pricing in the catalog

Plan pricing carries a billing interval but no usage type, so the sync job
creates a licensed recurring price — never a metered one. A metered price must
be created on the Stripe side out of band and mapped to the pricing row. The rest
of the metered path — recording, reporting, the marker — works normally once the
subscription exists.

Until the catalog can express it, the catalog is no longer the single source of
truth for what a plan costs. Anyone changing prices has to know which ones live
outside it.

This is a capability that has not been built, not a line the integration draws on
purpose — unlike the constraints in
[limitations.md](./limitations.md), it is expected to change.

## Cross-References

- **Recording usage, meters, quota checks:** [`constructive-billing`](../../constructive-billing/SKILL.md)
- **Scheduled jobs:** [`constructive-jobs`](../../constructive-jobs/SKILL.md)
- **Standing constraints:** [limitations.md](./limitations.md)
