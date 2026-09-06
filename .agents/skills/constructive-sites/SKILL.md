---
name: constructive-sites
description: "Sites — provision and serve web properties through the SDK ORM: one-call bucket-backed static sites (sitesProvisionStaticSite), immutable release manifests and rollback (siteRelease, activeCommitId, getSiteReleaseManifest), named preview hostnames (provisionSitePreview, setSitePreview, getSitePreviewCommit, deleteSitePreview), Merkle-versioned pages (db.page, pagePublished), Mantra auth/legal pages (sitesInstallMantra), content presets (sitesInstallContentPreset — pages:legal, robots:no-ai), mobile app links and /l/ deep links (siteAppLink, siteDeepLink, resolveSiteAppLinks, sitesDeepLinkUrl), and the tenant-vs-platform naming rule (db.site vs db.platformSite). Use when asked to 'provision a static site', 'deploy a static build', 'release manifest', 'roll back a site', 'preview URL', 'provisionSitePreview', 'setSitePreview', 'time travel a release', 'publish a page version', 'install mantra', 'add login pages to a site', 'install legal pages', 'robots preset', 'content preset', 'universal links', 'assetlinks', 'apple-app-site-association', 'deep link', 'SUBDOMAIN_APEX_NOT_PUBLISHED', 'ROUTE_BINDINGS_SITE_NOT_ROUTED', 'SITE_PREVIEW_COMMIT_SITE_MISMATCH', or when choosing between db.site and db.platformSite."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Sites

A **site** is a routable web property: a hostname, a content origin (a bucket, an authored page set, or an installed service), and the serving rules in between. This skill covers the whole site surface from the application layer, through the generated **SDK ORM**: provisioning a bucket-backed static site in one call, deploying it as an immutable release with named previews and rollback, authoring Merkle-versioned pages, installing the platform's Mantra auth pages and content presets, and associating a mobile app with a host.

It intentionally does not cover the SQL, trigger, static-gateway or reconciler internals — those live in the `sites-*`, `mantra-auth-pages` and `testing-static-gateway-planes` skills in `constructive-db`. Every symbol below is taken from the generated `@constructive-db/constructive-sdk` ORM (the `api` target) or, where noted, the `infra` target.

## When to Apply

Use this skill when:
- Provisioning a **static site** (docs, marketing, SPA) with a bucket origin and a hostname in one call
- Deploying a build as an **immutable release**, publishing it atomically, and **rolling back** by moving a pointer
- Minting a **named preview URL** (`<name>--<site>.<apex>`) per branch and moving/retiring it
- Reading **any historical release** without publishing it (time travel)
- Authoring **pages** whose every write is versioned, and publishing a chosen version
- Installing the **Mantra** page set (sign-in/up/out, reset, 2FA, OAuth callback, legal, robots/sitemap/webmanifest) onto a site
- Seeding a site with a **content preset** (`pages:legal`, `robots:no-ai`) without overwriting tenant edits
- Associating a **mobile app** with a host (AASA / assetlinks) and adding `/l/<slug>` **deep links**
- Deciding between the **tenant** (`db.site`) and **platform** (`db.platformSite`) surfaces

Not this skill: bucket and upload mechanics ([`constructive-storage`](../constructive-storage/SKILL.md)), API-route/service deployment and DNS ([`constructive-platform`](../constructive-platform/SKILL.md)), the login flows the Mantra pages drive ([`constructive-auth`](../constructive-auth/SKILL.md)).

## Two lanes, one surface

The ORM exposes the same site surface twice. The **tenant (database) lane** is the default: unprefixed models and operations whose rows carry a `databaseId`. The **platform lane** — on-prem / self-hosted, and the platform's own sites — is the identical surface with a `platform` prefix and no scope key.

| Tenant lane | Platform lane |
|---|---|
| `db.site`, `db.siteRelease`, `db.page`, `db.route`, `db.domain`, `db.managedDomain` | `db.platformSite`, `db.platformSiteRelease`, `db.platformPage`, `db.platformDomain`, `db.platformManagedDomain` |
| `db.siteWebConfig`, `db.siteErrorPage`, `db.siteMetadatum`, `db.siteAppLink`, `db.siteDeepLink` | `db.platformSiteWebConfig`, `db.platformSiteErrorPage`, `db.platformSiteMetadatum`, `db.platformSiteAppLink`, `db.platformSiteDeepLink` |
| `db.mutation.sitesProvisionStaticSite` | `db.mutation.platformSitesProvisionStaticSite` |
| `db.mutation.provisionSitePreview` / `setSitePreview` / `deleteSitePreview` | `db.mutation.platformProvisionSitePreview` / `platformSetSitePreview` / `platformDeleteSitePreview` |
| `db.query.getSitePreviewCommit` / `getSiteReleaseManifest` / `pagePublished` | `db.query.platformGetSitePreviewCommit` / `platformGetSiteReleaseManifest` / `platformPagePublished` |
| `db.mutation.sitesInstallMantra` / `sitesInstallContentPreset` | `db.mutation.platformSitesInstallMantra` / `platformSitesInstallContentPreset` |
| `db.query.sitesDeepLinkUrl` / `sitesSiteOrigin` / `resolveSiteAppLinks` | `db.query.platformSitesDeepLinkUrl` / `platformSitesSiteOrigin` |

