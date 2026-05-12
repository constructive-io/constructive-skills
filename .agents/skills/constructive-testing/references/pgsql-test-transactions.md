---
name: pgsql-test-transactions
description: Transaction-local context, the beforeAll gotcha, and the three PostgreSQL roles (superuser/administrator/authenticated). Use when debugging "context lost" errors, getting RLS failures in beforeAll, or choosing between pg and db for test operations.
---

# Transaction-Local Context & Role Patterns

## The `set_config(..., true)` Contract

`pgsql-test`'s `setContext()` uses `set_config('key', 'value', true)` internally. The third parameter `true` makes the setting **transaction-local** — it only persists within the current transaction.

This works transparently inside test bodies (`it()` blocks) because `beforeEach()` calls `db.begin()` + `db.savepoint()`, creating an active transaction. But in `beforeAll()`, there is no active transaction by default.

## The `beforeAll` Gotcha

**Symptom:** You call `setContext()` and then a query, but the query runs without any JWT context — leading to RLS violations, NULL `current_user_id()`, or `STORAGE_MODULE_NOT_FOUND`.

**Root cause:** Without an active transaction, each `db.query()` runs in auto-commit mode. The `ctxQuery()` call (which executes `set_config`) runs in one implicit transaction that immediately commits, and the actual query runs in a separate implicit transaction where the context no longer exists.

**Fix — wrap `beforeAll` operations in explicit transactions:**

```typescript
beforeAll(async () => {
  ({ db, pg, teardown } = await getConnections());

  // pg operations auto-commit — no transaction needed
  await createTestUser(pg, ADMIN_ID);
  const db_owner = await provisionDatabase(pg, { ... });

  // db operations NEED an explicit transaction for context to persist
  await db.begin();
  db.setContext({ role: 'administrator' });
  await addOrgMember(db, { actor_id: ALICE_ID, entity_id: org_id });
  await db.commit();
});
```

**Without `db.begin()`:**
```typescript
// WRONG — context lost between queries in auto-commit mode
db.setContext({ role: 'administrator' });
await addOrgMember(db, { ... });  // ERROR: no context
```

## The Three PostgreSQL Roles

| Role | Client | Bypasses RLS? | Fires Triggers? | When to use |
|------|--------|---------------|-----------------|-------------|
| **superuser** | `pg` | Yes | Yes | Bootstrap only: user creation, database provisioning, DDL, catalog reads |
| **administrator** | `db` + `setContext({ role: 'administrator' })` | Effectively yes (via `GRANT ALL`) | Yes | Elevated data ops in `beforeAll`: adding members, creating entities, granting permissions |
| **authenticated** | `db` + `setContext({ role: 'authenticated', ... })` | No (full RLS) | Yes | All test queries — this is what real users experience |

### Why Administrator Instead of Superuser for Data Operations

The `administrator` role has `GRANT ALL` via `ALTER DEFAULT PRIVILEGES`, so it can INSERT/UPDATE/DELETE on any table. But unlike the superuser (`pg`), it still **executes triggers** and **respects FK constraints**.

This matters for integration testing because:
- Membership INSERT triggers fire → SPRT entries are populated automatically
- FK constraints are validated → catches orphaned references
- The test exercises the real code path, not a bypass

```typescript
// WRONG — bypasses triggers, SPRT not populated
await pg.query(`INSERT INTO memberships (...) VALUES (...)`);

// CORRECT — triggers fire, SPRT populated
db.setContext({ role: 'administrator' });
await addOrgMember(db, { actor_id: ALICE_ID, entity_id: org_id });
```

### Switching Roles Mid-Test

```typescript
it('admin adds member, user verifies access', async () => {
  // Elevated operation
  db.setContext({ role: 'administrator' });
  await someAdminOp(db, { ... });

  // Switch to user
  db.setContext({ role: 'authenticated', 'jwt.claims.user_id': ALICE_ID });
  const rows = await db.any('SELECT * FROM ...');
  expect(rows.length).toBeGreaterThan(0);
});
```

## `pg` vs `db` Quick Reference

| Operation | Use `pg`? | Use `db`? | Notes |
|-----------|-----------|-----------|-------|
| `createTestUser()` | ✓ | | Bootstrap — needs superuser |
| `provisionDatabase()` | ✓ | | DDL — creates schemas/tables |
| `entity_type_provision` | ✓ | | DDL via SECURITY DEFINER triggers |
| Metaschema catalog queries | ✓ | | Read-only, no RLS concern |
| `addOrgMember()` | | ✓ (administrator) | Triggers must fire for SPRT |
| `addEntityMember()` | | ✓ (administrator) | Triggers must fire for SPRT |
| Create files/buckets | | ✓ (administrator) | Data operations |
| Grant permissions | | ✓ (administrator) | Data operations |
| Test queries | | ✓ (authenticated) | RLS must be enforced |

## Common Pitfalls

### 1. Forgetting `db.begin()` in `beforeAll`
Context is transaction-local. Without `begin()`, `setContext()` has no effect on subsequent queries.

### 2. Missing membership defaults for personal orgs
The `org_mbr_create` trigger only creates `org_membership_defaults` for non-personal orgs. Use UPSERT:
```typescript
await pg.query(
  `INSERT INTO constructive_memberships_public.org_membership_defaults
     (entity_id, is_approved) VALUES ($2, $1)
   ON CONFLICT (entity_id) DO UPDATE SET is_approved = EXCLUDED.is_approved`,
  [true, entity_id]
);
```

### 3. Cross-connection deadlock
Never mix `pg` and `db` in the same test body. Both have separate transactions — data locked by one blocks the other. Use `db` with `administrator` role for in-test seeding instead.
