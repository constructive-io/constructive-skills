# Static (bucket-backed) sites

A static site is a public bucket, a `site` row pointing at it, a `siteWebConfig` row with the serving rules, and a route from a hostname to the site. `sitesProvisionStaticSite` creates all of them in one transaction; the static gateway then serves GET/HEAD by resolving the route and streaming from the bucket. Content is live — re-upload an object and the next request serves it (no reconcile, no cache). Deploying content as an immutable release instead is [releases-and-previews.md](./releases-and-previews.md).

## Provision

```typescript
const { sitesProvisionStaticSite } = await db.mutation
  .sitesProvisionStaticSite(
    {
      input: {
        name: 'docs',                          // site name; also the bucket key (unique per scope)
        label: 'docs',                         // -> docs.<apex>
        apex: 'sites.example.com',             // optional: a published managed domain; omit for the default apex
        siteConfig: {
          index_document: 'index.html',
          clean_urls: true,
          spa_fallback: true,
          not_found_path: '404.html',          // becomes a siteErrorPage row for status 404
          metadata: {},
        },
      },
    },
    { select: { result: { select: { id: true, path: true, domainId: true, targetSiteId: true } } } },
  )
  .unwrap();

const route = sitesProvisionStaticSite?.result;   // the created route
const siteId = route?.targetSiteId;
```

Input (`SitesProvisionStaticSiteInput`): `name`, `label?`, `apex?`, `hostname?`, `routePath?`, `siteConfig?`. Use **either** `label` (+ optional `apex`) for a subdomain under a published apex **or** `hostname` for an explicit domain you own. `routePath` defaults to `/`. Unknown `siteConfig` keys are silently ignored, so spell them exactly as above.

Platform lane: `db.mutation.platformSitesProvisionStaticSite`, same input.

## What it creates, and how to read it back

```typescript
const { site } = await db.site
  .findOne({
    where: { id: siteId },
    select: {
      id: true, name: true, bucketId: true, activeCommitId: true, isPublished: true,
      siteWebConfig: { select: { indexDocument: true, cleanUrls: true, spaFallback: true } },
      siteErrorPages: { select: { statusCode: true, objectPath: true } },
    },
  })
  .unwrap();
```

| Row | Model | What it carries |
|---|---|---|
| bucket | storage target (see [`constructive-storage`](../../constructive-storage/SKILL.md)); referenced by `site.bucketId` | key = site name; public |
| site | `db.site` | `bucketId`, `activeCommitId` (null = serve bucket root), `isPublished` |
| web config | `db.siteWebConfig` | `indexDocument`, `cleanUrls`, `spaFallback`, `metadata` |
| error pages | `db.siteErrorPage` | one row per `statusCode` → `objectPath` |
| domain | `db.domain` | the claimed hostname |
| route | `db.route` | `domainId` + `path` → `targetSiteId` |

Adjust serving rules after the fact with ordinary updates:

```typescript
await db.siteWebConfig
  .update({ where: { id: webConfigId }, data: { spaFallback: false, cleanUrls: true }, select: { id: true } })
  .unwrap();

await db.siteErrorPage
  .create({ data: { siteId, databaseId, statusCode: 500, objectPath: '500.html' }, select: { id: true } })
  .unwrap();
```

## Upload content

Files go into the site's bucket through the storage presigned-upload flow (`requestUploadUrl` → `PUT` → done) documented in [`constructive-storage`](../../constructive-storage/SKILL.md). For a bucket-root site, object keys are the served paths (`index.html`, `assets/app.js`). For a released site, bytes live at `cas/sha256/<sha256>` and the manifest maps paths to hashes — see [releases-and-previews.md](./releases-and-previews.md).

A route whose bucket has nothing uploaded yet serves 404 — the "site exists, nothing uploaded" state, not an error.

## Apexes and hostnames

Subdomain assignment (`label`) only claims labels under a **published** managed domain: a `managedDomain` row with `isWildcard: true` and `allowPublicUsage: true`. Otherwise the verb fails with `SUBDOMAIN_APEX_NOT_PUBLISHED`.

```typescript
// Publish an apex (requires app-admin authority; MANAGED_DOMAIN_PUBLISH_FORBIDDEN otherwise)
await db.managedDomain
  .create({
    data: { databaseId, domain: 'sites.example.com', isWildcard: true, allowPublicUsage: true },
    select: { id: true, domain: true, verificationStatus: true, tlsStatus: true },
  })
  .unwrap();

// Which apexes can I use?
const { managedDomains } = await db.managedDomain
  .findMany({
    where: { isWildcard: { equalTo: true }, allowPublicUsage: { equalTo: true } },
    select: { domain: true, tlsStatus: true, verificationStatus: true },
  })
  .unwrap();
```

Claim a subdomain on its own (without provisioning a site) with `domainsAssignSubdomain`:

```typescript
const { domainsAssignSubdomain } = await db.mutation
  .domainsAssignSubdomain(
    { input: { apex: 'sites.example.com', label: 'launch' } },     // omit label for a generated one
    { select: { result: { select: { id: true, hostname: true, isPublished: true } } } },
  )
  .unwrap();
```

| Code | Meaning |
|---|---|
| `SUBDOMAIN_APEX_NOT_PUBLISHED` | Apex is not a published wildcard managed domain |
| `SUBDOMAIN_LABEL_INVALID` | Label must match `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` |
| `SUBDOMAIN_LABEL_EXHAUSTED` | No free generated label within `maxAttempts` |
| `DOMAIN_ALREADY_CLAIMED` | Explicit `hostname` already routed by another owner |

Tenant-lane sites are routable once `isPublished` is true; platform-lane sites are routable immediately.

## Serving behaviour

- `/` and directory paths resolve to `indexDocument`; `cleanUrls` (default on) retries `<path>.html` for extensionless paths; `spaFallback` serves the index for any miss. POST is 405.
- `siteErrorPage` rows are served for their status code with the original status preserved.
- Site origin (`https://host`, no trailing slash) for canonical URLs, sitemaps and emails: `db.query.sitesSiteOrigin({ targetSiteId })`. An explicit `siteMetadatum.canonicalUrl` wins over the routed hostname; otherwise the origin is the site's verified, non-wildcard hostname.
- The route insert triggers edge reconciliation asynchronously; a brand-new apex can take a moment to answer.

## Composing a hostname across targets

Route resolution takes the **longest matching path prefix**, so one hostname can mix a static site, a service and the Mantra auth pages:

```typescript
await db.route
  .create({
    data: { databaseId, domainId, path: '/api', targetServiceId: apiServiceId },
    select: { id: true, path: true },
  })
  .unwrap();
```

Routes are unique per `(domain, path, method)`. A hostname's first route auto-creates a `/` route with the same target, which is why Mantra refuses to be the first route on a hostname ([mantra.md](./mantra.md)).

## Cleanup

Delete the `route` (`db.route.delete`) to stop serving without deleting content; delete the `site` (`db.site.delete`) to remove the property and its owned rows (web config, error pages, metadata, release, pages, app links, deep links all key on `siteId`).
