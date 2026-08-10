# Trust Ladders

A **trust ladder** is a set of rungs that turn recorded evidence into access. Each rung names the evidence it wants (an event, or a computed metric) and what earning it is worth — a capability bit, limit capacity, or nothing at all.

It is the same machinery as [achievements.md](./achievements.md) — levels, requirements, rewards — with one addition: a rung can reward a **capability** rather than a credit, which is what makes an earned level enforceable by RLS instead of merely displayable.

A ladder is *content*, not code: it is a document of rows seeded into the tenant's own levels tables at provisioning. Two are shipped, and a tenant can author or retune its own.

## Requesting a Ladder

Ask for one by slug in the `events_module` entry of a database's module list:

```json
[
  ["events_module", { "scope": "app", "trust_ladder": "humanity" }],
  ["limits_module", { "scope": "app" }]
]
```

| Value of `trust_ladder` | Result |
|---|---|
| omitted | Nothing is seeded — the levels tables exist and stay empty |
| a slug (`"humanity"`, `"metered"`) | The shipped ladder of that name is seeded |
| an array of rungs | The caller's own ladder, inline |

> **App scope only.** A ladder is seeded at provisioning time, and an entity-scoped ladder would belong to an organization that does not exist yet. Request `scope: "app"`; org-scoped ladders are seeded when the org is created.

> **The events module is what carries levels.** The levels, requirements, grants, and reward tables all come from `events_module`. A database without an `events_module` entry has no ladder and no way to earn one.

## Shipped Ladders

### `humanity` — is there someone behind this account?

Two rungs, and no capacity rewards. The ladder for apps that care *whether* an account belongs to someone rather than how much it consumes.

| Level | Evidence | Group | Reward |
|---|---|---|---|
| `reachable` | `email.verified` | `contactable` | capability `level.reachable` |
| `reachable` | `phone.verified` | `contactable` | capability `level.reachable` |
| `reachable` | `captcha.passed` | `contactable` | capability `level.reachable` |
| `profile_complete` | `terms.accepted` | — | *(none)* |
| `profile_complete` | `privacy.accepted` | — | *(none)* |
| `profile_complete` | `username.chosen` | — | *(none)* |
| `profile_complete` | `avatar.uploaded` | — | *(none)* |

`reachable` does not prove a human. It proves the account can be reached, which is what makes later consequences possible — and it is cheap for a person, annoying for a farm.

`profile_complete` deliberately rewards nothing. It is a badge: the thing to render a progress bar for. Onboarding completeness is not trust, and giving it a capability is how a checklist quietly becomes an access grant.

Humans, bots and agents climb this identically. Nothing in it asserts humanity — it accumulates evidence that costs something to fake.

### `metered` — how much may this account consume?

Five earning rungs that buy capacity, plus the same `profile_complete` badge. Opt in only where consumption is actually rationed.

| Level | Evidence | Reward | Capacity |
|---|---|---|---|
| `reachable` | `email.verified` / `phone.verified` / `captcha.passed` *(any one)* | `level.reachable` | +4,500 `api_requests_per_day` |
| `accountable` | `payment_method.added` / `identity.verified` *(any one)* | `level.accountable` | +95 `outbound_messages_per_day` |
| `established` | `account_age_days` ≥ 30 **and** 25 × `action.completed` | `level.established` | +45,000 `api_requests_per_day` |
| `trusted` | `account_age_days` ≥ 90 **and** 250 × `action.completed` | `level.trusted` | +900 `outbound_messages_per_day` |
| `vouched` | 2 × `vouch.received` | `level.vouched` | +23 `invites_sent` |

`established` and `trusted` want longevity **and** activity, both: age alone is free to wait out, and activity alone is cheap to manufacture. Age comes from the `account_age_days` metric, computed from the actor row rather than materialised as daily events.

`vouched` spends someone else's reputation, so its threshold is low and its reward is the one that lets an account create more accounts.

