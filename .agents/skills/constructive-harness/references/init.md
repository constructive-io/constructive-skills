# Harness Init

You're loaded because `.constructive/` is missing in the current project. Your only job: lay down the harness skeleton and hand control back to the orchestrator.

## Before you start

- `pwd` to confirm the working directory.
- Verify `.constructive/` really is absent: `[ -d .constructive ] && echo EXISTS || echo MISSING`. If `EXISTS`, you were routed here in error — re-run the [build-orchestrator.md](build-orchestrator.md) decision tree.

## Steps

1. **Create the harness directory:**

   ```bash
   mkdir -p .constructive
   ```

2. **Copy the harness templates verbatim.** The harness host materializes them and substitutes the real path below at load time:

   ```
   {{HARNESS_TEMPLATES_DIR}}
   ```

   Only `AGENTS.md` belongs at the project root. Everything else lives in `.constructive/`.

   ```bash
   TEMPLATES_DIR="{{HARNESS_TEMPLATES_DIR}}"
   cp "$TEMPLATES_DIR/AGENTS.md" ./AGENTS.md
   for f in init.sh verify-feature.sh feature_list.json feature-list.schema.json BRIEF.md progress.md session-handoff.md; do
     cp "$TEMPLATES_DIR/$f" ".constructive/$f"
   done
   ```

3. **Make the two shell scripts executable.** `cp` usually preserves source perms, but bake it in:

   ```bash
   chmod +x .constructive/init.sh .constructive/verify-feature.sh
   ```

4. **Run the preflight + state echo:**

   ```bash
   ./.constructive/init.sh
   ```

   It warns on missing `pnpm` / `psql` (optional), then prints the current `feature_list.json` summary (brief + features-done counter + next pending feature).

5. **Hand back to the orchestrator.** Re-run the [build-orchestrator.md](build-orchestrator.md) decision tree. The next step is almost certainly:
   - [brief-intake.md](brief-intake.md) (since `BRIEF.md` is still the template stub), or
   - the first feature in `feature_list.json` if a brief was somehow pre-seeded.

## Layout invariants (locked — do not improvise)

- Only `AGENTS.md` at the project root.
- All other harness files under `.constructive/`.
- `init.sh` and `verify-feature.sh` must be executable.

## What you must NOT do

- Do NOT edit the templates while copying. Copy them verbatim — the agents that run later expect the bundled shapes.
- Do NOT skip `chmod +x`.
- Do NOT start feature work. Bootstrap + handoff is the whole job.
- Do NOT re-run if `.constructive/` already exists — bail and re-route via the orchestrator.
