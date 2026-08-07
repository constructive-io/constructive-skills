# Two credit domains

A purchase can raise two different kinds of allowance, and they are not
interchangeable. Choosing the wrong one produces the most confusing failure in
billing: the customer pays, the money arrives, and nothing they can see changes.

## What each one counts

**Limits** count discrete things that exist: projects, seats, integrations,
databases. There is a current count and a ceiling. Creating the thing increments
the count; hitting the ceiling raises `LIMIT_REACHED` and the write is rejected.

**Meters** count consumption that accumulates: API calls, storage, tokens,
minutes. There is usage and an effective limit. Consumption is recorded after the
fact; a quota check asks whether more is allowed.

The distinction is not about size or price. It is about whether the thing can be
*deleted to free capacity*. A project can — delete it and the count goes down. An
API call cannot.

## How a plan describes each

A plan carries both lists, and either may be empty:

| Field | Domain | Meaning |
|-------|--------|---------|
| `planLimits` | Limits | `{ limitName, maxValue }` — the ceiling this plan grants |
| `planMeterLimits` | Meters | `{ meterSlug, planLimit }` — the allowance this plan grants |

A plan describing both grants both on purchase. A plan describing neither is
saleable and grants nothing — the platform has no way to know that was
unintended.

## What a purchase does

**Subscription** — the plan's allowances become the customer's. Limits get the
plan's ceiling; meter balances get the plan's allowance.

**One-time (credit pack)** — the plan's allowances are granted *on top of* what
the customer already has. Buying the same pack twice grants twice.

The difference matters when pricing a pack: a subscription to a plan with
`projects: 20` sets the ceiling to 20 no matter what it was; a one-time purchase
of the same plan adds 20 to it.

## How the ceiling is composed

A limit's ceiling is the sum of three sources:

```
max = plan allowance + permanent credits + period credits
```

- **Plan allowance** — set by the current subscription
- **Permanent credits** — bought, or granted by an achievement; survive renewal
- **Period credits** — granted for the current period; reset

A purchased credit pack grants permanent credits, which is why an upgrade later
does not wipe them out: changing the plan replaces the plan allowance only.

## Choosing

Ask what the customer is buying:

| They are buying | Domain | Example plan |
|-----------------|--------|--------------|
| The right to have more things | Limits | `planLimits: [{ limitName: 'projects', maxValue: 20 }]` |
| More consumption before being cut off | Meters | `planMeterLimits: [{ meterSlug: 'api_calls', planLimit: 100000 }]` |
| A tier that includes both | Both | Both lists populated |

When unsure: if deleting something should give the capacity back, it is a limit.

## Refund behaviour differs

A refund reverses meter credits precisely — the balance goes back down and a
ledger entry records the reversal.

A refund currently reverses **one** meter per refund. A pack granting several
meters cannot be fully reversed by a single refund; the platform reverses the
first and logs the rest as skipped rather than silently reversing part of the
purchase.

This is the practical argument for keeping credit packs single-meter.

## Cross-References

- **Defining limits and meters:** [`constructive-billing`](../../constructive-billing/SKILL.md)
- **Selling a plan:** [checkout.md](./checkout.md)
- **What a payment applies:** [lifecycle.md](./lifecycle.md)
