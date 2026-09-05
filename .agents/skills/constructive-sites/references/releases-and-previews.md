# Releases, rollback, previews, time travel

A deploy is **bytes + one manifest**. File bytes go to the site's bucket at `cas/sha256/<hash>`; a single `siteRelease.manifest` lists every logical path. Writing the manifest auto-commits into the site's own merkle store, so the returned `commitId` **is** the release id. Publishing is `site.activeCommitId = <commit>`; rollback is the same write with an older commit. A preview is a named ref at a commit, served on its own hostname. Nothing is overwritten and no page rows are written — a 50k-file build is 50k objects and one row.

## Deploy → publish

```typescript
// 1. bytes: upload each file to cas/sha256/<sha256 of its bytes> in the site's bucket
//    (presigned upload — constructive-storage). Bytes already present can be skipped: that is the dedupe.

// 2. manifest: one row per site; the versioning trigger commits it and stamps commitId back.
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

// 3. publish: one pointer move, atomic for every in-flight visitor
await db.site
  .update({
    where: { id: siteId },
    data: { activeCommitId: release.commitId },
    select: { id: true, activeCommitId: true },
  })
  .unwrap();
```

`siteRelease` is one row per site (unique on `siteId`). **Re-deploying updates that row** — each write is a new commit, which is what builds history:

```typescript
const { updateSiteRelease } = await db.siteRelease
  .update({
    where: { id: release.id },
    data: { manifest: nextManifest },
    select: { commitId: true },
  })
  .unwrap();
const nextCommitId = updateSiteRelease.siteRelease.commitId!;
```

Until step 3 the new release exists and serves to nobody.

## Rollback and deploy history

Rollback is step 3 with a previous commit. History is the store's commit chain:

```typescript
const { commits } = await db.commit
  .findMany({
    where: { storeId: { equalTo: release.storeId } },
    orderBy: ['DATE_DESC'],
    first: 20,
    select: { id: true, date: true, message: true, parentIds: true },
  })
  .unwrap();

await db.site
  .update({ where: { id: siteId }, data: { activeCommitId: commits[1].id }, select: { activeCommitId: true } })
  .unwrap();
```

## Previews

A preview is a **pointer, not a branch**: it aims at a commit that already exists, so moving a preview never moves production and publishing never moves a preview. One call sets the ref, claims `<name>--<site name>.<apex>` and creates the route:

```typescript
const { provisionSitePreview } = await db.mutation
  .provisionSitePreview(
    { input: { siteId, name: 'redesign', commitId: release.commitId, apex: 'preview.example.com' } },
    { select: { result: { select: { id: true, path: true, domainId: true } } } },
  )
  .unwrap();
// serves at https://redesign--<site name>.preview.example.com
```

`name` becomes a DNS label (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`); `main` is reserved. Re-running for the same name **moves the ref and reuses the hostname** — the per-branch CI call. `apex` follows the published-apex rules in [static-sites.md](./static-sites.md).

Move, read and retire a ref without touching routing:

```typescript
// move — omitting targetCommitId pins the current write head
await db.mutation
  .setSitePreview(
    { input: { targetSiteId: siteId, targetName: 'redesign', targetCommitId: nextCommitId } },
    { select: { result: true } },                              // result = the commit it pinned
  )
  .unwrap();

// read — null, not an error, if the ref is gone
const { getSitePreviewCommit } = await db.query
  .getSitePreviewCommit({ targetSiteId: siteId, targetName: 'redesign' })
  .unwrap();

// retire (idempotent). The hostname keeps resolving and now 404s.
await db.mutation
  .deleteSitePreview(
    { input: { targetSiteId: siteId, targetName: 'redesign' } },
    { select: { clientMutationId: true } },
  )
  .unwrap();
```

A commit from another site's store is rejected with `SITE_PREVIEW_COMMIT_SITE_MISMATCH` — refs are store-local.

### Gated previews

A preview hostname can require a signed token, which the gateway accepts as a query parameter or a cookie:

```typescript
const { mintSitePreviewToken } = await db.mutation
  .mintSitePreviewToken(
    { input: { siteId, target: 'redesign', targetKind: 'ref', ttlSeconds: 3600 } },
    { select: { result: { select: { token: true, expiresAt: true } } } },
  )
  .unwrap();
const token = mintSitePreviewToken?.result?.[0]?.token;

// server-side check of a token you were handed; null when invalid or expired
const { verifySitePreviewToken } = await db.query
  .verifySitePreviewToken({ siteId, token })
  .unwrap();
```

`MintSitePreviewTokenInput`: `siteId`, `target` (a preview name when `targetKind: 'ref'`, a commit id when `targetKind: 'commit'`), `targetKind?`, `ttlSeconds?` (1 – 604800, else `SITE_PREVIEW_TOKEN_TTL_INVALID`; any other `targetKind` is `SITE_PREVIEW_TOKEN_TARGET_INVALID`). The payload's `result` is a list of `{ token, expiresAt }`.

## Time travel

Read any release, live or not, without pointing anything at it:

```typescript
const { getSiteReleaseManifest } = await db.query
  .getSiteReleaseManifest({ targetSiteId: siteId, targetCommitId: someOldCommit })
  .unwrap();          // the manifest JSON as it was at that commit
```

That is also what the edge does per request: resolve the route, take `activeCommitId` (or the preview ref's commit), fetch that one manifest once per commit, then map path → hash → one bucket GET. A commit id is immutable, so the manifest cache never invalidates; a preview *ref* is mutable, so it is re-read on a short interval.

## Serving behaviour worth knowing

- Clean URLs, SPA fallback and custom error pages are resolved as manifest lookups, not speculative bucket GETs — a released site costs fewer round-trips than an unreleased one.
- `ETag` is the file's sha256, so a rebuilt-but-unchanged asset still 304s; hashed asset paths get `immutable`, HTML gets revalidated.
- A site with no release (`activeCommitId` null) serves straight from the bucket root.
- A deleted preview and a never-provisioned hostname both render the branded 404 — deliberate, so a stranger cannot probe for expired previews.

## SDK gap: listing previews

`getSitePreviews(targetSiteId)` exists in the GraphQL schema but the generated `db.getSitePreviewsRecord.findMany` cannot pass `targetSiteId`, so it cannot list one site's previews. Use `getSitePreviewCommit` for single-ref reads; list with a raw GraphQL query if you must. The `create`/`update`/`delete` methods generated on that record model are meaningless — it is a function result, not a table.
