# Permission Defaults

Module-level bitmask permission system. When a module is installed (via entity type provisioning or blueprint), its default permissions are automatically ORed into the entity's `permission_defaults` bitmask.

## How It Works

1. **Module installed** — e.g., `agent_module` INSERT trigger fires
2. **`initialize_module_permissions`** called with the module's `default_permissions` array
3. **Bitmask updated** — permission bits ORed into `permission_defaults.permissions`
4. **Audit recorded** — INSERT into `permission_default_permissions` join table

All bitmask mutations flow through SECURITY DEFINER trigger functions — the `authenticated` role has no direct UPDATE grant on bitmask columns.

## Module Default Permissions

| Module | `default_permissions` | Named Permissions |
|--------|----------------------|-------------------|
| Agent | `['invoke_agents']` | `manage_agents`, `invoke_agents` |
| Function | `['invoke_functions']` | `manage_functions`, `invoke_functions` |
| Graph | `['execute_graphs']` | `manage_graphs`, `execute_graphs` |
| Storage | `['write_files', 'delete_files']` | `manage_storage`, `write_files`, `delete_files` |
| Events | `NULL` | *(admin-only)* |
| Billing | `NULL` | *(admin-only)* |
| Hierarchy | `NULL` | *(admin-only)* |
| Namespace | `NULL` | *(admin-only)* |
| Notifications | `NULL` | *(admin-only)* |
| Rate Limits | `NULL` | *(admin-only)* |
| Usage | `NULL` | *(admin-only)* |

Modules with `NULL` default permissions require explicit admin grants for non-admin users to access module features.

## Tables

### `permission_default_permissions` (join table)

Links permission definitions to entities. Triggers recompute the bitmask on INSERT.

### `permission_default_grants` (audit log)

Append-only log of permission grant operations. Triggers apply the grant to entity memberships.

Both tables have RLS policies for app-scope and entity-scope access.

## Bitmask Architecture

- Bitmask columns: `memberships.permissions`, `memberships.granted`, `permission_grants.permissions`, `sprt.permissions`, `permission_defaults.permissions`, `profiles.permissions`
- All use `bit(N)` where N = current bitlen (auto-expands as permissions are added)
- `get_padded_mask()` function handles width normalization during lookups

### Bitlen Expansion

When a new named permission exceeds the current bit width:

1. `update_bitlen_permissions` ALTERs all bitmask columns to the new width
2. Dependent triggers on `profiles` are dropped and recreated around the ALTER (PostgreSQL restriction)
3. `get_padded_mask` function is regenerated with the new width

## Security Properties

- **No direct UPDATE** on `permission_defaults.permissions`, `memberships.granted`, or `profiles.permissions`
- **SECURITY DEFINER** on all trigger functions that mutate bitmask columns
- **SET NULL on delete** for grants FKs — audit records survive entity deletion
- **`api_required: true`** on nullable audit FKs — GraphQL still enforces non-NULL on INSERT

## Named Permissions Reference

| Permission | Module | Purpose |
|-----------|--------|---------|
| `manage_agents` | Agent | Admin access to agent infrastructure |
| `invoke_agents` | Agent | Use agent features (threads, messages, tasks) |
| `manage_storage` | Storage | Admin access to storage buckets/files |
| `write_files` | Storage | Upload files |
| `delete_files` | Storage | Delete files |
| `invoke_functions` | Function | Execute registered functions |
| `execute_graphs` | Graph | Run graph executions |
| `manage_secrets` | Config | Manage encrypted secrets |

## SDK Interaction

Permission defaults are managed through module installation — there is no direct SDK mutation for the `permission_defaults` bitmask. The system is designed to be declarative:

1. Define modules in your blueprint or entity type provisioning
2. Default permissions are applied automatically
3. Fine-grained grants are managed via profiles and the grants system
