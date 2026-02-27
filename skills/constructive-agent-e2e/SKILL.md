---
name: constructive-agent-e2e
description: Full agentic development loop for Constructive Apps — provision DB, generate SDK, run app, then use agent-browser to screenshot, snapshot, interact, and iterate until the UI works. Use when building or verifying a Constructive-powered frontend end-to-end without a human in the loop.
compatibility: Node.js 22+, PostgreSQL 14+, Next.js 14+ (App Router), macOS (agent-browser uses Playwright/Chromium)
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Agent E2E — Full Agentic Dev Loop

Build, run, see, fix, repeat. No human required between provision and ship.

## The Loop

```
1. Provision DB          → Constructive SDK (secureTableProvision + relationProvision)
2. Generate SDK          → @constructive-io/graphql-codegen (hooks + ORM)
3. Start dev server      → pnpm dev (Next.js App Router)
4. Open in agent-browser → npx agent-browser open <url>
5. Screenshot            → agent-browser screenshot file.png
6. Snapshot              → agent-browser snapshot (accessibility tree + refs)
7. Interact              → agent-browser click @ref / fill @ref "value"
8. Observe → Fix → Push  → edit code, restart if needed, repeat from step 4
```

This loop is the foundation of Constructive's agentic full-stack development. An agent can
provision a database, scaffold UI, generate type-safe data hooks, run the app, and visually
verify + interact with it — all without human intervention per cycle.

---

## Prerequisites

```bash
# Install agent-browser (one-time)
npx agent-browser --version || npm install -g agent-browser

# Install Playwright Chromium (one-time)
npx playwright install chromium

# Verify Ollama is running (for AI chat features with nomic-embed-text)
ollama list | grep nomic-embed-text
```

---

## Step 1: Provision the Database

Use the Constructive SDK to provision tables and relations. Refer to the
`constructive-app-boilerplate` skill for the full provisioning pattern.

```ts
// scripts/provision.ts
import { createClient } from '@constructive-db/sdk/public';

const db = createClient({ adapter: localAdapter('api', accessToken) });

// Provision org-scoped tables
await db.secureTableProvision.create({
  data: {
    databaseId,
    tableName: 'contacts',
    nodeType: 'DataEntityMembership',
    policyType: 'AuthzEntityMembership',
    // ...
  },
}).execute();

// Provision M2M relations
await db.relationProvision.create({
  data: {
    relationType: 'RelationManyToMany',
    sourceTableId: contactsTableId,
    targetTableId: companiesTableId,
    junctionTableName: 'contact_companies',
    // ...
  },
}).execute();
```

**Run:**
```bash
pnpm ts-node scripts/provision.ts
# Note the databaseName from output — needed for codegen
```

---

## Step 2: Generate SDK

After provisioning, generate type-safe React Query hooks and ORM from the live endpoint.

```bash
# Generate hooks + ORM for the provisioned database
npx @constructive-io/graphql-codegen \
  --react-query \
  --orm \
  -e "http://app-public-<databaseName>.localhost:3000/graphql" \
  -o ./src/graphql/schema-builder-sdk/<target>

# Or via pnpm script (if configured in package.json)
pnpm generate-sdk <databaseName>
```

**Important — localhost DNS fix for Node.js:**
```bash
# Set browserCompatible: false in codegen config to use undici dispatcher
# This fixes *.localhost DNS resolution on macOS
```

After codegen, the `hooks/` directory will contain:
- `hooks/queries/use<Entity>Query.ts` — per-record and list queries
- `hooks/mutations/use<Action><Entity>Mutation.ts` — create/update/delete
- `hooks/client.ts` — `configure({ endpoint, headers })` setup
- `orm/` — Prisma-like client for server-side use

---

## Step 3: Wire SDK into the App

Call `configure()` once at the org layout level before any hooks are used.

```tsx
// src/app/orgs/[orgId]/layout.tsx
'use client';
import { configure } from '@/graphql/schema-builder-sdk/<target>/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

export default function OrgLayout({ children, params }) {
  configure({
    endpoint: `http://app-public-${params.databaseName}.localhost:3000/graphql`,
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

---

## Step 4: Start the Dev Server

```bash
cd frontends/<app>
pnpm dev
# Default: http://localhost:3000
# Note: *.localhost subdomains resolve via Next.js proxy in dev
```

Wait for `✓ Ready` before opening agent-browser.

---

## Step 5: Open with agent-browser

```bash
# Open the app (starts browser session)
npx agent-browser open http://localhost:3000

# Navigate to a specific page
npx agent-browser open http://localhost:3000/orgs/<orgId>/contacts
```

**agent-browser commands:**

| Command | Description |
|---|---|
| `open <url>` | Open URL in managed Chromium |
| `screenshot <file.png>` | Capture current state to file |
| `snapshot` | Print accessibility tree with `@ref` handles |
| `click @ref` | Click element by ref |
| `fill @ref "text"` | Type into input by ref |
| `navigate <url>` | Navigate to URL |
| `wait <ms>` | Wait milliseconds |
| `eval <js>` | Run JavaScript in page context |

---

## Step 6: Screenshot → Snapshot → Interact Loop

### Screenshot — See What's There

```bash
npx agent-browser screenshot current-state.png
# Read the image to understand the visual state
```

### Snapshot — Get Interactive Refs

```bash
npx agent-browser snapshot
# Output example:
# button "New Contact" @b1
# input "Search contacts" @i1
# row "contact-abc123" @r1
#   cell "2026-02-27" @c1
#   button "Edit" @b2
#   button "Delete" @b3
```

### Interact — Click and Fill