The amounts are starting points meant to be tuned, and they step by roughly an order of magnitude per rung — useful early, worth climbing to rather than automating around.

**`metered` pays into a baseline**, seeded separately through the limits module:

```json
[
  ["events_module", { "scope": "app", "trust_ladder": "metered" }],
  ["limits_module", { "scope": "app", "limit_defaults": "metered" }]
]
```

| Limit | Baseline for an unproven principal |
|---|---|
| `api_requests_per_day` | 500 |
| `outbound_messages_per_day` | 5 |
| `invites_sent` | 2 |

Without the baseline, the ladder deposits credits into limits that were never defined. Small enough that an unproven principal cannot do damage at volume, large enough to finish signing up and look around.

## Rung Fields

Each rung of an inline ladder takes:

| Field | Required | Meaning |
|---|---|---|
| `level` | yes | Level earned when the requirement is met. Rungs sharing a `level` all belong to it |
| `event` | either | Event type counted towards the rung. Mutually exclusive with `metric` |
| `metric` | either | Computed signal compared against `required_count`, e.g. `account_age_days` |
| `required_count` | no | Threshold; defaults to 1 |
| `capability` | no | Level capability the rung projects into. **Omitted → a badge that spends no bit** |
| `group` | no | Rungs sharing a group are *alternatives*: any one satisfies the level, and they pay their reward once |
| `limit` | no | Default-limit name this rung deposits credits into |
| `limit_amount` | no | Credits deposited into `limit`; defaults to 0 |

Two rungs of the same `level` with **no** `group` are *conjunctive* — both are required. That is the difference between "verify email **or** phone" and "be 30 days old **and** have completed 25 actions".

The `capability` a rung names must already exist as a capability row with `kind = 'level'`; provisioning creates the ones a shipped ladder needs. Naming one that does not exist raises `CAPABILITY_NOT_FOUND`.

## Retuning a Ladder

The numbers in a ladder are product decisions, so they are rows a tenant can change, not a generator it must fork. A database that has tuned its own rungs can capture them back out as a document and register it as a named preset, which later databases can then request by slug exactly like a shipped one.

Prefer this over inlining a large ladder into every provisioning call: the slug is versioned content, an inline array is a copy.

## Gotchas

- **`minimal` has no ladder.** `auth:hardened`, `b2b:storage` and `full` each install `events_module` with `trust_ladder: 'humanity'`; `minimal` installs no events module at all, by design. A database provisioned from `minimal`, or from a hand-written module list that omits the ladder, has **zero** `kind = 'level'` capability rows, and a policy gating on `level.reachable` will never admit anyone.
- **Owners and admins hold every level.** Their membership is given the complete capability set, levels included, so they satisfy every rung the moment they are made an owner — including rungs nobody has earned. A ladder cannot gate an owner inside their own entity. See [`constructive-access-control` → admin-owner-member.md](../../constructive-access-control/references/admin-owner-member.md#owner-and-admin-hold-every-capability).
- **Blueprint `achievements[]` cannot award capabilities.** Its `rewards[]` accepts `limit_credit` and `meter_credit` only. Capability rewards come from the ladder path; an achievement is the credit-granting half of the same machinery.
- **A level is earned, never granted.** Never offer a `kind = 'level'` capability in a grant or profile picker — filter capability lists by `kind`, or an operator can hand out trust that was supposed to cost something.
- **Badges are not trust.** A rung with no `capability` grants nothing by design. Give `profile_complete` a bit and you have made "uploaded an avatar" an access decision.

## See Also

- [achievements.md](./achievements.md) — levels, requirements, and credit rewards
- [event-tracker.md](./event-tracker.md) — recording the events a rung counts
- [`constructive-access-control` → named-capabilities.md](../../constructive-access-control/references/named-capabilities.md) — the capability model levels project into
- [`constructive-billing` → limits.md](../../constructive-billing/references/limits.md) — the limits a rung deposits credits into
