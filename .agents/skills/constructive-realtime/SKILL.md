---
name: constructive-realtime
description: "Subscriptions, notifications, change_log, CursorTracker — real-time data via GraphQL subscriptions, PostGraphile live queries, and change tracking. Use when asked to 'add subscriptions', 'real-time updates', 'live queries', 'notifications', 'change_log', 'CursorTracker', 'websocket', or when working with real-time features in Constructive."
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Realtime

Real-time data delivery via GraphQL subscriptions, live queries, and change tracking.

## When to Apply

Use this skill when:
- Adding real-time subscriptions to a Constructive app
- Working with PostGraphile live queries
- Implementing change tracking and notifications
- Using WebSocket connections for real-time updates

## Core Concepts

### GraphQL Subscriptions

PostGraphile v5 provides built-in subscription support via WebSocket (graphql-ws protocol). Subscriptions are automatically generated for any table with appropriate grants.

### Live Queries

PostGraphile's `@stream` and `@live` directives enable:
- **Live queries** — auto-refresh results when underlying data changes
- **Streaming** — progressive delivery of large result sets

### Change Tracking

The `change_log` system records row-level changes (INSERT, UPDATE, DELETE) that power both subscriptions and audit trails.

## References

| File | Content |
|------|---------|
| [realtime-subscriptions.md](./references/realtime-subscriptions.md) | Full subscription setup, WebSocket config, and patterns |

## Cross-References

- **Server configuration:** [`constructive-platform`](../constructive-platform/SKILL.md)
- **Generated hooks (React Query):** [`constructive-hooks`](../constructive-hooks/SKILL.md)
- **Events and tracking:** [`constructive-events`](../constructive-events/SKILL.md)
