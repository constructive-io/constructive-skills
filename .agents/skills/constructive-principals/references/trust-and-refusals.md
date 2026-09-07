---
name: constructive-principals-trust-and-refusals
description: Trust-gated principal capabilities — the agent trust ladder preset, unlock rewards that withhold bits until a level is earned, expires_interval decay, revoked_by demotion (token.refresh_reused, PRINCIPAL_CHILD_WIDENS), refusal events recorded under their error code by ErrorEventsPlugin, and the limit_refusals view.
---

# Trust, Unlocks & Refusal Events

Owners and admins hold every bit, so a trust ladder can never *add* capability to a principal — it **withholds** it until earned:

```
effective = authority_capabilities & allowed_mask & ~(locked & ~unlocked)
```

- `locked` — the bits named by this scope's `unlock` rewards.
- `unlocked` — the subset whose rung the principal currently holds (same actor, same entity, not expired).

Ladders, unlocks, decay and demotion are all **per scope**: an org's ladder gates that org's bits, resolved against that org's capability catalog. A scope without an events module has no ladder and nothing is withheld. Grant changes re-derive the principal immediately (earn, expire, revoke, demote).

## Ladder rung fields that matter for principals

The base fields (`level`, `event`, `metric`, `required_count`, `capability`, `group`, `limit`, `limit_amount`) are documented in [`constructive-events` → trust-ladders.md](../../constructive-events/references/trust-ladders.md). The agent-auth sprint added:

| Field | Type | Meaning |
|-------|------|---------|
| `period_interval` | interval literal | Counting window for `event` (`'30 days'`); omitted counts for life |
| `expires_interval` | interval literal | How long a grant of `level` lasts before it lapses; omitted never lapses |
| `revoked_by` | `string[]` | Event names whose recording for an actor **revokes** `level` and **resets their progress** toward it (so it is not immediately re-earned). A refusal's error code *is* its event name, so lifecycle events (`token.refresh_reused`) and error codes (`PRINCIPAL_CHILD_WIDENS`) share one flat list |
| `unlocks` | `string[]` | Permission names from *this scope's* catalog withheld from principals until they hold `level`. An unknown name **fails the seed** rather than silently un-gating |

`revokeAchievement` (the mutation the ladder uses under the hood) also resets progress, so a manual demotion behaves the same as an event-driven one.

## The `agent` preset

Shipped trust-ladder preset, requested by slug exactly like `humanity` / `metered`:

```json
["events_module", { "scope": "org", "trust_ladder": "agent" }]
```

| Level | Requirement | Decay | Demoted by |
|-------|-------------|-------|------------|
| `agent_proven` | 3 × `agent.run.completed` in 30 days | — | — |
| `agent_trusted` | 10 × `agent.run.completed` in 30 days | `expires_interval: '30 days'` | `token.refresh_reused`, `PRINCIPAL_CHILD_WIDENS` |

**The preset ships no `unlocks`.** Which bits an untrusted agent is denied is the scope administrator's decision — inline the ladder (or capture and re-register it, see the events skill) and name them:

```json
["events_module", {
  "scope": "org",
  "trust_ladder": [
    { "level": "agent_proven",  "event": "agent.run.completed", "required_count": 3,  "period_interval": "30 days" },
    { "level": "agent_trusted", "event": "agent.run.completed", "required_count": 10, "period_interval": "30 days",
      "expires_interval": "30 days",
      "revoked_by": ["token.refresh_reused", "PRINCIPAL_CHILD_WIDENS"],
      "unlocks": ["manage_services", "manage_domains"] }
  ]
}]
```

Read that as: a principal in this org may not `manage_services` / `manage_domains` until it has completed ten runs in 30 days; a replayed refresh token or an attempt to widen a child takes those bits away again and zeroes its run count.

### Events the ladder counts

| Event | Recorded by | Attributed to |
|-------|-------------|---------------|
| `agent.run.completed` | The scope's invocations ledger when a run finishes | the principal |
| `token.refresh_reused` | `refreshAccessToken` on replay — recorded through the recorder of **every** entity the principal reaches, because a leaked credential is evidence about the credential, not one scope | the principal |
| `PRINCIPAL_CHILD_WIDENS` (any error code) | `ErrorEventsPlugin` (see below) | the principal (falls back to the human if there is none) |

## Refusal events — the error code is the event name

