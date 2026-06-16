# Infra Setup — bring up constructive-hub

The Constructive **hub** is the local backend every app build talks to: Docker Postgres + the GraphQL
servers (public `:3000`, private `:3002`) + MinIO + Mailpit + the admin dashboard. The reference
implementation is **constructive-hub** (an E2E harness that orchestrates `constructive`, `constructive-db`,
and `dashboard` as git submodules). `<constructive-hub>` below = your local checkout of that repo.

> **You usually do NOT bring this up from scratch.** On a warm machine the hub is already running — the
> [speedrun.md](./speedrun.md) S0 smoke + Phase 1 skip is the normal path. This file is for COLD bring-up
> (clean machine) and for the WARM health-gate / restart-once recovery.

---

## COLD bring-up (clean machine / first run)

```bash
cd <constructive-hub>
pnpm bootstrap        # install deps + build submodules (~2-3 min). Adds NO Playwright browsers.
pnpm start            # start all services: Docker (Postgres+MinIO+Mailpit) + DB deploy + GraphQL servers + dashboard
```

- For running the Playwright E2E suite instead, use `pnpm bootstrap:full` (install + Playwright + build,
  ~5-7 min) then `pnpm start`. App builds do **not** need Playwright — `pnpm bootstrap` is enough.
- **Prerequisites:** Docker Desktop, pnpm >= 10, Node.js >= 20.

