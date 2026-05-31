# Warning System

Usage warnings and threshold alerts for billing meters.

## Threshold Configuration

Warning thresholds fire notifications when usage reaches configured percentages of the effective limit. Thresholds are set per meter on the balance row.

## Warning Events

When a threshold is crossed, the system records a warning event that can trigger:
- In-app notifications via the realtime subscription system
- Email alerts via cloud functions
- Webhook calls via the billing provider bridge

## Integration

Warnings compose with the billing module — they read `current_usage` and `effective_limit` from the balance row and fire when the ratio crosses the configured threshold.
