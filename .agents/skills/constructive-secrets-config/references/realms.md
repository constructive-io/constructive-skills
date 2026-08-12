# Realms — one name, many values, and how a consumer picks one

A **realm** is an optional discriminator that lets a single logical name hold
many concrete values, and lets a consumer choose which value it gets. It shows up
in the ORM as a nullable `realm` field, and it plays two roles worth keeping
separate:

1. **Storage discriminator** — on a *value* (a config atom, a secret). Realm
   splits several rows that share the same `name`. One `push_token` per device
   channel, one `apns_key` per app, one `DATABASE_URL` per region — all under the
   same name, told apart by realm.
2. **Consumption selector** — on an *instance* (a `resource`, a
   `functionDeployment`). Realm chooses which value lane that instance resolves
   its required keys against.

## `NULL` is the default lane, not "missing"

`realm` is always optional. Leaving it unset (`null`) means **the default,
unqualified lane** — not an error and not a missing value. Reads resolve an exact
realm match first, then **fall back to the `null`-realm value**:

> exact realm wins → otherwise the `null`-realm value → otherwise nothing.

So the simple case is unchanged from before realms existed: store with no realm,
read with no realm. You only reach for realm when one name legitimately needs
several values.

There is **no default realm string** anywhere. A caller that doesn't care about
realms omits the field; a caller that does passes an explicit value. Don't
synthesize a realm (no `realm ?? 'default'`) — that reintroduces exactly the
null-coalescing the platform avoids on purpose.

## The `realm` field in the ORM

`realm` is a plain nullable `String` on the config and compute schemas. You
filter and select it like any other field:

```typescript
// A config atom scoped to a realm (e.g. per-region DATABASE_URL)
await db.appConfig.findMany({
  where: { name: { equalTo: 'DATABASE_URL' }, realm: { equalTo: 'eu-west-1' } },
  select: { name: true, realm: true },
}).execute();

// A resource pinned to a consumption lane
await db.resource.update({
  where: { id: resourceId },
  patch: { realm: 'eu-west-1' },   // this instance resolves its required keys from the eu lane
}).execute();
```

Reading a *secret* value back is deliberately not a plain ORM read — secrets are
write-only from the app surface and only a privileged worker can decrypt them (see
"per-user storage" below). The realm still selects *which* secret, it just isn't
returned in a readable row.

## Two consumption modes

Realm is consumed in one of two ways. An instance picks one.

- **Projection (deploy-time).** A `resource` — or a `functionDeployment` that sets
  a realm — has its required keys resolved against that realm and the values baked
  into its environment (ConfigMap/Secret) when it deploys. Fixed key set, known up
  front. Set `realm` on the instance.
- **Runtime query (on-demand).** A worker that handles many entities, each with
  its own realm, leaves its deployment's `realm` unset and instead resolves the
  realm of *the entity it is currently processing*, fetching that one value at
  that moment. The push-notification worker is the archetype: it never holds every
  device's token in its environment; it looks up the channel it is about to notify
  and fetches only that channel's token.

That is why `realm` on a function deployment is optional: projection workers set
it, runtime-query workers leave it `null`.

## Per-user / per-entity storage

Realm is how one tenant database stores a distinct value per user or per entity
under a shared name. The push flow is the canonical example: registering a device
creates a readable channel row and stores the raw device token as a **write-only**
secret keyed by that channel's id (its realm). The owner can see the channel
(platform, device name, active state) but never reads the token back; only the
delivery worker can. The general shape for anything sensitive per user/entity: a
readable identity row whose id is the realm of a write-only secret.

## When to use realm

- Use it when **one name must hold several values** (per region, per tenant-app,
  per user, per channel) — that's the storage-discriminator role.
- Use it when **an instance must choose among those values** — that's the
  consumption-selector role; set it on the `resource`/`functionDeployment`.
- Leave it `null` (the default lane) for the ordinary single-value case.
- Never put realm on a *template* (a definition). A definition declares *which*
  keys are required; the *instance* chooses the realm. That separation is what
  lets one definition serve many lanes.

## Where the internals live

Realm is a lane *within* whichever store holds the value, so read
[`secret-stores.md`](./secret-stores.md) alongside this: the internal stores key a
lane by scope + name + realm, the namespace-backed infra stores add the namespace.

The database-level mechanics — the uniqueness rules with
`NULLS NOT DISTINCT`, the getter fallback SQL, the requirements gate, the
`register_push_channel` RPC, and how cloud functions fetch per-entity realms at
runtime — are documented in **constructive-db** at
`docs/architecture/realms.md`. This skill is the SDK/ORM-level view; that doc is
the implementation reference.
