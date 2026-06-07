# Deliverability Guide

How to handle bounces, complaints, and address suppression in the Constructive notification system.

For SQL-level internals (generator source, index details), see the `constructive-db-notifications` skill in constructive-db.

## Setting Up Provider Webhooks

### Amazon SES

1. **Create an SNS topic** for bounce/complaint notifications:
   ```bash
   aws sns create-topic --name ses-notifications
   ```

2. **Subscribe your webhook endpoint** to the topic:
   ```bash
   aws sns subscribe \
     --topic-arn arn:aws:sns:us-east-1:123456789:ses-notifications \
     --protocol https \
     --notification-endpoint https://api.yourapp.com/webhooks/ses
   ```

3. **Configure SES to publish to the topic:**
   ```bash
   aws ses set-identity-notification-topic \
     --identity your-domain.com \
     --notification-type Bounce \
     --sns-topic arn:aws:sns:us-east-1:123456789:ses-notifications

   aws ses set-identity-notification-topic \
     --identity your-domain.com \
     --notification-type Complaint \
     --sns-topic arn:aws:sns:us-east-1:123456789:ses-notifications
   ```

4. **Webhook handler pseudocode:**
   ```ts
   async function handleSESWebhook(payload) {
     const message = JSON.parse(payload.Message);
     const messageId = message.mail.messageId;

     // 1. Correlate via provider_message_id
     const logRow = await db.query(
       `SELECT * FROM notification_delivery_log WHERE provider_message_id = $1`,
       [messageId]
     );

     // 2. Update delivery log status
     if (message.notificationType === 'Bounce') {
       await db.query(
         `UPDATE notification_delivery_log SET status = 'bounced', response_payload = $1 WHERE provider_message_id = $2`,
         [message, messageId]
       );

       // 3. Suppress hard bounces
       if (message.bounce.bounceType === 'Permanent') {
         for (const recipient of message.bounce.bouncedRecipients) {
           await db.query(
             `INSERT INTO notification_suppressions (address, channel_type, reason, source, provider, metadata)
              VALUES ($1, 'email', 'hard_bounce', 'ses_webhook', 'ses', $2)
              ON CONFLICT (address, channel_type) DO NOTHING`,
             [recipient.emailAddress, message]
           );
         }
       }
     }

     if (message.notificationType === 'Complaint') {
       await db.query(
         `UPDATE notification_delivery_log SET status = 'complained', response_payload = $1 WHERE provider_message_id = $2`,
         [message, messageId]
       );

       for (const recipient of message.complaint.complainedRecipients) {
         await db.query(
           `INSERT INTO notification_suppressions (address, channel_type, reason, source, provider, metadata)
            VALUES ($1, 'email', 'complained', 'ses_webhook', 'ses', $2)
            ON CONFLICT (address, channel_type) DO NOTHING`,
           [recipient.emailAddress, message]
         );
       }
     }
   }
   ```

### SendGrid

1. **Configure Event Webhook** in SendGrid dashboard → Settings → Mail Settings → Event Webhook.
2. Set the POST URL to `https://api.yourapp.com/webhooks/sendgrid`.
3. Enable: `bounce`, `dropped`, `spamreport`, `delivered`.

4. **Webhook handler pseudocode:**
   ```ts
   async function handleSendGridWebhook(events) {
     for (const event of events) {
       const messageId = event.sg_message_id?.split('.')[0]; // strip filter suffix

       if (event.event === 'bounce') {
         await db.query(
           `UPDATE notification_delivery_log SET status = 'bounced', response_payload = $1 WHERE provider_message_id = $2`,
           [event, messageId]
         );
         await db.query(
           `INSERT INTO notification_suppressions (address, channel_type, reason, source, provider, metadata)
            VALUES ($1, 'email', 'hard_bounce', 'sendgrid_webhook', 'sendgrid', $2)
            ON CONFLICT (address, channel_type) DO NOTHING`,
           [event.email, event]
         );
       }

       if (event.event === 'spamreport') {
         await db.query(
           `UPDATE notification_delivery_log SET status = 'complained', response_payload = $1 WHERE provider_message_id = $2`,
           [event, messageId]
         );
         await db.query(
           `INSERT INTO notification_suppressions (address, channel_type, reason, source, provider, metadata)
            VALUES ($1, 'email', 'complained', 'sendgrid_webhook', 'sendgrid', $2)
            ON CONFLICT (address, channel_type) DO NOTHING`,
           [event.email, event]
         );
       }
     }
   }
   ```

### Twilio (SMS)

Configure `StatusCallback` URL when sending:

```ts
const message = await client.messages.create({
  to: '+15551234567',
  from: '+15559876543',
  body: 'Your verification code is 123456',
  statusCallback: 'https://api.yourapp.com/webhooks/twilio'
});

// Store message.sid as provider_message_id in delivery_log
```

Handle `undelivered` and `failed` statuses to suppress undeliverable phone numbers.

## Suppression List Management

### Checking before send

The delivery worker runs this before every send:

```sql
SELECT EXISTS (
  SELECT 1 FROM notification_suppressions
  WHERE address = $1 AND channel_type = $2
) AS is_suppressed;
```

### Viewing recent suppressions

```sql
SELECT address, channel_type, reason, source, provider, created_at
FROM notification_suppressions
ORDER BY created_at DESC
LIMIT 50;
```

### Removing a suppression

When a user re-verifies their email or an admin decides to retry:

```sql
DELETE FROM notification_suppressions
WHERE address = 'dan@example.com' AND channel_type = 'email';
```

### Bulk export for audit

```sql
COPY (
  SELECT address, channel_type, reason, source, provider, created_at
  FROM notification_suppressions
  ORDER BY created_at
) TO '/tmp/suppressions.csv' WITH CSV HEADER;
```

## Channel Auto-Deactivation

Each `notification_channels` row tracks consecutive failures:

```
failed_count: 0 → 1 → 2 → 3 → is_active = false
```

The delivery worker should:
1. On failure: increment `failed_count`, set `last_error` and `last_error_at`
2. On success: reset `failed_count = 0`, set `last_used_at = now()`
3. When `failed_count` exceeds threshold (e.g., 3): set `is_active = false`

This is **per-endpoint** deactivation (expired push tokens, revoked webhooks). Address-level suppression (bounced emails) is handled separately by `notification_suppressions`.

## Monitoring & Troubleshooting

### Delivery success rate (last 24h)

```sql
SELECT channel_type, status, COUNT(*) AS cnt,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY channel_type), 1) AS pct
FROM notification_delivery_log
WHERE created_at > now() - interval '24 hours'
GROUP BY channel_type, status
ORDER BY channel_type, cnt DESC;
```

### Complaint rate (should be < 0.1%)

```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'complained') AS complaints,
  COUNT(*) FILTER (WHERE status IN ('delivered', 'sent')) AS total_sent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'complained')
    / NULLIF(COUNT(*) FILTER (WHERE status IN ('delivered', 'sent')), 0), 3) AS complaint_rate_pct
FROM notification_delivery_log
WHERE channel_type = 'email'
  AND created_at > now() - interval '7 days';
```

### Channels approaching deactivation

```sql
SELECT id, owner_id, channel_type, endpoint, failed_count, last_error, last_error_at
FROM notification_channels
WHERE failed_count > 0 AND is_active = true
ORDER BY failed_count DESC;
```

### Debug a specific delivery

```sql
SELECT status, provider, provider_message_id, error, response_payload, attempt_count, sent_at
FROM notification_delivery_log
WHERE notification_id = $1
ORDER BY created_at;
```
