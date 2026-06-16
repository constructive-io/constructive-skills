# Phase 1: Backend Up

**Goal:** Provision the Constructive database and start the GraphQL server.

> **This is one of 4 mainline phases:** (1) Backend Up → (2) Data Model Provisioned →
> (3) Frontend + SDK → (4) UI / Blocks. Side-quests (search, email, standalone SDK, seed) live in the
> **Optional Extensions** appendix of the slim SKILL.md — they are not on the mainline path.
>
> **Fast path (warm backend):** if a Constructive backend is already running with the pnpm store warm
> (the realistic iterative-dev loop), **skip Phase 1** and start at Phase 2
> ([phase-2-data-model.md](./phase-2-data-model.md)). Phase 1 is the cold-infra floor (Docker pull +
> `pgpm deploy`); reusing a live backend is the single biggest wall-clock saver. The speedrun
> ([speedrun.md](./speedrun.md) S0) smokes the warm hub first and assumes you skip Phase 1.

## Bring the hub up (constructive-hub is the standard local backend)

The reference local backend is **constructive-hub** (Docker Postgres + the GraphQL servers + the
admin dashboard). The full bring-up — COLD vs WARM, the health-gate curl, ports, the `/etc/hosts`
IPv6/IPv4 caveat, and Mailpit — is in **[infra-setup.md](./infra-setup.md)**. In short:

```bash
# COLD (first time / clean machine): clone+bootstrap+start. Docker Postgres image is postgres-plus:18.
cd <constructive-hub> && pnpm bootstrap && pnpm start
# WARM (already bootstrapped): just (re)start, then health-gate it.
cd <constructive-hub> && pnpm start          # or `pnpm restart`
```

> **Postgres image is `postgres-plus:18`** (`ghcr.io/constructive-io/docker/postgres-plus:18`, in the
> hub's `docker-compose.yml`). Do NOT use the legacy `pyramation/postgres:17` image — it is stale.

The two phase numbers map to the same hub once it is up: `pgpm deploy` lands the platform metaschema,
and the GraphQL server answers on `:3000`.

## Reference skills

| Step | Skill | Repo |
| ---- | ----- | ---- |
| 1.1  | `constructive-db-local-dev-setup` (constructive-db repo `.agents/skills/`) | db |
| 1.2  | pnpm-module patterns — see the `constructive-io/constructive` repo | public |

> **Execution Order:** the database must be deployed before starting the GraphQL server.

## Health gate

The server answers a POST healthcheck on `localhost` with a `Host` header and a JSON body. This is the
same gate the speedrun S0 runs:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/graphql \
  -H 'Host: api.localhost' -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# 200 = up. 000 / non-200 = down or OOM — see infra-setup.md (restart once with
# NODE_OPTIONS=--max-old-space-size=8192 for the GAP-7 OOM case).
```

> The `:3002` private endpoint is **IPv6-only** and is a **decoy** for app builds — ignore it; smoke
> `:3000` only.

## Phase 1 Checklist

- **1.0** Consulted [troubleshooting.md](./troubleshooting.md) for Phase 1 (search for "Phase 1")
- **1.1** Postgres is running (Docker container up — image `postgres-plus:18`)
- **1.2** Postgres env vars set (`PGUSER`, `PGHOST`, `PGPASSWORD`, `PGDATABASE`, `PGPORT`)
- **1.3** Database deployed without errors (`pgpm deploy` successful and `constructive` exists)
- **1.4** GraphQL server responds to the POST healthcheck (`localhost` + `Host` header + JSON body;
  `{ __typename }` returns 200)
- **1.5** Run automated verification: `./scripts/verify-phase.sh 1`

**If 1.4 hangs or curl always returns 000 →** See [troubleshooting.md](./troubleshooting.md)
("Phase 1: GraphQL Server not responding" / "Phase 1: Agent stuck on nohup + curl verification") and
[infra-setup.md](./infra-setup.md) (the OOM restart-once recipe). Cross-ref [error-index.md](./error-index.md)
and [platform-gaps.md](./platform-gaps.md) GAP-7.

> **After the gate passes (Rule 7 — see [speedrun.md](./speedrun.md) "Checkpoint + run-state"):** set
> `platform.postgres_ready` + `platform.graphql_ready` true in the run-state JSON, then `git commit`
> (tag `green-phase-1`). This is your rollback point.

---

## Repo Key

| Alias | Repository |
| ----- | ---------- |
| **public** | `constructive-io/constructive-skills` |
| **db** | `constructive-io/constructive-db` |
| **tooling** | `constructive-io/constructive` |
