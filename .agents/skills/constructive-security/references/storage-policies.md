# Storage Security Policies

Constructive storage (buckets, files) supports configurable security policies via a `policies` array on a per-table storage override. This lets blueprint authors compose specific `Authz*` node types per storage scope's tables, instead of always getting the sensible defaults.

Storage can be provisioned at three levels:
- **App-level** — via the top-level `storage` key with `scope: "app"` (default) in the blueprint definition (Phase 0.5)
- **Org-level** — via the top-level `storage` key with `scope: "org"` in the blueprint definition (Phase 0.5). Creates per-org/user storage (`org_buckets`/`org_files`) with `owner_id`
- **Entity-scoped** — via `storage: [...]` on an `entity_types[]` entry (Phase 0)

## Two layers of storage access control

| Layer | Controlled by | What it does |
|-------|--------------|--------------|
| **Transport (S3/MinIO)** | `is_public` | Sets the S3 bucket ACL. `true` = publicly readable URLs, `false` = presigned URLs required |
| **Data (RLS)** | `policies` | Controls which authenticated users can SELECT/INSERT/UPDATE/DELETE rows in the buckets and files tables |

These are complementary, not redundant. A bucket can be `is_public: true` (anyone with the URL can download) but still have RLS policies restricting who can upload or delete.

## The two storage tables

With a `storage[]` entry, the system creates two tables per entity type, prefixed with the entity's `prefix`:

| Logical name | Physical table (prefix=`data_room`) | Key columns | Notes |
|---|---|---|---|
| **buckets** | `data_room_buckets` | `owner_id`, `is_public`, `key`, `type` | Container metadata |
| **files** | `data_room_files` | `actor_id`, `is_public`, `key`, `mime_type`, `size` | Individual file records |

**Column availability matters for policy scoping:**
- **Buckets** has `is_public` and `actor_id` — supports `AuthzPublishable` and the owner policies (`actor_id` is provenance only; the defaults do not grant bucket authorship)
- **Files** has `is_public` and `actor_id` — supports `AuthzPublishable` and the owner policies

> **Authorship must be membership-fenced.** Storage tables always carry a membership policy, so an author arm must be `AuthzAppMemberOwner` (app-level storage) or `AuthzMemberOwner` (entity-scoped storage), never a bare `AuthzDirectOwner`. Permissive policies are ORed: a bare owner policy would let a removed member keep updating and deleting the files they uploaded.

## Configuring storage policies

A storage entry can override a table with `provisions.buckets.policies` or `provisions.files.policies`. Names are logical roles, not physical table names. An explicit policy array replaces the defaults **on that table only**; omit it to retain the defaults.

App-scoped example (merge this fragment into the blueprint definition):

```json
{
  "storage": [{
    "buckets": [{ "name": "documents", "is_public": false }],
    "provisions": {
      "files": {
        "policies": [
          { "$type": "AuthzAppMembership", "privileges": ["select", "insert"] },
          { "$type": "AuthzAppMemberOwner", "privileges": ["update", "delete"], "data": { "owner_field": "actor_id" } }
        ]
      }
    }
  }]
}
```

For entity-scoped storage use the same `storage[]` structure under the `entity_types[]` entry, or pass it as `data.storage` to `db.entityTypeProvision.create`. Use `AuthzEntityMembership` (with `entity_field: 'owner_id'` and the entity scope) and `AuthzMemberOwner` for membership-fenced authorship. A policy does not carry a `tables` field; its place under `provisions` selects the table.

## Defaults (when `policies` is omitted)

When `policies` is `NULL` or omitted, `apply_storage_security` applies **sensible, locked-down defaults** based on the principle of least privilege. The defaults are the same for both app-level and entity-scoped storage — only the membership policy type differs.

### Default policy matrix