When a mutation is refused, `ErrorEventsPlugin` in `@constructive-io/graphql-server` records one event **after** the transaction has rolled back, so the evidence survives the refusal that caused it. The event is recorded through the scope's events module (`record_error`) under the **error code itself** — `PRINCIPAL_CHILD_WIDENS`, `LIMIT_REACHED`, … exactly as the database raised it. Nothing is prefixed and there is no separate refusal event type: the code you see in the GraphQL error response is the name you put in `revoked_by`.

| Event field | Value |
|-------------|-------|
| `name` | The application error code, e.g. `PRINCIPAL_CHILD_WIDENS`, `LIMIT_REACHED`, `API_KEY_LIMIT_REACHED` |
| `payload.operation` | The mutation name that failed |

The events module registers every such code as an event type with `category = 'error'` and `feeds_levels = false`, so a refusal can **demote** (via `revoked_by`) but never **earns** ladder progress. Error codes are `UPPER_SNAKE` and lifecycle events are `dotted.lowercase`, so the two never collide in the shared namespace.

Codes worth gating on for an agent ladder:

| Code | Meaning |
|------|---------|
| `PRINCIPAL_CHILD_WIDENS` | Tried to mint a child broader than itself |
| `PRINCIPAL_CANNOT_CREATE_PRINCIPAL` | A principal called a human-only management verb |
| `LIMIT_REACHED`, `RATE_LIMIT_EXCEEDED`, `INVOCATION_RATE_LIMIT_EXCEEDED` | Quota refusals |
| `API_KEY_LIMIT_REACHED` | Too many standing keys |

Only **authenticated mutations** are recorded — query errors and anonymous traffic never write events, and internal/unmasked errors (bugs, not refusals) are logged rather than recorded. Endpoints without an events module record nothing. The client's error response is unchanged.

## `limit_refusals` — the refusals a tenant can see

Each scope with an events module exposes a **security-invoker view**, `limit_refusals`, granted to `authenticated`. It is the plan/quota/rate family of refusal events — event name in `LIMIT_REACHED`, `RATE_LIMIT_EXCEEDED`, `INVOCATION_RATE_LIMIT_EXCEEDED`, `API_KEY_LIMIT_REACHED`, `IDENTITY_PROVIDER_QUOTA_EXCEEDED` — one row per refusal, so an app can show "who hit which wall and when" without reading the raw ledger.

| Column | Meaning |
|--------|---------|
| `id` | Event id |
| `actorId` | The principal (or human) that was refused |
| `code` | The refusal code (the event name) |
| `operation` | The mutation that was refused |
| `count` | Occurrences folded into this row |
| `createdAt` | When |

Because it is a tenant-generated view it does **not** appear in the platform auth ORM. After codegen against **your tenant's** endpoint it is a read-only model (inflected from `limit_refusals`); query it with the ordinary `findMany` / `findOne` surface from [`constructive-orm`](../../constructive-orm/SKILL.md), filtering on `actorId` / `code` / `createdAt`. Security-invoker means the events table's RLS decides visibility: your own rows, or everything if you hold `manage_events`.

## Gotchas

- **Trust cannot widen.** A principal with `allowedMask` lacking a bit never gains it by climbing; the ladder only lifts a *withhold* on bits it already has from its owner. Widening is `setPrincipalScope`, a human decision.
- **`unlocks` are scope-local names.** `manage_services` in the org catalog and `manage_services` in the app catalog are different bits; declare the ladder in the scope whose bits you mean.
- **Demotion resets progress.** After `token.refresh_reused` the agent starts the ten-run count over; it is not one run away from re-earning `agent_trusted`.
- **Badges still grant nothing.** A rung with neither `capability` nor `unlocks` records that the agent has proven something; it does not change authorization.
- **No events module → nothing withheld.** `minimal` installs no ladder; provisioning from it leaves agents at full `allowed_mask` authority. Install `events_module` with a ladder in every scope where you rely on trust gating.

## See Also

- [access-tokens.md](./access-tokens.md) — `REFRESH_TOKEN_REUSED` and the cascade it triggers
- [delegation.md](./delegation.md) — `PRINCIPAL_CHILD_WIDENS` and the other narrow-only errors
- [`constructive-events` → trust-ladders.md](../../constructive-events/references/trust-ladders.md) — `humanity`, `metered`, base rung fields, retuning
- [`constructive-billing` → limits.md](../../constructive-billing/references/limits.md) — the quota refusals `limit_refusals` surfaces
