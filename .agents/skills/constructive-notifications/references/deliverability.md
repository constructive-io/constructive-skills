# Deliverability Guide

How to handle bounces, complaints, and address suppression in the Constructive notification system.

For SQL-level internals (generator source, table DDL, indexes, monitoring queries), see the `constructive-db-notifications` skill in constructive-db.

## Delivery Status Lifecycle

Notifications move through these statuses as they're processed by the delivery worker:

| Status | Meaning | Set by |
|--------|---------|--------|
| `pending` | Created, not yet picked up | Default on insert |
| `sent` | Provider accepted the message | Delivery worker |
| `delivered` | Provider confirmed delivery | Webhook handler |
| `failed` | Delivery attempt failed (bad endpoint, auth error) | Delivery worker |
| `throttled` | Provider rate-limited the request (retry later) | Delivery worker |
| `grouped` | Collapsed into a digest batch, no individual send | Digest worker |
| `bounced` | Provider reported a hard or soft bounce | Webhook handler |
| `complained` | Recipient marked the message as spam | Webhook handler |

### Bounced vs Complained

These are different signals requiring different responses:

- **Bounced** — the mailbox doesn't exist, is full, or the domain is unreachable. Hard bounces mean "never send to this address again."
- **Complained** — the recipient actively clicked "Report Spam." This is a CAN-SPAM/GDPR signal. ISPs penalize complaint rates above 0.1%, so this is more damaging to sender reputation than bounces.

Both should result in suppression entries to prevent future sends.

## Webhook Ingestion

When a provider (SES, SendGrid, Twilio) fires an async webhook for a bounce or complaint, your handler should:

1. **Correlate** the webhook payload to the delivery_log row using `provider_message_id` (indexed for O(1) lookup)
2. **Update the delivery_log status** to `bounced` or `complained`, storing the raw webhook payload in `response_payload`
3. **Insert a suppression entry** for hard bounces and complaints (the unique constraint on `(address, channel_type)` makes this idempotent)
4. **Update the channel** — increment `failed_count`, set `last_error` and `last_error_at`

### Provider-Specific Notes

**Amazon SES:** Configure SNS topics for Bounce and Complaint notification types on your sending identity. The webhook payload contains `mail.messageId` for correlation and `bounce.bounceType` (`Permanent` vs `Transient`) to distinguish hard from soft bounces.

**SendGrid:** Enable Event Webhook for `bounce`, `dropped`, `spamreport`, and `delivered` events. The `sg_message_id` field contains the correlation ID (strip the `.filterXXX` suffix). The `spamreport` event maps to the `complained` status.

**Twilio (SMS):** Set a `StatusCallback` URL when sending messages. The `MessageSid` serves as the correlation ID. `undelivered` and `failed` statuses indicate undeliverable phone numbers.

## Suppression List

The `notification_suppressions` table provides address-level blocking. The delivery worker should check this before every send — if an address is suppressed for the given channel type, skip the send entirely.

### Suppression Reasons

| Reason | When to insert | Source |
|--------|---------------|--------|
| `hard_bounce` | Provider reported a permanent bounce | Auto (webhook handler) |
| `complained` | Recipient reported spam | Auto (webhook handler) |
| `manual` | Admin manually suppressed an address | Manual (admin action) |
| `unsubscribed` | User unsubscribed from all notifications via that channel | Manual (user action) |

### Lifecycle

- **Add:** Webhook handler inserts on hard bounce or complaint. The unique constraint on `(address, channel_type)` makes repeated inserts idempotent.
- **Remove:** When a user re-verifies their email or an admin decides to retry, delete the suppression entry.
- The suppression table is in the **private schema** — it's not exposed via GraphQL. Management is done through the delivery worker and admin tooling.

## Channel Auto-Deactivation

Each `notification_channels` row tracks consecutive delivery failures via `failed_count`:

```
failed_count: 0 → 1 → 2 → 3 → is_active = false
```

The delivery worker should:
1. **On failure:** increment `failed_count`, set `last_error` and `last_error_at`
2. **On success:** reset `failed_count = 0`, set `last_used_at`
3. **When threshold exceeded** (e.g., 3): set `is_active = false`

This handles **per-endpoint** deactivation (expired push tokens, revoked webhook URLs). Address-level suppression (hard-bounced emails) is a separate concern handled by `notification_suppressions`.

## Key Metrics to Monitor

- **Delivery rate** — percentage of `sent` that reach `delivered`. Below 95% warrants investigation.
- **Bounce rate** — hard bounces as a percentage of total sends. Above 2% risks ISP throttling.
- **Complaint rate** — `complained` as a percentage of `delivered`. Above 0.1% triggers ISP penalties and potential account suspension.
- **Channels approaching deactivation** — channels with `failed_count > 0` and `is_active = true` indicate endpoints that may need attention.