```bash
# Click "New Contact" button
npx agent-browser click @b1

# Fill a form field
npx agent-browser fill @i2 "Acme Corp"

# Submit a form
npx agent-browser click @b5   # "Save" button

# Take screenshot after action
npx agent-browser screenshot after-create.png
```

### Full Interaction Script Pattern

```bash
#!/bin/bash
# Verify contact creation flow end-to-end

npx agent-browser open http://localhost:3000/orgs/test-org/contacts
npx agent-browser screenshot 01-contacts-list.png

npx agent-browser snapshot > snapshot.txt
# Parse @ref for "New Contact" button
NEW_BTN=$(grep "New Contact" snapshot.txt | grep -o '@[a-z0-9]*')

npx agent-browser click $NEW_BTN
npx agent-browser screenshot 02-new-contact-form.png

npx agent-browser snapshot > snapshot2.txt
SAVE_BTN=$(grep "Save\|Submit\|Create" snapshot2.txt | grep -o '@[a-z0-9]*' | head -1)
npx agent-browser click $SAVE_BTN
npx agent-browser screenshot 03-after-create.png
```

---

## Step 7: Observe → Fix → Iterate

After each interaction, compare screenshots to expected state:

1. **Visual regression** — does the page look right? Any layout breaks?
2. **Error states** — red banners, console errors (`npx agent-browser eval "console.errors"`)?
3. **Missing data** — list shows but data doesn't appear → check hook `selection.fields`
4. **Navigation failures** → check route exists in `src/app/`

**Fix loop:**
```bash
# Edit code
vim src/app/orgs/[orgId]/contacts/page.tsx

# Next.js hot-reloads automatically (no restart needed for most changes)
# For layout/provider changes, restart pnpm dev

# Re-screenshot to verify
npx agent-browser screenshot fix-attempt.png
```

**When to restart pnpm dev:**
- Changes to `layout.tsx` (especially `configure()` call)
- New env variables
- Changes to `next.config.js`

---

## Common Patterns

### Verify CRUD Flow

```bash
# 1. List page loads
npx agent-browser open http://localhost:3000/orgs/org1/contacts
npx agent-browser screenshot list.png

# 2. Create
npx agent-browser click @new-btn
npx agent-browser screenshot create-form.png
npx agent-browser click @submit
npx agent-browser screenshot after-create.png

# 3. Detail page
npx agent-browser click @first-row-view
npx agent-browser screenshot detail.png

# 4. Edit
npx agent-browser click @edit-btn
npx agent-browser screenshot edit-form.png
npx agent-browser click @save
npx agent-browser screenshot after-edit.png

# 5. Delete
npx agent-browser click @delete-btn
npx agent-browser click @confirm-btn    # confirm dialog
npx agent-browser screenshot after-delete.png
```

### Verify Relations

```bash
# On contact detail page, link a company
npx agent-browser open http://localhost:3000/orgs/org1/contacts/<id>
npx agent-browser snapshot
npx agent-browser click @add-company-btn
npx agent-browser fill @company-search "Acme"
npx agent-browser click @company-option-1
npx agent-browser screenshot linked-company.png
```

### Verify Chat Widget

```bash
# Open chat drawer
npx agent-browser click @chat-toggle-btn
npx agent-browser screenshot chat-open.png

npx agent-browser fill @chat-input "Show me all contacts"
npx agent-browser click @chat-send
# Wait for streaming response
npx agent-browser wait 3000
npx agent-browser screenshot chat-response.png
```

---

## agent-browser in Coded Agents

When a coding agent (Codex/Claude Code) is running the loop, the prompt should include:

```
After implementing each page:
1. Run: npx agent-browser open <url>
2. Run: npx agent-browser screenshot screenshots/<page>.png
3. Read the screenshot to verify layout and data
4. Run: npx agent-browser snapshot to get interactive refs
5. Exercise the CRUD flow using click/fill/submit
6. Fix any errors and re-verify before moving to the next page
7. Save all screenshots to screenshots/ directory for review
```

---

## Tracking in agent.os

Log the build task in the agent OS database for observability:

```sql
-- Log the build process
INSERT INTO agent.processes (name, task_id, command, session_key, log_path)
VALUES (
  'crm-frontend-build',
  '<task-uuid>',
  'claude --full-auto "Build CRM frontend with agent-browser verification"',
  'session:main:main',
  '~/.openclaw/logs/crm-build.log'
);

-- Update status as phases complete
UPDATE agent.processes
SET status = 'running', metadata = '{"phase": "contacts-crud"}'::jsonb
WHERE name = 'crm-frontend-build';

-- Log completion
UPDATE agent.processes
SET status = 'done', ended_at = now(),
    metadata = '{"pages_built": 14, "screenshots": 28}'::jsonb
WHERE name = 'crm-frontend-build';
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `agent-browser: command not found` | `npm install -g agent-browser && npx playwright install chromium` |
| Blank screenshot | Wait for page load: `npx agent-browser wait 2000` then screenshot |
| `@ref` not in snapshot | Element may be hidden — check if drawer/modal is open |
| `configure()` not called error | Ensure `configure()` runs before first hook in layout |
| `*.localhost` DNS fails | Use `Host:` header trick or `[::1]:3000` — see constructive-graphql-codegen skill |
| Hot reload doesn't update | Restart `pnpm dev` — some changes require full restart |
| pgvector search returns nothing | Run `/api/crm/embed` first to embed existing records |

---

## References

See `references/` for:
- `agent-browser-commands.md` — full command reference
- `screenshot-patterns.md` — common screenshot verification patterns
- `provision-to-ui-checklist.md` — step-by-step new app checklist