Rules of thumb:
- If an operation "doesn't exist", you are on the wrong lane — check for the `platform` prefix.
- Tenant `create` calls pass `databaseId` in `data`; platform calls do not.
- The platform lane checks the `manage_sites` capability (`NOT_AUTHORIZED` otherwise); the tenant lane confines every read and write to the session's own database.
- Every model call takes a required `select`. Prefer `.unwrap()` (returns data, throws on GraphQL error) over `.execute()` (returns `{ ok, data, errors }`) — swallowing `errors` is how a failed deploy looks successful.

## Client setup

```typescript
import { createClient } from '@constructive-db/constructive-sdk';

const db = createClient({
  endpoint: 'https://api.example.com/graphql',
  headers: { Authorization: `Bearer ${token}` },
});
```

## Quick start: a static site, deployed as a release

```typescript
// 1. One call: public bucket + site + web config + hostname + route.
const { sitesProvisionStaticSite } = await db.mutation
  .sitesProvisionStaticSite(
    {
      input: {
        name: 'docs',
        label: 'docs',                       // subdomain label under a published apex
        siteConfig: { spa_fallback: true, not_found_path: '404.html' },
      },
    },
    { select: { result: { select: { id: true, path: true, targetSiteId: true, domainId: true } } } },
  )
  .unwrap();
const siteId = sitesProvisionStaticSite?.result?.targetSiteId!;

// 2. Upload each file to cas/sha256/<sha256> in the site's bucket
//    (presigned upload — see constructive-storage), then commit one manifest.
const { createSiteRelease } = await db.siteRelease
  .create({
    data: {
      siteId,
      databaseId,
      manifest: {
        files: {
          'index.html': { hash: '9a3f…', content_type: 'text/html', size: 2841 },
          'assets/app.4f2c.js': { hash: '1be5…', content_type: 'application/javascript', size: 91043 },
        },
        file_count: 2,
        total_bytes: 93884,
      },
    },
    select: { id: true, commitId: true, storeId: true },
  })
  .unwrap();
const release = createSiteRelease.siteRelease;
if (!release.commitId || !release.storeId) throw new Error('release was not versioned');

// 3. Publish: one pointer move, atomic for every in-flight visitor.
await db.site
  .update({
    where: { id: siteId },
    data: { activeCommitId: release.commitId },
    select: { id: true, activeCommitId: true },
  })
  .unwrap();
```

Rollback is step 3 with an older `commitId`. A site whose `activeCommitId` is null serves straight from the bucket root (no release). Details, previews and time travel: [static-sites.md](./references/static-sites.md), [releases-and-previews.md](./references/releases-and-previews.md).

## Core models (tenant lane)

| Model | Purpose | Key fields |
|---|---|---|
| `db.site` | The web property | `id`, `name`, `title`, `description`, `bucketId`, `resourceId`, `installationId`, `activeCommitId`, `isPublished`, `databaseId` |
| `db.siteWebConfig` | 1:1 serving rules | `siteId`, `indexDocument`, `cleanUrls`, `spaFallback`, `metadata` |
| `db.siteErrorPage` | Custom error documents | `siteId`, `statusCode`, `objectPath` |
| `db.siteMetadatum` | Head/SEO facts | `siteId`, `title`, `description`, `canonicalUrl`, `favicon`, `logo`, `ogImage`, `appleTouchIcon`, `robots`, `robotsSeededFrom` |
| `db.siteRelease` | One manifest row per site (unique on `siteId`); every write is a new commit | `siteId`, `manifest`, `commitId`, `storeId` |
| `db.page` | Merkle-versioned authored content | `siteId`, `slug`, `content`, `commitId`, `storeId`, `seededFrom` |
| `db.commit` | Version history of a store | `storeId`, `treeId`, `parentIds`, `message`, `date` |
| `db.route` | Hostname + path → target | `domainId`, `path`, `method`, `priority`, `isActive`, `anonymous`, `targetSiteId`, `servingSiteId`, `targetServiceId`, `targetFunctionId`, `targetBucketId`, `targetApiId`, `targetRedirectId`, `previewRef` |
| `db.domain` | A claimed hostname | `hostname`, `parentHostname`, `isPublished`, `isWildcard`, `managed`, `verificationStatus`, `tlsStatus`, `tlsReadyAt` |
| `db.managedDomain` | A platform-managed apex under which labels are assigned | `domain`, `isWildcard`, `allowPublicUsage`, `verificationStatus`, `certStatus`, `tlsStatus` |
| `db.siteAppLink` | Host-owned mobile association | `siteId`, `appStoreIdentityId`, `pathComponents`, `webcredentials` |
| `db.siteDeepLink` | Named `/l/<slug>` link | `siteId`, `slug`, `webPath`, `fallbackUrl`, `appPath`, `pageId`, `metadata` |