> 🚨 **The Docker Postgres image is `postgres-plus:18`** —
> `ghcr.io/constructive-io/docker/postgres-plus:18` (in the hub's `docker-compose.yml`). Do **NOT** use
> the legacy `pyramation/postgres:17` image; it is stale and will not match the platform schema.

Service / teardown commands (hub `package.json` scripts):

| Command | Description |
|---------|-------------|
| `pnpm start` | Start all services (Docker + DB + servers + dashboard) |
| `pnpm stop` | Stop all services |
| `pnpm stop --force` | Stop + kill any external process holding our ports |
| `pnpm restart` | `pnpm stop && pnpm start` |
| `pnpm status` | Service status (includes port-conflict detection) |
| `pnpm log` (`-f` to follow) | View service logs |
| `pnpm docker:up` / `pnpm docker:down` | Just the Docker layer (Postgres/MinIO/Mailpit) |

---

## WARM path — health-gate, then restart-once on failure

On a warm machine, don't rebuild — **gate** the shared public server, and only restart if it's down.

### The health gate (the canonical curl)

```bash
curl -s -o /dev/null -w 'HTTP-%{http_code}\n' http://localhost:3000/graphql \
  -H 'Host: api.localhost' -H 'content-type: application/json' -d '{"query":"{ __typename }"}'
# Expect: HTTP-200  → the hub is up; skip Phase 1, go to the speedrun S1.
# HTTP-000 / non-200 → down or OOM. Restart once (below), then re-run this exact gate.
```

The body MUST be a POST with the `Host` header — routing is by `Host`, not path, and a GET will not
exercise the per-DB router. (This is the same gate [speedrun.md](./speedrun.md) S0 and
[phase-1-backend.md](./phase-1-backend.md) run.)

### Restart-once (GAP-7 — the shared `:3000` server is heap-fragile)

The shared `:3000` public server is **heap-fragile under multi-DB load** and can be down or return `000`
even when "told it's running" — the per-DB handler cache OOMs. Restart it **once** with a big heap:

```bash
# Whole-hub restart (preferred when more than the GraphQL server is wedged):
cd <constructive-hub> && pnpm restart

# OR, single-server restart with an 8 GB heap when ONLY the GraphQL server died (the GAP-7 fix):
NODE_OPTIONS=--max-old-space-size=8192 \
  node <constructive-hub>/constructive/packages/cli/dist/index.js server \
  --port 3000 --host 0.0.0.0 --origin '*' >/tmp/cnc-3000.log 2>&1 &
# env it needs: API_IS_PUBLIC=true API_ANON_ROLE=anonymous API_ROLE_NAME=authenticated + the hub .env.
# If it OOMs AGAIN mid-run, it is the per-DB handler cache — the 8192 heap above is the fix; do not loop
# restarts without raising the heap. (See platform-gaps.md GAP-7 / troubleshooting.md "Agent stuck on
# nohup + curl".)
```

Then re-run the health gate above. Do not start `pgpm deploy` / Docker from scratch on a warm machine —
that is COLD bring-up and throws away the warm pnpm store.

---

## Endpoint map (what routes where)

Routing is driven by the HTTP **`Host` header** (a role-subdomain on a `dot-localhost` host), **NOT** by
the URL path — the path is always `/graphql`. `{sub}` is the per-app subdomain (the database name with
hyphens collapsed); PostGraphile maps it back to the physical schema. (`{sub}` is a **platform-assigned**
identifier discovered from `create-db.ts` output, NOT necessarily the literal db_name — see
[architecture-overview.md](./architecture-overview.md).)

| Role | Host pattern | Purpose |
|------|--------------|---------|
| **data** | `api-<sub>.localhost:3000` | your app's business DATA (reads/writes). **NOT** `app-public-<sub>` (dead) |
| **auth** | `auth-<sub>.localhost:3000` | per-app users / authentication |
| **admin** | `admin-<sub>.localhost:3000` | per-app orgs / members / permissions |
| **provisioning** | `modules.localhost:3000` | blueprint / provisioning writes (these 404 on `api.localhost`) |
| **control-plane** | `api.localhost:3000` | platform API (database creation); also the bare health-gate host |
| platform auth | `auth.localhost:3000` | platform sign-up / sign-in (base, not per-app) |

> 🚨 **`:3002` is an IPv6-only PRIVATE decoy — ignore it for app builds.** The private GraphQL endpoint
> binds IPv6-only and is for internal/admin tooling (e.g. the dashboard's meta GraphQL). App builds talk to
> the public `:3000` server exclusively; smoke and target `:3000` only.

### Port map (hub)

| Service | Port |
|---------|------|
| Dashboard (admin UI) | 3001 |
| Public GraphQL | 3000 |
| Private GraphQL | 3002 (IPv6-only decoy for app builds) |
| PostgreSQL | 5432 |
| MinIO API | 9000 |
| Mailpit SMTP | 1025 |
| **Mailpit UI / API** | **8025** |
| Job Service | 8080 |
| Email Function | 8082 |

The app's own Next.js dev server is separate (canonical port **3081**; the brief may override via
`generated.frontend_port`). The local component-registry fallback serves on **4081**
([blocks-onramp.md](./blocks-onramp.md)).

---

## /etc/hosts + the `*.localhost` IPv6/IPv4 caveat (browser-side QA)

The hub's public server binds **IPv4** (`host: 0.0.0.0` in the hub config). But on macOS/many Linux
resolvers, **`*.localhost` resolves to `::1` (IPv6)** — so a *browser* hitting `http://api-<sub>.localhost:3000`
can connect to the IPv6 loopback where nothing is listening, and the request fails even though the server
is up on IPv4.

- **Server-side / curl** generally works because `curl` and the SDK handle the routing (and Node's
  `*.localhost` resolution is itself unreliable — the SDK sets the `Host` header explicitly for both Node
  and browser; see [architecture-overview.md](./architecture-overview.md)).
- **Browser-side QA needs explicit IPv4 `/etc/hosts` entries** (or a dual-stack server bind). Add the
  hosts you actually drive in the browser, pointed at `127.0.0.1`:

```
# /etc/hosts — IPv4 entries so the browser reaches the IPv4-bound hub (NOT ::1)
127.0.0.1   api.localhost
127.0.0.1   dbe.localhost
127.0.0.1   api-<sub>.localhost auth-<sub>.localhost admin-<sub>.localhost
```

At minimum the platform needs **`api.localhost`** (control-plane / schema-builder GraphQL) and
**`dbe.localhost`** (the dashboard / CRM GraphQL endpoint). Add the per-app `api-<sub>` / `auth-<sub>` /
`admin-<sub>` hosts for whatever app the live-QA / evaluator drives in Chrome. The alternative is a
dual-stack bind, but adding the IPv4 hosts entries is the reliable, local fix.

---

## Mailpit (email round-trips — `:8025`)

Email-driven flows (verify-email, **password-reset**, invites) deliver to the local Mailpit catcher at
`http://localhost:8025` (web UI + JSON API). The live-QA driver polls Mailpit's API to confirm a message
arrived for a flow like password-reset (a full round-trip: request reset → poll Mailpit → extract the
link → complete). The Mailpit URL is config-driven: `constructive.config.json` `mail.url`, overridable via
`CONSTRUCTIVE_MAILPIT_URL` ([secrets-and-config.md](./secrets-and-config.md)).

> **Email flows need the email services up.** The email-free flows (`email-password`) run on a bare warm
> hub; flows that send mail need Mailpit + the email function (`:8082`) + job service (`:8080`) listening
> — `pnpm start` brings them up. If a reset never lands, check `pnpm status` and that `:8025` answers.

---

## Quick reference

```bash
# Is the hub up?  (warm-path gate)
curl -s -o /dev/null -w 'HTTP-%{http_code}\n' http://localhost:3000/graphql \
  -H 'Host: api.localhost' -H 'content-type: application/json' -d '{"query":"{ __typename }"}'

# Bring it up cold / restart it
cd <constructive-hub> && pnpm bootstrap && pnpm start      # cold
cd <constructive-hub> && pnpm restart                      # warm restart
pnpm status                                                # health + port conflicts

# Mailpit reachable?
curl -s -o /dev/null -w 'HTTP-%{http_code}\n' http://localhost:8025
```

See [troubleshooting.md](./troubleshooting.md), [error-index.md](./error-index.md), and
[platform-gaps.md](./platform-gaps.md) (GAP-7 OOM) when a gate stays red.
