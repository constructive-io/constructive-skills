---
name: constructive-principals-delegation
description: Narrow-only delegation — createChildPrincipal (a principal hands a sub-task to a strictly narrower child), the delegation settings that gate it, PRINCIPAL_CHILD_WIDENS and friends, and one-call principal presets via createPrincipalFromPreset (read-only-analyst, deploy-bot).
---

# Delegation: Child Principals & Presets

## Child principals (narrow-only)

`createChildPrincipal` is the **one carve-out** from the human-only rule on the principal surface. A principal session may mint a child *of itself*; the owning human may mint a child of any principal they own. Everything that could **widen** (`createOrgPrincipal`, `updatePrincipal`, `setPrincipalScope`, `setPrincipalEntities`, API keys on standing principals) stays human-only.

```typescript
const { createChildPrincipal } = await db.mutation
  .createChildPrincipal(
    {
      input: {
        parentPrincipalId: '<parent-principal-user-uuid>',
        name: 'deploy-job-4821',
        allowedMask: '0000...0110',       // optional BitString; must be ⊆ parent's capabilities
        entityIds: ['<org-uuid>'],        // optional; must be ⊆ parent's entity list (if parent is restricted)
        isReadOnly: true,                 // optional; OR'd with the parent's flag (can only tighten)
        expiresAt: '2026-09-06T00:00:00Z',// optional; must be ≤ parent / session chain expiry
        intent: 'deploy release 4821',    // optional audit context
      },
    },
    { select: { result: true } },        // result: the child's principal user id
  )
  .execute()
  .unwrap();

const childPrincipalId = createChildPrincipal.result;

// Give the child its own short-lived credential
const { mintAccessToken } = await db.mutation
  .mintAccessToken(
    { input: { principalId: childPrincipalId, intent: 'deploy release 4821' } },
    { select: { result: { accessToken: true, refreshToken: true, sessionId: true } } },
  )
  .execute()
  .unwrap();
```

`CreateChildPrincipalInput` fields: `parentPrincipalId`, `name`, `allowedMask?`, `entityIds?`, `expiresAt?`, `isReadOnly?`, `intent?`.

### What "narrow-only" means

```
child_effective = parent_effective & allowedMask
```

| Constraint | Error |
|-----------|-------|
| `allowedMask` names a bit the parent does not hold anywhere | `PRINCIPAL_CHILD_WIDENS` |
| `entityIds` includes an entity outside a restricted parent's list | `PRINCIPAL_CHILD_WIDENS` |
| `expiresAt` later than the parent's expiry / session chain ceiling | `PRINCIPAL_CHILD_TTL_EXCEEDS_PARENT` |
| Parent already expired | `PRINCIPAL_EXPIRED` |
| A principal caller names a parent other than itself | `PRINCIPAL_NOT_DESCENDANT` |
| Depth would exceed `auth_settings.max_principal_depth` | `PRINCIPAL_DEPTH_EXCEEDED` |
| Delegation disabled for the app or the credential's org | `PRINCIPAL_DELEGATION_DISABLED` |