`commitId` / `storeId` are `string | null` in the generated types because a trigger stamps them; assert once after the write.

## Custom operations

| Operation | Input | Returns | Notes |
|---|---|---|---|
| `db.mutation.sitesProvisionStaticSite` | `name`, `label?`, `apex?`, `hostname?`, `routePath?`, `siteConfig?` | `Route` | Bucket + site + web config + hostname + route in one transaction |
| `db.mutation.domainsAssignSubdomain` | `apex?`, `label?`, `maxAttempts?` | `Domain` | Claim `<label>.<apex>` under a published apex; auto-generates a label when omitted |
| `db.mutation.provisionSitePreview` | `siteId`, `name`, `commitId?`, `apex?` | `Route` | Set the ref, claim `<name>--<site>.<apex>`, create the route; re-run moves the ref |
| `db.mutation.setSitePreview` | `targetSiteId`, `targetName`, `targetCommitId?` | commit UUID | Move a ref without touching routing; omitted commit pins the current head |
| `db.mutation.deleteSitePreview` | `targetSiteId`, `targetName` | — | Idempotent; the hostname keeps resolving and now 404s |
| `db.query.getSitePreviewCommit` | `targetSiteId`, `targetName` | commit UUID or null | Null, not an error, when the ref is gone |
| `db.query.getSiteReleaseManifest` | `targetSiteId`, `targetCommitId` | manifest JSON | Read any release as it was at that commit |
| `db.query.pagePublished` | `targetSiteId`, `pageSlug` | page content | The page as of the site's `activeCommitId` |
| `db.mutation.sitesInstallMantra` | `siteId`, `routePreset?` (default `'mantra'`), `entityId?` | `Site` | Idempotent per (hostname, path) |
| `db.mutation.sitesInstallContentPreset` | `siteId`, `presetKind`, `presetSlug`, `entityId?` | report JSON | Insert-only; `{ seeded[], present[] }` |
| `db.query.resolveSiteAppLinks` | `targetSiteId` | JSON array | Exactly what the `.well-known` documents will render |
| `db.query.sitesDeepLinkUrl` | `targetSiteId`, `linkSlug` | URL | The resolved destination of `/l/<slug>` |
| `db.query.sitesSiteOrigin` | `targetSiteId` | origin string | The site's public origin |
| `db.mutation.mintSitePreviewToken` | `siteId`, `target`, `targetKind?`, `ttlSeconds?` | `{ token, expiresAt }` | Signed bearer for a gated preview; the gateway accepts it as a query param or cookie |
| `db.query.verifySitePreviewToken` | `siteId`, `token` | string or null | Null when the token is invalid or expired |

All `input` fields are optional in the generated types; the server raises a structured error when a required one is missing.

## Pages, Mantra, presets, app links — at a glance

```typescript
// A page: every write commits; nothing is published until the site pointer moves.
const { createPage } = await db.page
  .create({
    data: { siteId, databaseId, slug: 'home', content: { title: 'v1' } },
    select: { id: true, commitId: true, storeId: true },
  })
  .unwrap();

// Mantra auth/legal pages onto an already-routed site.
await db.mutation
  .sitesInstallMantra({ input: { siteId } }, { select: { result: { select: { id: true, name: true } } } })
  .unwrap();

// Seed legal pages and a no-AI robots policy — never overwrites what the site already has.
await db.mutation
  .sitesInstallContentPreset({ input: { siteId, presetKind: 'pages', presetSlug: 'legal' } }, { select: { result: true } })
  .unwrap();
await db.mutation
  .sitesInstallContentPreset({ input: { siteId, presetKind: 'robots', presetSlug: 'no-ai' } }, { select: { result: true } })
  .unwrap();

// A deep link under the reserved /l/ prefix.
await db.siteDeepLink
  .create({
    data: { siteId, databaseId, slug: 'welcome', webPath: '/getting-started', fallbackUrl: 'https://acme.com/welcome' },
    select: { id: true, slug: true },
  })
  .unwrap();
```