| Table | Policy | Privileges | Suffix | Purpose |
|-------|--------|-----------|--------|---------|
| **Buckets** | Membership | `select` | `mem` | Members can resolve buckets (no `AuthzPublishable` arm — `is_public` describes how objects are served, not who sees the row) |
| **Buckets** | Membership + `is_admin`/`is_owner` | `insert`, `update`, `delete` | `adm` | Buckets belong to the scope owner; management is admin-gated, never actor authorship |
| **Files** | `AuthzPublishable` (`is_public`) | `select` | `pub` | Public files readable by any authenticated user |
| **Files** | Membership | `select`, `insert` | `mem` | Members can view and upload files (with `restrict_reads`, SELECT requires the `read_files` capability) |
| **Files** | Compound member-owner (`actor_id`) | `update`, `delete` | `own` | Uploader can modify/delete their own files **while still a member**: `AuthzMemberOwner` (entity scopes), `AuthzAppMemberOwner` (app/platform), `AuthzRelatedMemberOwner` (database scope) |
| **Files** | Membership + capability | `update` / `delete` | escalation | Members holding `write_files` / `delete_files` (or `is_admin` at global scopes) can manage anyone's files |

### Membership policy type (auto-selected)

| Storage scope | Membership policy type | Policy data |
|---------------|----------------------|-------------|
| **App-level** (`membership_type IS NULL`) | `AuthzAppMembership` | `{}` |
| **Org-level** (`membership_type = 2`) | `AuthzEntityMembership` | `{"entity_field": "owner_id", "membership_type": 2}` |
| **Entity-scoped** (`membership_type = 3+`) | `AuthzEntityMembership` | `{"entity_field": "owner_id", "membership_type": <N>}` |

The system automatically uses the correct membership policy type based on the storage module's `membership_type` value.

### What this means in practice

- **Any authenticated member** can view buckets and view/upload files (via membership SELECT + INSERT)
- **The uploader** (matched by `actor_id`) can update or delete their own files, but only while they remain a member — authorship never survives losing membership (compound member-owner UPDATE + DELETE)
- **Privileged members** (`write_files` / `delete_files` capability, or admins) can manage anyone's files; bucket management is admin-only
- **Public content** (files where `is_public = true`) is readable by any authenticated user (via AuthzPublishable SELECT)

## Available policy types for storage

Any `Authz*` node type from the registry can be used. The most relevant ones for storage:

| Type | When to use | Required columns | Scope under `provisions` |
|------|------------|-----------------|---------------------|
| `AuthzEntityMembership` | Members of the entity can access (most common) | `owner_id` | All three |
| `AuthzMemberOwner` / `AuthzAppMemberOwner` | Only the uploader can access, and only while a member (entity-scoped / app-level storage) | `actor_id` + `owner_id` (files) | `["files"]` |
| `AuthzDirectOwner` | **Avoid on storage tables** — bare ownership survives membership removal; use the member-owner types above | `actor_id` | — |
| `AuthzPublishable` | Published files are publicly readable (SELECT only) | `is_public` | `["buckets", "files"]` |
| `AuthzAppMembership` | App-level membership gate (hardcoded type=1) | — | All three |
| `AuthzAllowAll` | No restrictions (use sparingly) | — | All three |
| `AuthzDenyAll` | Explicit `FALSE`; does not override another passing permissive policy | — | All three |

See the [`constructive-security`](../../constructive-security/SKILL.md) skill for all 25 registry Authz nodes and the separately platform-applied `AuthzHumanOnly` guard. `AuthzColumnSecurity` is registry-selectable but generates a column write guard rather than a stored storage RLS policy.

## Cross-references

- **Constructive Authz protocol (Authz* types):** [`constructive-security`](../../constructive-security/SKILL.md)
- **Custom entities & provisioning:** [`constructive-entities`](../../constructive-entities/SKILL.md)
- **Blueprint definition format:** [blueprint-definition-format.md](../../constructive-blueprints/references/blueprint-definition-format.md)
- **Upload flow (GraphQL mutations, client library):** [`constructive-storage`](../../constructive-storage/SKILL.md)
- **Multi-scope bucket resolution:** `multi-scope-bucket-resolution` skill in `constructive-db`
- **SQL-level security details:** `constructive-db-security-sql` skill in `constructive-db`
