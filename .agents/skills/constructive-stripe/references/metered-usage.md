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
| The Stripe price is metered | A licensed price has no usage to report against |
| An active subscription on that price | Usage is reported against its subscription item |
| Usage recorded through `recordUsage` | Nothing else advances the balance |
| The reporting job runs | Nothing reports on its own |

Balances whose subscription has no recorded subscription item are skipped —
there is nowhere to report them to. This is silent by design: it is the normal
state for a plan that is not metered.

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

## Gap: metered pricing is not expressible in the catalog

Plan pricing carries a billing interval but no usage type, so the sync job
creates a licensed recurring price — never a metered one. A metered price must
be created on the Stripe side out of band and mapped to the pricing row.

Until this is lifted, the metered path cannot be driven entirely from your own
catalog. See [gaps.md](./gaps.md).

## Cross-References

- **Recording usage, meters, quota checks:** [`constructive-billing`](../../constructive-billing/SKILL.md)
- **Scheduled jobs:** [`constructive-jobs`](../../constructive-jobs/SKILL.md)
- **Limitations:** [gaps.md](./gaps.md)
