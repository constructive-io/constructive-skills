# Mobile app links and deep links

Associate a mobile app with a site so `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` are derived from data, and give the site named `/l/<slug>` deep links that an installed app intercepts.

## Who owns which fact

| Question | Answered by |
|---|---|
| What is this app's identity in the store? | app store identity (app-owned: `platform` ios/android, `appIdentifier`, `teamId`, `sha256CertFingerprints`, `storeUrl`) |
| How does *this host* serve or link to that app? | `db.siteAppLink` (site-owned: `appStoreIdentityId`, `pathComponents`, `webcredentials`) |

This is a split, not a duplication: a second site fronting the same app repeats **no** store fact, so a corrected fingerprint or a new store URL is one update that both hosts serve immediately.

**SDK gap:** the app-owned store identity table has no model in the `api` ORM (only `appStoreIdentitiesTableId` appears, on the module registration row). Creating or editing a store identity is not reachable through the generated ORM today; `siteAppLink.appStoreIdentityId` must reference an identity provisioned by other means.

## Site app links

```typescript
// this host claims these paths for the app and advertises shared web credentials
await db.siteAppLink
  .create({
    data: {
      siteId,
      databaseId,
      appStoreIdentityId,
      pathComponents: ['/app/*', '/invite/*'],
      webcredentials: true,
    },
    select: { id: true, pathComponents: true, webcredentials: true },
  })
  .unwrap();

// what the well-known documents will be built from
const { resolveSiteAppLinks } = await db.query
  .resolveSiteAppLinks({ targetSiteId: siteId })
  .unwrap();
```

`siteAppLink` is unique per `(siteId, appStoreIdentityId)`. `resolveSiteAppLinks` is the one read path and the join to the store identity is **inner**: an association whose identity is not visible contributes **no** entry rather than one with null store facts that Apple or Google would reject. A site with no association resolves to `[]`.

Rendering happens at the edge:

- AASA — iOS rows only, requires `teamId` (an iOS association without one cannot form `<teamId>.<bundleId>`), emits `applinks.details` with the declared paths **plus `/l/*`**, and `webcredentials.apps` for rows that opted in.
- assetlinks.json — Android rows only, requires non-empty fingerprints, emits `delegate_permission/common.handle_all_urls` statements.

A site that declares nothing for a platform serves nothing fabricated: on a static site the well-known path falls through to ordinary object serving (a site may host its own file); on a service-backed site it is a 404.

## Deep links

`db.siteDeepLink` rows are named links under the reserved `/l/` prefix:

| field | meaning |
|---|---|
| `slug` | `/l/<slug>` |
| `webPath` | same-site destination |
| `fallbackUrl` | absolute external destination when there is no `webPath` |
| `appPath` | in-app destination for the native handler |
| `pageId` | the authored `page` it points at |
| `metadata` | free-form JSON |

```typescript
await db.siteDeepLink
  .create({
    data: { siteId, databaseId, slug: 'welcome', webPath: '/onboarding' },
    select: { id: true, slug: true },
  })
  .unwrap();

// the absolute URL to hand out — null if the link or the site origin is missing
const { sitesDeepLinkUrl } = await db.query
  .sitesDeepLinkUrl({ targetSiteId: siteId, linkSlug: 'welcome' })
  .unwrap();
// https://acme.example/l/welcome

// what the edge will do for GET /l/welcome
const { resolveDeepLink } = await db.query
  .resolveDeepLink({ targetSiteId: siteId, linkSlug: 'welcome' })
  .unwrap();
```

Serving: `GET /l/welcome` → 302 to `webPath`, else `fallbackUrl`; an unknown slug is a hard 404, never a fallthrough that could leak an object at the reserved prefix. `/l/*` is always in the association path patterns, so an installed app intercepts the link instead of following the web redirect.

`sitesDeepLinkUrl` builds on the site origin (`sitesSiteOrigin`), so a site with no verified hostname and no `siteMetadatum.canonicalUrl` yields null — publish the domain first.

## Scope

Platform lane: `db.platformSiteAppLink`, `db.platformSiteDeepLink` and `db.query.platformSitesDeepLinkUrl` — same shapes, no `databaseId`. `resolveSiteAppLinks` and `resolveDeepLink` have no generated `platform*` variant in the current SDK (the edge resolves them internally); treat that as an SDK gap on the platform lane.
