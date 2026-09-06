# Mantra — the platform's auth/legal page set

Mantra is a set of pre-built platform functions published as tasks named `mantra:<task>`. Installing it writes **ordinary function-target routes** onto a site's hostname — no new routing concept, no new serving lane, nothing to reconcile. Provisioning a site does not install it; it is one explicit call.

## Install

The site must **already serve a hostname** — Mantra's routes hang off that domain (see the trap below):

```typescript
const { sitesInstallMantra } = await db.mutation
  .sitesInstallMantra(
    { input: { siteId } },                       // routePreset defaults to 'mantra'
    { select: { result: { select: { id: true, name: true } } } },
  )
  .unwrap();
```

`SitesInstallMantraInput`: `siteId`, `entityId?`, `routePreset?`. The call is **idempotent per (hostname, path)**: re-running installs only what is missing, so it is safe in a provisioning script or on every deploy.

## What gets installed

Paths, and deliberately **no `/` and no catch-all**:

```
/login             /forgot-password    /auth/start       /terms       /robots.txt         /_mantra/runtime.js
/logout            /reset-password     /auth/callback    /privacy     /sitemap.xml        /_mantra/styles.css
/signup            /2fa                                               /site.webmanifest
```

Each maps to a `mantra:*` task (`signin`, `signout`, `signup`, `forgot`, `reset`, `two_factor`, `oauth_callback`, `terms`, `privacy`, `robots_txt`, `sitemap_xml`, `webmanifest`, …). That list is **catalog data, not code** — a `contentPreset` row at `kind = 'route_bindings'`, `slug = 'mantra'` on the **infra** target:

```typescript
const { contentPresets } = await infra.contentPreset
  .findMany({
    where: { kind: { equalTo: 'route_bindings' } },
    select: { id: true, slug: true, label: true, definition: true, commitId: true },
  })
  .unwrap();
```

Author your own slug and install that instead — same call, different preset:

```typescript
await db.mutation
  .sitesInstallMantra(
    { input: { siteId, routePreset: 'mantra-minimal' } },
    { select: { result: { select: { id: true } } } },
  )
  .unwrap();
```

Inspect what landed as ordinary route rows:

```typescript
const { routes } = await db.route
  .findMany({
    where: { servingSiteId: { equalTo: siteId } },
    orderBy: ['PATH_ASC'],
    select: { path: true, method: true, targetFunctionId: true, isActive: true },
  })
  .unwrap();
```

## Mixing one hostname across several targets

This is the point of claiming no root path. One hostname can serve a customer's own app **and** the platform's auth pages, because route resolution takes the **longest matching path prefix**:

```
app.acme.com/            -> their site or service   (their own route)
app.acme.com/app/*       -> their service           (their own route)
app.acme.com/login       -> mantra:signin           (installed)
app.acme.com/2fa         -> mantra:two_factor       (installed)
```

Their `/` catch-all never shadows `/login`, and adding their own `/login` later overrides Mantra's for that hostname (unique per `(domain, path, method)` — the install skips a path that already exists rather than fighting over it). Their own routes are ordinary rows:

```typescript
await db.route
  .create({
    data: { databaseId, domainId, path: '/app', targetServiceId: theirServiceId },
    select: { id: true, path: true },
  })
  .unwrap();
```

### The trap: install onto an already-routed hostname

A hostname's **first** route auto-creates a `'/'` route carrying that same target (the root-route invariant). Installing Mantra onto a bare hostname would therefore make `/` serve `mantra:signin`; the engine refuses with `ROUTE_BINDINGS_SITE_NOT_ROUTED`. Order is always **route the site first, install Mantra second** — `sitesProvisionStaticSite` already leaves the site routed.

## Scope and permission

| | tenant lane | platform lane |
|---|---|---|
| mutation | `db.mutation.sitesInstallMantra` | `db.mutation.platformSitesInstallMantra` |
| operates on | `db.site` (keyed by `databaseId`) | `db.platformSite` |
| who may call it | any tenant caller — every read and write is confined to the session's own database | requires the `manage_sites` capability, else `NOT_AUTHORIZED` |

An **entity-keyed** scope (org/team sites) needs `entityId`, and the capability is checked for that very entity; omitting it raises `ROUTE_BINDINGS_ENTITY_REQUIRED` rather than installing against a guessed owner.

```typescript
await db.mutation
  .sitesInstallMantra({ input: { siteId, entityId: orgId } }, { select: { result: { select: { id: true } } } })
  .unwrap();
```

## What the pages need from the site

- `/terms` and `/privacy` render **site-authored** pages — install `pages:legal` ([pages-and-content-presets.md](./pages-and-content-presets.md)) or author `page` rows at those slugs, otherwise they are a deliberate 404.
- `/sitemap.xml` needs `siteMetadatum.canonicalUrl`, otherwise `MANTRA_SITE_HAS_NO_CANONICAL_URL`. `/robots.txt` and `/site.webmanifest` work without it (and `/robots.txt` honours the `robots:no-ai` preset).
- Password recovery mail needs the tenant's email sender identity configured — see [`constructive-auth`](../../constructive-auth/SKILL.md).
- A bare site has no content at `/`, so post-login redirects to `/` land on the platform "Not Found" page. That is the site being empty, not an auth failure.

## Failure codes

All fail-loud — the install never leaves a route pointing at nothing:

| code | meaning |
|---|---|
| `ROUTE_BINDINGS_SITE_NOT_ROUTED` | the site serves no hostname yet — route it first |
| `SITE_NOT_FOUND` | no such site in this scope |
| `ROUTE_BINDINGS_ENTITY_REQUIRED` | entity-keyed scope, `entityId` omitted |
| `MANTRA_BINDINGS_INVALID` | the preset is not a non-empty array of `{path, task_identifier}` |
| `FUNCTION_DEFINITION_NOT_FOUND` | a `mantra:*` task is not published at this scope |
| `NOT_AUTHORIZED` | platform/entity lane without `manage_sites` |

`ROUTE_BINDINGS_SITES_PLANE_NOT_REGISTERED`, `ROUTE_BINDINGS_ROUTES_PLANE_NOT_FOUND` and `ROUTE_BINDINGS_PLANE_KEY_MISMATCH` mean the database's routing modules are mis-provisioned, not that the call was wrong.
