---
name: constructive-local-email-services
description: Start local email services for testing invite, password reset, and verification emails. Use when setting up local development environment for email functionality.
compatibility: macOS, Linux
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Local Email Services

Start Mailpit, Admin GraphQL Server, send-email-link, and job-service for local email testing.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Local Development                        │
│                                                              │
│   Next.js (3011) ──► Public GraphQL (5433)                  │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                  Email Services                      │   │
│   │                                                      │   │
│   │   Admin GraphQL (3002)                              │   │
│   │         │                                           │   │
│   │         ▼                                           │   │
│   │   send-email-link (8082)                            │   │
│   │         │                                           │   │
│   │         ▼                                           │   │
│   │   Mailpit (1025/8025) ◄── job-service               │   │
│   │                                                      │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   PostgreSQL (5432) ◄── job-service polls app_jobs          │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. PostgreSQL running with constructive database
2. Database provisioned with `app_jobs` schema
3. Site domain added to `services_public.sites`

## Step 1: Start Mailpit

```bash
# Install (first time)
brew install mailpit

# Start
screen -dmS mailpit mailpit

# Verify
curl -s http://localhost:8025 | head -1
# Should return HTML
```

**Mailpit UI:** http://localhost:8025

## Step 2: Start Admin GraphQL Server (port 3002)

> **Important:** Must include `--origin "*"` to avoid interactive prompt that hangs in Agent/CI environments.

```bash
cd $CONSTRUCTIVE_PATH

screen -dmS admin-server bash -c '
  eval "$(pgpm env)" && \
  PGDATABASE=constructive \
  API_ENABLE_SERVICES=true \
  API_IS_PUBLIC=false \
  API_ANON_ROLE=administrator \
  API_ROLE_NAME=administrator \
  API_EXPOSED_SCHEMAS=metaschema_public,services_public,constructive_auth_public \
  API_META_SCHEMAS=metaschema_public,services_public,metaschema_modules_public,constructive_auth_public \
  constructive server --port 3002 --origin "*"
'

# Verify (use X-Meta-Schema header for internal API routing)
sleep 10
curl -s http://localhost:3002/graphql -H "X-Meta-Schema: true" -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}' | grep -q __typename && echo "✅ Admin server running"
```

## Step 3: Start send-email-link (port 8082)

```bash
cd $CONSTRUCTIVE_PATH

screen -dmS send-email-link bash -c '
  PORT=8082 \
  LOG_LEVEL=info \
  GRAPHQL_URL=http://localhost:3002/graphql \
  META_GRAPHQL_URL=http://localhost:3002/graphql \
  GRAPHQL_API_NAME=private \
  EMAIL_SEND_USE_SMTP=true \
  SMTP_HOST=localhost \
  SMTP_PORT=1025 \
  SMTP_FROM=noreply@localhost \
  SEND_EMAIL_LINK_DRY_RUN=false \
  ALLOW_LOCALHOST=true \
  LOCAL_APP_PORT=3011 \
  node functions/send-email-link/dist/index.js
'

# Verify
sleep 2
curl -s http://localhost:8082/health && echo " ✅ send-email-link running"
```

## Step 4: Start job-service

```bash
cd $CONSTRUCTIVE_PATH

screen -dmS job-service bash -c '
  eval "$(pgpm env)" && \
  PGDATABASE=constructive \
  JOBS_SCHEMA=app_jobs \
  JOBS_SUPPORT_ANY=true \
  JOBS_SUPPORTED=send-email-link \
  HOSTNAME=local-worker \
  INTERNAL_JOBS_CALLBACK_PORT=8080 \
  INTERNAL_JOBS_CALLBACK_URL=http://localhost:8080/callback \
  JOBS_CALLBACK_HOST=localhost \
  INTERNAL_GATEWAY_URL=http://localhost:8082 \
  INTERNAL_GATEWAY_DEVELOPMENT_MAP="{\"send-email-link\":\"http://localhost:8082\"}" \
  node jobs/knative-job-service/dist/run.js
'

# Verify
sleep 2
screen -ls | grep job-service && echo "✅ job-service running"
```

## Verify All Services

```bash
echo "=== Service Status ==="
screen -ls

echo ""
echo "=== Port Check ==="
lsof -i:8025 | head -1 && echo "✅ Mailpit (8025)"
lsof -i:3002 | head -1 && echo "✅ Admin GraphQL (3002)"
lsof -i:8082 | head -1 && echo "✅ send-email-link (8082)"
lsof -i:8080 | head -1 && echo "✅ job-service (8080)"
```

## Test Email Flow

