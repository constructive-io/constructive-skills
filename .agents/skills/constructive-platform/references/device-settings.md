# Device Settings

The `devices_module` provisions the `app_settings_device` singleton and the `auth_user_devices` table. When installed, every sign-in and sign-up records the caller's device (hashed token, IP, user agent, origin). On top of passive tracking, two independent feature toggles control security and convenience behavior.

## Settings Table (`app_settings_device`)

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `enable_device_tracking` | `boolean` | `true` | Master switch — disables all device behavior when `false` |
| `enable_trusted_devices` | `boolean` | `false` | **Convenience:** trusted devices skip MFA on subsequent sign-ins |
| `device_trust_duration` | `interval` | `'30 days'` | How long a trusted device stays trusted before requiring MFA again |
| `require_mfa_new_device` | `boolean` | `false` | **Hardening:** force MFA challenge when signing in from an unrecognized device, even if MFA isn't globally required |
| `require_device_approval` | `boolean` | `false` | **Hardening:** block sign-in from unrecognized devices until the user approves the device via email |
| `max_devices_per_user` | `integer` | `50` | Maximum tracked devices per user |

## Two Security Dimensions

The toggles fall into two independent categories:

### Add security (hardening for new devices)

- **`require_mfa_new_device`** — forces an MFA challenge when the device is unrecognized. Stacks with global MFA if both are on; only fires for new devices if global MFA is off.
- **`require_device_approval`** — after all other auth steps succeed, blocks session creation and returns `device_approval_required: true`. The user must click an email approval link before the device is allowed. First sign-up auto-approves the initial device (`approval_method = 'auto'`).

### Remove security (convenience for recognized devices)

- **`enable_trusted_devices`** — a recognized device marked as trusted (and within the trust duration) bypasses MFA entirely on future sign-ins.

These compose independently — you can enable both hardening toggles and the convenience toggle at the same time.

## Composition Matrix

All three toggles are independent booleans, producing 8 possible combinations. The most useful scenarios:

| `enable_trusted_devices` | `require_mfa_new_device` | `require_device_approval` | New device behavior | Recognized + trusted device |
|:---:|:---:|:---:|---|---|
| off | off | off | Password → session (passive tracking only) | Password → session |
| off | off | on | Password → **email approval gate** → session | Password → session (already approved) |
| off | on | off | Password → **forced MFA** → session | Password → session |
| off | on | on | Password → **forced MFA** → **email approval gate** → session | Password → session |
| on | off | off | Password → session, device tracked | Password → **skip MFA** → session |
| on | off | on | Password → **email approval gate** → session | Password → **skip MFA** → session |
| on | on | off | Password → **forced MFA** → session | Password → **skip MFA** → session |
| on | on | on | Password → **forced MFA** → **email approval gate** → session (Kraken-style) | Password → **skip MFA** → session |

### Common configurations

- **Passive tracking** (row 1): all toggles off. Devices are recorded but behavior is unchanged. Good for analytics.
- **MFA bypass only** (row 5): `enable_trusted_devices = true`. Users complete MFA once, then their device is trusted for 30 days. Good for consumer apps with TOTP.
- **Approval gate only** (row 2): `require_device_approval = true`. New devices must be email-confirmed before sign-in. Good for high-value accounts without MFA.
- **Full hardened** (row 8): all three on. New devices face forced MFA + email approval. Recognized trusted devices skip MFA. This is the Kraken/exchange-style flow.

## Auth Flow Integration

The device checks happen at specific points in the sign-in pipeline:

```
1. Password verification
2. MFA check  ←  require_mfa_new_device fires here (if new device)
3. Device approval gate  ←  require_device_approval fires here (if unapproved device)
4. Session creation
5. Device trust marking  ←  enable_trusted_devices marks device post-session
```

When `require_device_approval` blocks sign-in:
- The device is recorded as `is_approved = false` in `auth_user_devices`
- The sign-in response includes `device_approval_required: true` and `access_token: null`
- No session is created
- The user must approve the device (via email link calling `approve_device`) and retry sign-in

When `require_mfa_new_device` triggers:
- The sign-in returns `mfa_required: true` with an `mfa_challenge_token`
- The user completes MFA via `complete_mfa_challenge`
- If `require_device_approval` is also on, the approval gate fires after MFA

## Device Record Fields

The `auth_user_devices` table tracks:

| Field | Type | Description |
|-------|------|-------------|
| `device_token_hash` | `bytea` | SHA-256 hash of the opaque device token |
| `ip_address` | `inet` | IP from the most recent sign-in |
| `user_agent` | `text` | Browser/client user agent string |
| `origin` | `text` | Request origin header |
| `label` | `text` | Human-readable device name |
| `first_seen_at` | `timestamptz` | When the device was first used |
| `last_seen_at` | `timestamptz` | Most recent sign-in |
| `is_trusted` | `boolean` | Whether MFA can be skipped |
| `trusted_at` | `timestamptz` | When trust was established |
| `trust_expires_at` | `timestamptz` | When trust lapses (based on `device_trust_duration`) |
| `trust_method` | `text` | How trust was established: `'mfa_verified'`, `'email_link'`, `'admin'` |
| `is_approved` | `boolean` | Whether the device has been approved for sign-in |
| `approved_at` | `timestamptz` | When approval was granted |
| `approval_method` | `text` | How approval was granted: `'auto'` (first sign-up), `'email_link'`, `'admin'` |
| `revoked_at` | `timestamptz` | Soft-revoke timestamp (device is rejected if set) |

## SDK Usage

### Sign-in with device token

```typescript
const result = await authDb.mutation.signIn(
  { input: { email, password, deviceToken: '<opaque-token>' } },
  {
    select: {
      result: {
        select: {
          accessToken: true,
          mfaRequired: true,
          mfaChallengeToken: true,
          deviceApprovalRequired: true,
          outDeviceToken: true,
        }
      }
    }
  }
).execute();

const { accessToken, mfaRequired, deviceApprovalRequired, outDeviceToken } = result.signIn.result;

if (mfaRequired) {
  // Complete MFA challenge first
}

if (deviceApprovalRequired) {
  // Show "check your email to approve this device" UI
  // User clicks email link → approve_device endpoint
  // User retries sign-in from same device
}

// Store outDeviceToken in client storage for future sign-ins
```

### Sign-up (auto-approves first device)

```typescript
const result = await authDb.mutation.signUp(
  { input: { email, password, deviceToken: '<opaque-token>' } },
  { select: { outDeviceToken: true, accessToken: true } }
).execute();

// First device is auto-approved (approval_method = 'auto')
// Store outDeviceToken for future sign-ins
```

### Approve a device

```typescript
// Called when user clicks the email approval link
await authDb.mutation.approveDevice(
  { input: { token: '<approval-token-from-email>' } },
  { select: { ok: true } }
).execute();
```

## Module Installation

The `devices_module` is included in the `full` preset. To add it to other presets:

```typescript
const modules = [...preset.modules, 'devices_module'];

await db.databaseProvisionModule.create({
  data: { databaseName, modules: `{${modules.join(',')}}`, ... },
  select: { id: true },
}).execute();
```
