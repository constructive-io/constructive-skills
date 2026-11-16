# Image and Upload Columns on Your Tables

A file on one of your own tables is an `image` or `upload` field (or `image[]`
/ `upload[]`). The column holds a small JSON document that points at a row in
the files table; you write `{ "id": "<file id>" }` and the platform fills in
the rest.

## Declare the field

```json
{ "name": "photo",  "type": { "name": "image" } }
{ "name": "resume", "type": { "name": "upload" } }
```

An `image` field created by a blueprint gets rendered versions by default —
no `Process*` node needed. The default ladder is a 160x160 thumbnail plus
320 / 640 / 1280 / 1920 wide, webp; nothing is rendered larger than its
source. The versions are stored inside the column's document (`photo.versions`),
not in a second column.

## Opt out, or add more

`processing` on the field says what runs on its files:

```json
{ "name": "photo", "type": { "name": "image" }, "processing": false }
{ "name": "photo", "type": { "name": "image" }, "processing": { "embedding": true } }
{ "name": "photo", "type": { "name": "image" },
  "processing": { "versions": [{ "name": "card", "width": 480 }],
                  "embedding": { "dimensions": 768 } } }
{ "name": "resume", "type": { "name": "upload" },
  "processing": { "extraction": true, "embedding": true } }
```

| Key | Field type | Default | What it does |
|-----|-----------|---------|--------------|
| `versions` | `image` | on | Renders the ladder, or the list you give |
| `embedding` | `image` | off | Vector of the image in `<field>_embedding` |
| `extraction` | `upload` | off | Extracted text in `<field>_text`, metadata in `<field>_metadata` |
| `embedding` | `upload` | off | Vector of the file in `<field>_embedding` |

- A value is `true`, `false`, or an object of the matching `Process*` node's
  parameters. `processing: false` runs nothing.
- Don't state the same lane twice (on the field and as a `Process*` node naming
  the field) — provisioning raises.
- Embedding is not available on array columns.

## Read a URL

Every `image` / `upload` column gets two GraphQL fields on its row type:

```graphql
{
  products {
    nodes {
      photoUrl(width: 480)             # narrowest version at least 480 wide, else the source
      photoVersions { width height format url }   # for srcset
      resumeUrl                        # upload column: the file itself
      galleryUrl(width: 160)           # array column: one URL per element
    }
  }
}
```

- `<col>Url` with no `width`, or with no version that wide, is the source file.
- `<col>Versions` is `[FileVersion!]` (`name`, `key`, `width`, `height`,
  `format`, `size`, `url`), narrowest first; empty when there are none.
- Both are `null` when the reader cannot see the file or it is not uploaded yet.
- Public bucket → direct URL; private bucket → presigned GET, same as
  `downloadUrl`. `downloadUrl` remains the field on files-table rows.
- Upload keys containing `.versions/` are refused; that prefix belongs to
  rendered versions.

## Writing the column

- Send `{ "id": "<file id>" }` plus any members of your own (e.g. `caption`).
  `key`, `mime`, `bucket_id`, `size`, `filename` are rebuilt from the file row;
  `versions` / `width` / `height` are written by the platform. Values you send
  for these are not kept for a file new to the column.
- The file must be uploaded (confirmed) and in the field's bucket.
- In an array, an element whose file has since been rejected or deleted does
  not block a write about the other elements.

## Which embedding model

`embedding_model` is optional on every embedding node / lane. Order used when
the job runs: the node's `embedding_model`, else the tenant's `EMBEDDING_MODEL`
config, else the platform's `EMBEDDING_MODEL`. With none set the job fails
permanently (422). Image embedding uses `EMBEDDING_IMAGE_MODEL` in the same
order. The model that produced each vector is recorded in `<field>_model`
beside the vector; see
[`constructive-search`](../../constructive-search/references/search-pgvector.md).

## Existing databases

These defaults apply to fields created after the platform release that
introduced them. A database provisioned earlier is not changed: no versions
are rendered for its existing image fields and no `_model` column is added to
its existing vector fields until the database is recreated. `<col>Url` still
works there and returns the source file.