The child inherits `isReadOnly` (OR'd) and `bypassStepUp` from its parent, gets `useAdminOwner = false`, `depth = parent.depth + 1`, and `expiresAt` defaulting to the parent/session ceiling — children are **ephemeral by default**. A child can never be widened later: `setPrincipalScope` on it is human-only and still cannot exceed the parent.

Generated `Principal` fields that describe the tree (read-only in practice): `parentPrincipalId`, `depth`, `expiresAt`, `createdBySessionId`.

### Settings that gate delegation

| Setting | Scope | Effect |
|---------|-------|--------|
| `auth_settings.allow_principal_delegation` | tenant | Master switch for `createChildPrincipal` |
| `auth_settings.max_principal_depth` | tenant | How deep the tree may go |
| `auth_settings.max_session_depth` / `allow_token_exchange` | tenant | Bound the *session* tree minted by `mintAccessToken` (see [access-tokens.md](./access-tokens.md)) |
| `membership_settings.allow_principal_delegation` | org | Org-level veto when the caller's credential is org-bound |
| `membership_settings.allow_principal_owned_api_keys` | org | Whether org principals may hold standing keys at all |

These are tenant-generated settings rows set at provisioning by `sessions_module` / the org's membership settings. **SDK gap:** neither `app_settings_auth` nor `membership_settings` is a generated ORM model, so there is no supported SDK path to change them after provisioning — see [`constructive-auth` → auth-settings.md](../../constructive-auth/references/auth-settings.md). Do not write SQL against them.

### Revocation follows the tree

`revokeSession` / `signOut` / `revokeApiKey` on any ancestor revokes every descendant session and its tokens; `deletePrincipal` on a parent cascades through its children. See [access-tokens.md](./access-tokens.md#revoke--cascades).

## Presets: one call, a known-good principal

`createPrincipalFromPreset` instantiates a catalogued principal definition (`content_presets`, kind `principal`) for the current human. Presets name **capabilities**, not bit positions, so the same preset fits any tenant; a capability name the tenant lacks fails the call instead of silently narrowing.

```typescript
const { createPrincipalFromPreset } = await db.mutation
  .createPrincipalFromPreset(
    {
      input: {
        slug: 'deploy-bot',
        name: 'release-bot',
        entityIds: ['<org-uuid>'],          // required when the preset's entity_policy is 'require_list'
        overrides: { is_read_only: true },  // optional JSON overrides; may only tighten
      },
    },
    { select: { result: true } },          // result: new principal user id
  )
  .execute()
  .unwrap();
```

`CreatePrincipalFromPresetInput` fields: `slug`, `name`, `entityIds?`, `overrides?` (`Record<string, unknown>`).

### Shipped presets

| Slug | Behaviour |
|------|-----------|
| `read-only-analyst` | Every bit the owner holds, `isReadOnly: true` at app and org scope, inherits the owner's entities, **no delegation** (`max_depth: 0`). Credentials: API key 30 days, access 15 min, refresh 7 days, chain 30 days |
| `deploy-bot` | Org capabilities `manage_services`, `manage_sites`, `manage_domains` only (app mask empty); `bypassStepUp: true`; **must** be pinned to an entity list (`require_list`); may delegate **one** level (per-job children). Same credential ceilings |

A preset's credential lifetimes are ceilings the tenant's `auth_settings` may lower but never raise — a tenant whose settings are tighter rejects the instantiation rather than quietly widening.

| Failure | Error |
|---------|-------|
| Unknown slug | `CONTENT_PRESET_NOT_FOUND` |
| `overrides` would widen the preset | `PRINCIPAL_CHILD_WIDENS` (malformed → `PRINCIPAL_PRESET_INVALID_OVERRIDES`) |
| `require_list` preset called without `entityIds` | `PRINCIPAL_PRESET_ENTITIES_REQUIRED` |
| Preset names a capability this tenant's catalog lacks | `PRINCIPAL_PRESET_UNKNOWN_CAPABILITY` |
| Called from a principal session | `PRINCIPAL_CANNOT_CREATE_PRINCIPAL` |

Tenants can author their own principal presets in the same catalog; see [`constructive-blueprints` → module-presets.md](../../constructive-blueprints/references/module-presets.md) for how content presets are seeded.

## Human-only widening (unchanged)

| Mutation | Who | Purpose |
|----------|-----|---------|
| `db.mutation.setPrincipalScope` | human, step-up protected | Set `allowedMask` / `isReadOnly` / `isActive` / `useAdminOwner` for one `membershipType` of a principal |
| `db.mutation.setPrincipalEntities` | human | Replace the principal's entity list |
| `db.mutation.updatePrincipal` | human | Patch `name`, `bypassStepUp`, `isReadOnly`, `useAdminOwner` (`UpdatePrincipalInput`) |

A principal calling any of these fails with `PRINCIPAL_CANNOT_CREATE_PRINCIPAL` (`AuthzHumanOnly`). Widening is a human decision with a step-up behind it; agents can only ever shrink.