1. Open Mailpit: http://localhost:8025
2. Trigger an invite from your app
3. Check Mailpit for the email

## Managing Services

```bash
# List all screens
screen -ls

# Attach to a screen (view logs)
screen -r mailpit
screen -r admin-server
screen -r send-email-link
screen -r job-service

# Detach from screen: Ctrl+A, then D

# Stop a service
screen -S mailpit -X quit
screen -S admin-server -X quit
screen -S send-email-link -X quit
screen -S job-service -X quit

# Stop all
screen -ls | grep -E "mailpit|admin-server|send-email-link|job-service" | cut -d. -f1 | xargs -I{} screen -S {} -X quit
```

## Troubleshooting

### Port already in use

```bash
# Find and kill process on port
lsof -i:8082 | awk 'NR>1 {print $2}' | xargs kill -9
```

### Screen not found

```bash
# Install screen
brew install screen
```

### Email not appearing in Mailpit

1. Check job-service logs: `screen -r job-service`
2. Check send-email-link logs: `screen -r send-email-link`
3. Verify SMTP connection: `curl -v telnet://localhost:1025`

### Admin server connection refused

```bash
# Check if running (use X-Meta-Schema header for internal API routing)
curl http://localhost:3002/graphql -H "X-Meta-Schema: true" -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}'

# If not, restart
screen -S admin-server -X quit
# Then run Step 2 again
```

### Admin server hangs on startup (Agent/CI environment)

**Problem:** Admin server starts but port 3002 never listens. The process appears to hang.

**Cause:** `constructive server` without `--origin` flag enters interactive mode, waiting for user to input CORS origin. In Agent/CI environments, there's no TTY input, so it hangs indefinitely.

**Solution:** Always include `--origin "*"` (or a specific origin) in the command:

```bash
constructive server --port 3002 --origin "*"
```

## Quick Start Script

Create `start-email-services.sh`:

```bash
#!/bin/bash
set -e

CONSTRUCTIVE_PATH="${CONSTRUCTIVE_PATH:-/path/to/constructive}"
cd "$CONSTRUCTIVE_PATH"
eval "$(pgpm env)"

echo "Starting Mailpit..."
screen -dmS mailpit mailpit

echo "Starting Admin GraphQL Server (3002)..."
screen -dmS admin-server bash -c '
  eval "$(pgpm env)" && \
  PGDATABASE=constructive \
  API_ENABLE_SERVICES=true \
  API_IS_PUBLIC=false \
  API_ANON_ROLE=administrator \
  API_ROLE_NAME=administrator \
  API_EXPOSED_SCHEMAS=metaschema_public,services_public,constructive_auth_public \
  API_META_SCHEMAS=metaschema_public,services_public,metaschema_modules_public,constructive_auth_public \
  constructive server --port 3002 --origin "*"
'

sleep 10

echo "Starting send-email-link (8082)..."
screen -dmS send-email-link bash -c '
  PORT=8082 \
  GRAPHQL_URL=http://localhost:3002/graphql \
  META_GRAPHQL_URL=http://localhost:3002/graphql \
  GRAPHQL_API_NAME=private \
  EMAIL_SEND_USE_SMTP=true \
  SMTP_HOST=localhost \
  SMTP_PORT=1025 \
  SMTP_FROM=noreply@localhost \
  SEND_EMAIL_LINK_DRY_RUN=false \
  ALLOW_LOCALHOST=true \
  LOCAL_APP_PORT=3011 \
  node functions/send-email-link/dist/index.js
'

sleep 2

echo "Starting job-service..."
screen -dmS job-service bash -c '
  eval "$(pgpm env)" && \
  PGDATABASE=constructive \
  JOBS_SCHEMA=app_jobs \
  JOBS_SUPPORT_ANY=true \
  JOBS_SUPPORTED=send-email-link \
  HOSTNAME=local-worker \
  INTERNAL_JOBS_CALLBACK_PORT=8080 \
  INTERNAL_JOBS_CALLBACK_URL=http://localhost:8080/callback \
  JOBS_CALLBACK_HOST=localhost \
  INTERNAL_GATEWAY_URL=http://localhost:8082 \
  INTERNAL_GATEWAY_DEVELOPMENT_MAP="{\"send-email-link\":\"http://localhost:8082\"}" \
  node jobs/knative-job-service/dist/run.js
'

sleep 2

echo ""
echo "✅ All services started!"
echo ""
echo "Mailpit UI: http://localhost:8025"
echo "Admin GraphQL: http://localhost:3002/graphql"
echo ""
screen -ls
```
