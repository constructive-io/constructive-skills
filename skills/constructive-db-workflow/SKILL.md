---
name: constructive-db-workflow
description: Workflow for modifying database functions in constructive-db. Use when asked to modify authenticate functions, RLS functions, or any generated SQL in the constructive module. ANTI-PATTERN - DO NOT edit application/constructive directly.
compatibility: constructive-db repository
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive DB Workflow

This skill documents the correct workflow for modifying database functions in the constructive-db repository.

## CRITICAL ANTI-PATTERN

**DO NOT manually edit files in `application/constructive/`**

The `application/constructive/` directory is GENERATED code. Any manual edits will be overwritten when the generation scripts run. This is a common mistake that wastes time and creates confusion.

## Correct Workflow

When you need to modify database functions like `authenticate`, `authenticate_strict`, or other RLS/auth functions:

1. **Edit the source templates** in `packages/db-text/generate/templates/`
   - For authenticate functions: `packages/db-text/generate/templates/rls/authenticate.sql`
   - For authenticate_strict: `packages/db-text/generate/templates/rls/authenticate_strict.sql`

2. **Run the db-text generate script** to update the generated fixtures:
   ```bash
   cd packages/db-text
   pnpm run generate
   ```

3. **Run the constructive generation script** to regenerate `application/constructive/`:
   ```bash
   # From repo root
   pnpm run generate:constructive
   ```

4. **Verify the changes** by checking the generated files in `application/constructive/`

## Directory Structure

```
constructive-db/
  packages/
    db-text/
      generate/
        templates/           # SOURCE OF TRUTH - edit these
          rls/
            authenticate.sql
            authenticate_strict.sql
          ...
    introspection/
      scripts/
        generate_constructive.ts  # Generates application/constructive
  application/
    constructive/            # GENERATED - DO NOT EDIT DIRECTLY
      deploy/
      revert/
      verify/
```

## Template Syntax

Templates in `db-text` use special directives:

- `-- deploys: <type> <arg1> <arg2>` - Declares what the template deploys
- `-- replace: <find> <replace> <type>` - Variable substitutions (I=identifier, s=string)
- `-- requires: <type> <args>` - Dependencies
- `-- revert:` - Marks start of revert section

## Example: Modifying authenticate function

If you need to change the authenticate function to query a different table:

1. Edit `packages/db-text/generate/templates/rls/authenticate.sql`
2. Update the SQL query and any `-- requires:` directives
3. Run `pnpm run generate` in `packages/db-text`
4. Run `pnpm run generate:constructive` from repo root
5. Commit both the template changes AND the regenerated files

## AST-based Functions

Some functions are generated using AST (Abstract Syntax Tree) in `packages/ast-plpgsql/`:
- `packages/ast-plpgsql/deploy/schemas/ast_plpgsql_helpers/procedures/rls/authenticate.sql`

These use PostgreSQL AST builders to generate SQL programmatically.

## Docker Image Requirement

The generation scripts require PostgreSQL 17. Use:
```bash
pgpm docker start --image pyramation/postgres:17 --recreate
```

## References

- `packages/db-text/README.md` - Full template syntax documentation
- `packages/introspection/scripts/generate_constructive.ts` - Generation script
- Related skill: `pgpm-changes` - For general pgpm migration authoring
