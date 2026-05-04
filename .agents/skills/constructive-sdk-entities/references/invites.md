# Invites

The invite system allows existing members to invite new users to an app, organization, or dynamic entity. Invites are provisioned per-scope when `has_invites: true` is set on an entity type (or via `invites_module` in blueprints).

## Invite Types

| Type | `email` field | `multiple` field | Behavior |
|------|--------------|-----------------|----------|
| **Email invite** | Set to recipient's email | `false` | Targeted — only the user with that email can claim it |
| **Blank invite** | `NULL` | `false` | Shareable — anyone with the code can claim it (single-use) |
| **Multiple invite** | `NULL` | `true` | Reusable — anyone with the code can claim it up to `invite_limit` times |

### Key Differences

- **Email invites** are sent directly to a recipient. Having the code proves email access.
- **Blank/multiple invites** are shareable links or codes. They can be copy/pasted and forwarded to anyone.
- Only **email invites** support profile assignment (`profile_id`).

---

## Claiming Invites

### Mutations

- **App-level:** `submitAppInviteCode(inviteCode: UUID!)` → `Boolean`
- **Entity-level:** `submitInviteCode(inviteCode: UUID!)` → `Boolean` (scoped to the entity's schema)

### Claim Flow

```
User calls submitInviteCode(code)
  ↓
1. Validate user exists (current_user_id())
2. Validate invite exists and is not expired
3. Check invite_limit (for multiple invites)
4. Email check:
   - Email invite: verify user owns that email → auto-verify the email
   - Blank/multiple: verify user has ANY verified email → fail with EMAIL_NOT_VERIFIED if not
5. Invalidate invite (email invites) or increment count (multiple invites)
6. Create claimed_invites record
7. Create or update membership:
   - If sender has send_approved_invites: membership.is_approved = true
   - Otherwise: membership.is_approved = false (waitlist)
   - If invite has profile_id: membership.profile_id = invite.profile_id
```

### Email Verification Behavior

| Invite Type | Verification Behavior |
|---|---|
| Email invite | **Auto-verifies** the user's email on successful claim. Having the invite code proves they received the email. The SPRT cascade fires immediately. |
| Blank invite | **Requires** a verified email before claiming. Returns `EMAIL_NOT_VERIFIED` if no verified email exists. |
| Multiple invite | Same as blank — requires verified email. |

### ON CONFLICT (Existing Members)

When a user already has a membership (e.g., from signUp on a waitlist app):

| Branch | Behavior |
|---|---|
| Sender has `send_approved_invites` | `ON CONFLICT UPDATE SET is_approved = true, profile_id = CASE...` |
| Sender lacks `send_approved_invites` | If profiles: `ON CONFLICT UPDATE SET profile_id = CASE...` (preserves `is_approved`). If no profiles: `ON CONFLICT DO NOTHING` |

The `profile_id` CASE expression: only updates if the invite explicitly specified a profile. If `invite.profile_id IS NULL`, preserves the user's existing profile (prevents accidental overwrites from default profile triggers).

---

## Profile Assignment on Invites

When `profiles_module` is installed alongside `invites_module`, email invites can carry a `profile_id` that pre-assigns a named permission bundle to the recipient.

### Blueprint Configuration

```json
{
  "entity_types": [
    {
      "name": "Organization Member",
      "prefix": "org",
      "has_invites": true,
      "has_profiles": true
    }
  ]
}
```

### Creating an Invite with Profile

```typescript
// ORM
await db.orgInvite.create({
  data: {
    email: 'newuser@example.com',
    senderId: currentUserId,
    entityId: orgId,
    profileId: editorProfileId,  // pre-assign "Editor" role
  },
}).execute();
```

```bash
# CLI
constructive public:org-invite create \
  --email newuser@example.com \
  --senderId $USER_ID \
  --entityId $ORG_ID \
  --profileId $EDITOR_PROFILE_ID
```

### Restrictions

- Only **email invites** can carry `profile_id`. Blank and multiple invites are rejected with `PROFILE_ASSIGNMENT_REQUIRES_EMAIL_INVITE`.
- The inviter must pass the permission model check (see below).

---

## Permission Model for Profile Assignment

A configurable permission model controls who can assign profiles to invites. The mode is set per-organization via `membership_settings.invite_profile_assignment_mode`.

### Modes

| Mode | Behavior | Default |
|------|----------|---------|
| `strict` | Requires `assign_profiles` permission **AND** profile's permissions must be a subset of inviter's | **Yes (default)** |
| `permission_only` | Requires `assign_profiles` permission only — no subset check | No |
| `subset_only` | No permission needed — any user with `create_invites` can assign profiles with permissions <= their own | No |

### App-Level Behavior

App-level memberships always use `strict` mode (hardcoded). There is no configurable setting at the app scope.

### Configuring the Mode (ORM)

```typescript
await db.orgMembershipSetting.update({
  where: { entityId: { equalTo: orgId } },
  data: {
    inviteProfileAssignmentMode: 'permission_only',
  },
}).execute();
```

### Permission Check Details

The check happens at **invite creation time** (BEFORE INSERT trigger on invites table), not at claim time. This prevents creating invites with unauthorized profiles.

**Strict mode** (both checks):
1. `assign_profiles` permission check on the sender
2. Subset check: the profile's permissions must be a subset of the inviter's permissions — the profile cannot grant any permission the inviter lacks

**Permission only** (check 1 only):
- Anyone with `assign_profiles` can assign any profile, regardless of their own permission level

**Subset only** (check 2 only):
- No special permission needed, but the inviter can only assign profiles with permissions that are a subset of their own

---

## Permissions

| Permission | Description |
|---|---|
| `create_invites` | Can create invites |
| `admin_invites` | Can view and manage all invites in the scope |
| `send_approved_invites` | Invites from this user auto-approve the new membership (skip waitlist) |
| `assign_profiles` | Can attach a `profile_id` to email invites (required in `strict` and `permission_only` modes) |

---

## Error Codes

| Error Code | When Raised | Context |
|---|---|---|
| `INVITE_NOT_FOUND` | Invite doesn't exist or is expired | Claim |
| `INVITE_LIMIT` | Multiple invite has reached its usage limit | Claim |
| `INVITE_EMAIL_NOT_FOUND` | User's email doesn't match the email invite's target | Claim |
| `EMAIL_NOT_VERIFIED` | Blank/multiple invite claim without a verified email | Claim |
| `PROFILE_ASSIGNMENT_REQUIRES_EMAIL_INVITE` | `profile_id` set on a blank or multiple invite | Creation |
| `ASSIGN_PROFILES_PERMISSION_REQUIRED` | Sender lacks `assign_profiles` permission (strict/permission_only modes) | Creation |
| `PROFILE_NOT_FOUND` | Referenced profile doesn't exist | Creation |
| `PROFILE_EXCEEDS_PERMISSIONS` | Profile's permissions exceed inviter's (strict/subset_only modes) | Creation |
| `MEMBERSHIP_NOT_FOUND` | Inviter's membership not found for permission check | Creation |

All error codes are in the Graphile server's `SAFE_ERROR_CODES` allowlist — they pass through to clients in production (not masked).

---

## Tables Created

When `has_invites: true` is set on an entity type with prefix `{prefix}`:

| Table | Description |
|---|---|
| `{prefix}_invites` | Invite records (email, sender_id, entity_id, invite_code, profile_id, multiple, invite_limit, invite_count, expires_at) |
| `{prefix}_claimed_invites` | Records of claimed invites (invite_id, user_id, data, claimed_at) |

### Generated Functions

| Function | Description |
|---|---|
| `submit_{prefix}_invite_code(invite_code UUID)` | Claims an invite code for the current user |
| `invite_profile_check()` | BEFORE INSERT trigger validating profile assignment permissions |

---

## Admin/Owner Elevation

Profile assignment on invites covers **profiles** (named permission bundles), but does NOT grant **administrator** or **owner** status. These are separate grant levels with system-wide elevated access.

**Admin elevation is post-membership only.** The recommended workflow:

1. Invite the user with an appropriate profile (e.g., a high-permission profile)
2. User claims the invite and joins as a regular member
3. An existing admin promotes them to administrator after they've joined

This is by design — admin grants are high-trust and should only be assigned to known, verified members. Allowing admin elevation via invite codes would be a security risk if the code were leaked or forwarded.

To promote an existing member to admin:

```typescript
// ORM — update membership to admin
await db.orgMembership.update({
  where: { actorId: { equalTo: userId }, entityId: { equalTo: orgId } },
  data: { isAdmin: true },
}).execute();
```

```bash
# CLI
constructive public:org-membership update \
  --where.actorId $USER_ID \
  --where.entityId $ORG_ID \
  --data.isAdmin true
```

---

## Without Profiles Module

When `has_profiles: false` (or profiles module not installed), the invite system operates without any profile logic:
- `profile_id` column doesn't exist on invites
- `invite_profile_check` trigger is not created
- Claim flow creates memberships with default profile (or no profile)
- ON CONFLICT behavior: approved branch does `SET is_approved = true`, not-approved branch does `DO NOTHING`
