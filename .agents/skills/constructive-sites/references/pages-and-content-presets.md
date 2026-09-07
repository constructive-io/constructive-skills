# Pages, versioning, and content presets

## Pages

A `page` is authored content under a site (`siteId`, `slug`, `content` JSON). Two pointers, deliberately different:

- **The page head always advances.** Every create/update of `content` commits into the site's own merkle store and stamps `storeId` / `commitId` on the row. You cannot lose history by editing.
- **The site publishes manually.** `site.activeCommitId` is a plain column — nothing moves it for you. Draft freely; move the pointer to release, move it back to roll back.

The store is created lazily on the first page write, so there is no setup step. Pages share the store with the site's release manifest and metadata — one site, one commit chain.

```typescript
// author (v1)
const { createPage } = await db.page
  .create({
    data: { siteId, databaseId, slug: 'home', content: { title: 'Welcome', body: '…' } },
    select: { id: true, slug: true, commitId: true, storeId: true },
  })
  .unwrap();
const page = createPage.page;

// edit (v2) — a new commit; the published version is unchanged until you move the pointer
const { updatePage } = await db.page
  .update({
    where: { id: page.id },
    data: { content: { title: 'Welcome!', body: '…' } },
    select: { commitId: true },
  })
  .unwrap();

// publish everything as of v2
await db.site
  .update({ where: { id: siteId }, data: { activeCommitId: updatePage.page.commitId }, select: { activeCommitId: true } })
  .unwrap();
```

Reads:

```typescript
// the draft head, straight from the row
const { pages } = await db.page
  .findMany({
    where: { siteId: { equalTo: siteId } },
    select: { id: true, slug: true, content: true, commitId: true, seededFrom: true },
  })
  .unwrap();

// what visitors see: the page as of site.activeCommitId (null if unpublished / no such slug)
const { pagePublished } = await db.query
  .pagePublished({ targetSiteId: siteId, pageSlug: 'home' })
  .unwrap();

// history: the store's commit chain (message 'page/<slug>' per page write)
const { commits } = await db.commit
  .findMany({
    where: { storeId: { equalTo: page.storeId! } },
    orderBy: ['DATE_DESC'],
    select: { id: true, message: true, date: true },
  })
  .unwrap();
```

Pages are unique per `(siteId, slug)`. Content edits are instant rows + commits — no reconcile, no rebuild; only `activeCommitId` changes what is served.

**SDK gap:** reading a page's content at an arbitrary *past* commit (not the published one) is a merkle-store node read the `api` ORM does not front. `db.commit` gives the history; the content at a historical commit has no public operation yet.

## Site metadata

`siteMetadatum` is the site's head/SEO facts, one row per site, versioned the same way (`commitId`, `storeId`):

```typescript
await db.siteMetadatum
  .create({
    data: {
      siteId,
      databaseId,
      title: 'Acme',
      description: 'Widgets for everyone',
      canonicalUrl: 'https://acme.com',
      favicon: '/favicon.ico',
      ogImage: '/og.png',
      robots: 'User-agent: *\nAllow: /',
    },
    select: { id: true, commitId: true },
  })
  .unwrap();
```

`canonicalUrl` is what `sitesSiteOrigin` prefers over the routed hostname; `robots` is the whole `robots.txt` body and is what the `robots` content preset fills.

## Content presets

A content preset is a named starter kit installed into a site with one generic verb. Shipped kinds:

| `presetKind` | `presetSlug` | Writes |
|---|---|---|
| `pages` | `legal` | one `page` row per document (`/terms`, `/privacy`), slug = document path |
| `robots` | `no-ai` | `siteMetadatum.robots`, only when no value exists |

```typescript
const { sitesInstallContentPreset } = await db.mutation
  .sitesInstallContentPreset(
    { input: { siteId, presetKind: 'pages', presetSlug: 'legal' } },
    { select: { result: true } },
  )
  .unwrap();
// result: { site_id, preset: { kind, slug, commit_id }, seeded: ['/terms', '/privacy'], present: [] }

await db.mutation
  .sitesInstallContentPreset(
    { input: { siteId, presetKind: 'robots', presetSlug: 'no-ai' } },
    { select: { result: true } },
  )
  .unwrap();
// result: { …, seeded: ['robots'], present: [] }
```

Run it again and the report flips: `seeded: []`, `present: ['/terms', '/privacy']`.

### The rule: installing never overwrites

An install only fills in what the site does **not** have. An existing page slug is left untouched and reported under `present`; an existing `robots` value — seeded or hand-edited — is left alone. Re-running provisioning is therefore safe: prose a customer rewrote and a crawler policy they set survive it. Changing something already set is a separate, deliberate `db.page.update` / `db.siteMetadatum.update`, never an install.

Every written row carries provenance — `page.seededFrom` and `siteMetadatum.robotsSeededFrom` = `{ kind, slug, commit_id }` — so when a preset is updated later you can diff what a site received against what the catalog now says instead of silently replacing it.

Seeded pages are merkle-committed like any other page, but **nothing is published** until you move `site.activeCommitId`.

### Scope

Platform lane: `db.mutation.platformSitesInstallContentPreset`, same input. `entityId` is required only on an entity-keyed scope.

| Code | Meaning |
|---|---|
| `CONTENT_PRESET_KIND_UNSUPPORTED` | `presetKind` is not one the installer dispatches |
| `CONTENT_PRESET_NOT_FOUND` | no active preset at `(kind, slug)` |
| `SITE_NOT_FOUND` | no such site in this scope |

### Reading the catalog

Presets are data, not code: rows keyed `(kind, slug)` with a `definition` JSON and an `active` flag, versioned as a merkle head. The catalog lives on the **infra** target, not `api`; read it with an infra client:

```typescript
const { contentPresets } = await infra.contentPreset
  .findMany({
    where: { kind: { equalTo: 'pages' }, active: { equalTo: true } },
    select: { id: true, kind: true, slug: true, label: true, definition: true, commitId: true },
  })
  .unwrap();
```

Other kinds in the same catalog (`route_bindings`, `trust_ladder`, `limit_defaults`) are consumed by [mantra.md](./mantra.md), [`constructive-events`](../../constructive-events/SKILL.md) and [`constructive-billing`](../../constructive-billing/SKILL.md) respectively.
