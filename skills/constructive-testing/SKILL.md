---
name: constructive-testing
description: "Database and integration testing for Constructive — pgsql-test for PostgreSQL integration tests (RLS policies, seeding, exceptions, snapshots, JWT context), Drizzle ORM testing with drizzle-orm-test, Supabase application testing with supabase-test, Drizzle ORM schema design patterns, and pgsql-parser round-trip testing. Use when asked to test RLS, test permissions, seed test data, snapshot test, test database, write integration tests, test user access, test Drizzle ORM, test Supabase, or validate SQL round-trips."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Testing

Consolidated testing skill covering PostgreSQL integration tests, Drizzle ORM testing, Supabase application testing, and pgsql-parser validation.

## pgsql-test -- PostgreSQL Integration Testing

- Complete testing toolkit for PostgreSQL with RLS policy verification, test seeding (loadJson, loadSql, loadCsv), snapshot utilities, and JWT context simulation
- Two-client pattern: `pg` (superuser, bypasses RLS) and `db` (app-level, enforces RLS) with savepoint-based transaction isolation
- Includes reusable test helpers, constants, assertion utilities, and complex multi-client scenario management
- Detailed sub-references for RLS, seeding, exceptions, snapshots, helpers, JWT context, and scenario setup

**Triggers:** "test RLS", "test permissions", "seed test data", "snapshot test", "test database", "write integration tests", "test user access", "handle aborted transactions"

See [pgsql-test.md](./references/pgsql-test.md) for details.

Sub-references:
- [pgsql-test-rls.md](./references/pgsql-test-rls.md) -- RLS policy testing (SELECT/INSERT/UPDATE/DELETE, multi-user isolation)
- [pgsql-test-seeding.md](./references/pgsql-test-seeding.md) -- Seeding with loadJson, loadSql, loadCsv
- [pgsql-test-exceptions.md](./references/pgsql-test-exceptions.md) -- Savepoint pattern for aborted transactions
- [pgsql-test-snapshot.md](./references/pgsql-test-snapshot.md) -- Snapshot utilities (pruneIds, pruneDates, IdHash)
- [pgsql-test-helpers.md](./references/pgsql-test-helpers.md) -- Reusable test helpers and constants
- [pgsql-test-jwt-context.md](./references/pgsql-test-jwt-context.md) -- JWT claims, setContext API, auth() helper
- [pgsql-test-scenario-setup.md](./references/pgsql-test-scenario-setup.md) -- Complex scenarios, publish(), per-describe setup

## drizzle-orm-test -- Drizzle ORM Testing

- Drop-in replacement for pgsql-test that adds type-safe Drizzle ORM queries with automatic context management
- Three-client pattern: `pg` (superuser), `db` (RLS context), and `drizzleDb` (type-safe Drizzle client)
- RLS testing with Drizzle: set context via pgsql-test, query via Drizzle for type-safe assertions
- Savepoint pattern for testing expected failures (permission denied, RLS violations)

**Triggers:** "test with Drizzle", "test Drizzle ORM", "write type-safe database tests"

See [drizzle-test.md](./references/drizzle-test.md) for details.

## supabase-test -- Supabase Application Testing

- TypeScript-native testing for Supabase with ephemeral databases and multi-user RLS simulation
- `insertUser()` helper for creating users in `auth.users`; Supabase role simulation (anon, authenticated, service_role)
- Same two-client pattern and test isolation as pgsql-test, with Supabase-specific role names
- Supports loadJson, loadSql, loadCsv seeding and savepoint pattern for permission testing

**Triggers:** "test Supabase", "test RLS with Supabase", "write Supabase tests"

See [supabase-test.md](./references/supabase-test.md) for details.

## drizzle-orm -- Drizzle ORM Schema Design Patterns

- PostgreSQL schema design with Drizzle: tables, foreign keys, indexes, composite keys, enums, JSON columns
- Query patterns: select, insert, update, delete, joins, relational queries, aggregations, transactions
- Schema organization for larger projects and integration with pgsql-test

**Triggers:** "design Drizzle schema", "write Drizzle queries", "set up Drizzle ORM"

See [drizzle-orm.md](./references/drizzle-orm.md) for details.

## pgsql-parser -- SQL Parser Round-Trip Testing

- Testing workflow for the pgsql-parser monorepo (parser, deparser, PL/pgSQL, types, utils)
- AST-level equality validation: `parse -> deparse -> parse` round-trip correctness, not string equality
- Test utilities: `expectAstMatch` (deparser) and `expectPGParse` (AST package) for validation

**Triggers:** "pgsql-parser", "fix deparser", "validate SQL round-trips", "parser tests"

See [pgsql-parser.md](./references/pgsql-parser.md) for details.
