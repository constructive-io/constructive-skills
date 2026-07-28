# Brief Intake

You're loaded because `.constructive/BRIEF.md` has no real content yet (still the template stub). Walk the user through a tight brief, then write `BRIEF.md` and append per-entity feature rows to `.constructive/feature_list.json`.

This skill never touches app code. Brief in, two file writes out, hand back to the orchestrator.

## Autonomous-inference mode (DEFAULT when the launch prompt already describes the app)

Before asking anything, check what you already have. If the user's launch prompt (or an
existing partially-filled `BRIEF.md`) already conveys **what the app is** — enough to name
it and name at least one entity — do **NOT** run the one-question-at-a-time Q&A below.
Blocking on a human reply is the single largest time sink in a build (it cost ~18 min in
the first full run, more than every other phase combined). Instead:

1. Infer the kebab-case app name, one-line summary, the entity list (PascalCase
   singular), each entity's custom fields (`snake_case` + type), and relationships,
   directly from the prompt. Use sensible defaults: auth = email + password /
   `authenticated`; a single obvious entity if only one is implied (e.g. "todo app" →
   `Todo` with `title: text`, `is_done: boolean`).
2. Emit ONE short line stating the assumptions you're proceeding with (name, entities,
   key fields) — for the record, not as a question. Do not wait for confirmation.
3. Write `BRIEF.md` + append the feature rows (sections below), then hand back to the
   orchestrator and keep building.

Only fall through to the interactive questions below when the prompt is genuinely empty
or self-contradictory (e.g. "build me an app" with no domain at all), or the user has
explicitly asked to be walked through the brief. When in doubt for a routine CRUD app,
prefer to infer and proceed — a wrong-but-reasonable assumption is cheap to correct
later; an 18-minute stall is not.

## Goal

By the time you're done:
- `.constructive/BRIEF.md` is filled in (no template `_(none specified)_` for sections the user actually answered).
- `.constructive/feature_list.json` has one new `<entity>-crud-ui` row per entity the user named, each with `dependencies: ["frontend-scaffold"]`.

## The questions (FALLBACK path — only when autonomous-inference above doesn't apply)

Ask these only if the launch prompt didn't give you enough to infer the brief.

Do NOT bundle them. Ask the first, wait for the answer, then the next. Keep your prose minimal.

1. **App name + one-line description.**
   - Name in kebab-case (`notes-app`, `team-tracker`). Used as the slug everywhere.
   - One sentence on what the app is for.

2. **What entities does this app track?**
   - PascalCase singular per entity (`Note`, `Category`, `Task`).
   - If the user says "users", confirm: "Constructive provisions the users table for you, so I won't create a `users` table (`NAMING-001`). But I can still add a `User: list/edit` UI feature against the platform table — do you want that?" Append `user-crud-ui` only if they say yes.

3. **For each entity, what custom fields?**
   - Custom domain fields only. Skip `id`, `entity_id`, `owner_id`, `created_at`, `updated_at` — those come from the node type.
   - Use `snake_case` names + a type hint (`text`, `integer`, `boolean`, `timestamptz`). E.g. `title: text`, `is_pinned: boolean`.

4. **Relationships between entities?**
   - One liner each: "a Note belongs to a Category", "Tasks have many Tags".
   - Skip if the app is single-entity.

5. **Auth model.**
   - Default: email + password, `authenticated` role. Confirm or override (magic link / OAuth / extra roles).

Optional — only if the user volunteers details:
- Acceptance flows (e.g. "signup → create note → see it in list").
- Out-of-scope items.

## Writing BRIEF.md

Overwrite `.constructive/BRIEF.md` using the headings already in the template (`## Identity`, `## Data Model`, `## Auth`, `## Acceptance`, `## Out of scope`). One `### EntityName` block per entity under Data Model, listing fields and relations.

For any heading the user didn't speak to, write `_(none specified)_` instead of leaving it blank — that way the file is unambiguously "filled".

Use the `Write` tool to write the file. No `<<EOF` heredoc tricks.

## Appending feature rows

For each entity the user confirmed (PascalCase), append one row to `features[]`. Use `node -e` — mirror the pattern in `init.sh` / `verify-feature.sh`, do not introduce a different style:

```bash
node -e '
  const fs = require("fs");
  const p = ".constructive/feature_list.json";
  const list = JSON.parse(fs.readFileSync(p));

  // Replace this array with the entities the user actually confirmed.
  const entities = ["Note", "Category"];

  for (const e of entities) {
    const id = e.toLowerCase() + "-crud-ui";
    if (list.features.some(f => f.id === id)) continue;  // idempotent
    list.features.push({
      id,
      name: e + ": list / create / edit / delete UI",
      skill: "constructive-skill-supplements",
      entity: e,
      dependencies: ["frontend-scaffold"],
      status: "not-started",
      evidence: ""
    });
  }

  // Update brief block from the conversation.
  list.brief = { name: "notes-app", summary: "Simple note-taking app." };

  fs.writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
'
```

Substitute the actual `entities`, `list.brief.name`, and `list.brief.summary` before running. The script is idempotent — running it twice does not duplicate rows.

## After writing

1. `cat .constructive/feature_list.json` to confirm the new rows landed (you should see 6 setup features + one per entity).
2. Tell the user: "Brief saved. Next feature: `db-setup` (Postgres + GraphQL boot)."
3. Hand back to [build-orchestrator.md](build-orchestrator.md). The router will pick `db-setup` since all its deps (none) are done.

## What you must NOT do

- Do NOT invent entities the user didn't ask for.
- Do NOT name a database table `users` (`NAMING-001`) — Constructive provisions it. A `user-crud-ui` feature is fine because it operates on that platform table; a new `users` table is not.
- Do NOT touch `feature_list.json` if writing `BRIEF.md` failed — fix the brief write first.
- Do NOT begin code work in this skill. After the two writes, your job is done.
- In the FALLBACK (interactive) path, do NOT skip the confirmation question — the brief is the source of truth for every later feature, so a vague answer cascades into bad schemas (`APP-BRIEF-001`). In autonomous-inference mode this does not apply: you state assumptions and proceed without waiting.
