---
name: constructive-notifications
description: "Notification system — inbox, delivery, channels, preferences, bounce/complaint handling, suppression list, and digest batching. Use when asked to 'add notifications', 'notification preferences', 'bounce handling', 'complaint handling', 'suppression list', 'delivery log', 'notification channels', 'digest batching', 'quiet hours', 'webhook ingestion', 'SES bounces', 'SendGrid webhooks', 'channel deactivation', or when working with notifications_module in blueprints."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Notifications

Multi-channel notification system with inbox, delivery tracking, bounce/complaint handling, address suppression, and digest batching.

Use the Notifications feature pack through [`constructive-blocks`](../constructive-blocks/SKILL.md) for the tenant inbox UI. Its standalone view renders host-supplied inbox resources and actions. Its Console module requires an explicit reachable `notifications` endpoint whose introspection exposes the required operations, so installation alone does not prove Console availability.

The current Blocks view and Console adapter expose inbox resources plus
read-state actions only. Discovery may report `notifications.settings` when
`Query.notificationPreferences` exists, but that evidence does not create a
rendered settings route, preferences form, or settings adapter. Build a custom
settings surface against the domain contract when the product needs one, and
do not present that surface as part of the installed Notifications block.

## When to Apply

Use this skill when:
- Adding notifications to a Constructive app
- Configuring notification channels (email, push, SMS, webhook)
- Setting up bounce/complaint webhook handlers (SES, SendGrid, Twilio)
- Working with the suppression list (blocking sends to hard-bounced/complained addresses)
- Implementing notification preferences, quiet hours, or digest batching
- Debugging delivery failures or channel deactivation
- Understanding the notification table graph and delivery lifecycle

## Module Setup

The current `full` backend profile includes notifications. For a custom backend composition, add `notifications_module` through the supported Constructive DB provisioning mechanism; do not reconstruct a preset's module array in application code.

### Feature Flags

Control which sub-features are generated (zero dead code when off):

| Flag | Default | What it gates |
|------|---------|---------------|
| `has_channels` | `true` | Device endpoints, delivery log, suppression list |
| `has_preferences` | `true` | Per-user channel toggles by category/topic |
| `has_settings_extension` | `false` | Quiet hours, digest frequency, master switch on user/org settings |
| `has_digest_metadata` | `false` | Group collapsing, digest buckets, deliver_after scheduling |
| `has_subscriptions` | `false` | *(reserved for future topic subscription table)* |

## Table Graph

```
notifications_module (config)
├── notifications              (public, RLS: AuthzComposite)
│   └── notification_read_state (public, RLS: AuthzDirectOwner)
├── notification_preferences    (public, RLS: AuthzDirectOwner) [has_preferences]
├── notification_channels       (public, RLS: AuthzDirectOwner) [has_channels]
├── notification_delivery_log   (private, no RLS)               [has_channels]
└── notification_suppressions   (private, no RLS)               [has_channels]
```

**Public tables** are exposed via GraphQL with RLS. **Private tables** (delivery log and suppressions) are internal; delivery workers and webhook handlers must use their supported backend service surface rather than application GraphQL or direct table access.

## Delivery Status Lifecycle

```
pending → sent → delivered
                → bounced      (async webhook, hard/soft bounce)
                → complained   (async webhook, recipient marked as spam)
           → failed            (immediate failure)
           → throttled         (rate-limited by provider)
→ grouped                      (collapsed into digest)
```

Key distinction: **bounced** (mailbox doesn't exist) and **complained** (recipient clicked "Report Spam") are different signals requiring different responses. Both create suppression entries, but complaint rates > 0.1% trigger ISP penalties.

## References

| File | Content |
|------|---------|
| [deliverability.md](./references/deliverability.md) | Webhook setup (SES/SendGrid/Twilio), suppression management, channel deactivation, monitoring queries |
| [tables.md](./references/tables.md) | All 6 tables with columns, types, defaults, and descriptions |

## Cross-References

- **SQL-level generator internals:** `constructive-db-notifications` skill in constructive-db
- **Realtime subscriptions (separate system):** [`constructive-realtime`](../constructive-realtime/SKILL.md)
- **Background job triggers:** [`constructive-jobs`](../constructive-jobs/SKILL.md)
- **Billing/limits for rate caps:** [`constructive-billing`](../constructive-billing/SKILL.md)
- **Notifications feature-pack UI:** [`constructive-blocks`](../constructive-blocks/SKILL.md)