Details: [pages-and-content-presets.md](./references/pages-and-content-presets.md), [mantra.md](./references/mantra.md), [app-links.md](./references/app-links.md).

## Error codes

| Code | Meaning |
|---|---|
| `SUBDOMAIN_APEX_NOT_PUBLISHED` | Label requested under an apex that is not a published wildcard managed domain (`isWildcard && allowPublicUsage`) |
| `SUBDOMAIN_LABEL_INVALID` / `SUBDOMAIN_LABEL_EXHAUSTED` | Label is not `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` / no free label found within `maxAttempts` |
| `DOMAIN_ALREADY_CLAIMED` | Explicit `hostname` is already routed by another owner |
| `STATIC_SITES_LIMIT` | Plan cap on static sites reached (see [`constructive-billing`](../constructive-billing/SKILL.md)) |
| `SITE_NOT_FOUND` | No such site in this scope |
| `SITE_PREVIEW_COMMIT_SITE_MISMATCH` | The commit belongs to another site's store — refs are store-local |
| `ROUTE_BINDINGS_SITE_NOT_ROUTED` | Mantra install on a site that serves no hostname yet — route it first |
| `ROUTE_BINDINGS_ENTITY_REQUIRED` | Entity-keyed scope, `entityId` omitted |
| `MANTRA_BINDINGS_INVALID` / `FUNCTION_DEFINITION_NOT_FOUND` | Route preset malformed / a `mantra:*` task is not published at this scope |
| `CONTENT_PRESET_KIND_UNSUPPORTED` | `presetKind` is not one the installer dispatches (`pages`, `robots`) |
| `NOT_AUTHORIZED` | Platform or entity lane without `manage_sites` |

## Known SDK gaps

Document these as gaps — do not work around them with SQL:

- **Listing a site's previews.** `getSitePreviews(targetSiteId)` exists in the GraphQL schema but the generated `db.getSitePreviewsRecord.findMany` cannot pass `targetSiteId`. Use `getSitePreviewCommit` for single-ref reads; list with a raw GraphQL query if you must. The `create`/`update`/`delete` methods on that record model are meaningless (it is a function result, not a table).
- **App store identities.** The app-owned half of mobile app links (`appStoreIdentity`: platform, bundle/package id, team id, certificate fingerprints, store URL) has no model in the generated `api` ORM; only the host-owned `siteAppLink` does. Create the identity through whichever surface owns your app, then reference its id.
- **Service-backed (SSR) sites.** A site with `resourceId` / `installationId` resolves to a running service at reconcile time, but the `install_app` verb that creates the definition → installation → service chain is not exposed by the generated ORM. Route a hostname at an existing service with `db.route.create({ data: { domainId, path, targetServiceId } })` instead; see the `sites-ssr-apps` skill in `constructive-db` for the internals.
- **Historical page reads.** Reading a page's content at an arbitrary past commit (as opposed to the published one via `pagePublished`) is a merkle-store read that the `api` ORM does not front; `db.commit.findMany` gives you the history, not the content.

## Reference Files

| File | Read when |
|---|---|
| [static-sites.md](./references/static-sites.md) | Provisioning a bucket-backed site, `siteConfig` keys, apex publishing and subdomain assignment, custom hostnames, serving behaviour |
| [releases-and-previews.md](./references/releases-and-previews.md) | Release manifests, publish/rollback, deploy history, named previews, time travel |
| [pages-and-content-presets.md](./references/pages-and-content-presets.md) | Versioned pages, publishing a page version, `pages:legal` / `robots:no-ai` presets, provenance |
| [mantra.md](./references/mantra.md) | Installing the Mantra page set, the `route_bindings` catalog, mixing one hostname across targets, entity scope |
| [app-links.md](./references/app-links.md) | `siteAppLink`, the derived AASA / assetlinks documents, `siteDeepLink` and `/l/<slug>` |

## Related Skills

- [`constructive-storage`](../constructive-storage/SKILL.md) — presigned uploads into the site's bucket
- [`constructive-platform`](../constructive-platform/SKILL.md) — services, API routing, deployment, domains
- [`constructive-auth`](../constructive-auth/SKILL.md) — the sign-in/2FA/reset behaviour the Mantra pages drive
- [`constructive-flow-graphs`](../constructive-flow-graphs/SKILL.md) — the merkle store that versions releases and pages
- [`constructive-billing`](../constructive-billing/SKILL.md) — `STATIC_SITES_LIMIT` and other plan caps
