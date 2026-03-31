# Error Handling

Comprehensive guide to handling errors with the generated ORM and hooks.

## CRITICAL: `execute()` Does NOT Throw

**The most common mistake** when using the Constructive ORM is wrapping `.execute()` in a bare `try/catch` and assuming errors will be caught. **They will not.**

`.execute()` returns a **discriminated union** `QueryResult<T>` — it **never throws an exception** on GraphQL or HTTP errors. Instead, it returns `{ ok: false, data: null, errors: [...] }`. A `try/catch` around `.execute()` will silently swallow errors because no exception is raised.

```typescript
// BUG: Silent error swallowing — errors are NEVER caught here
try {
  const result = await db.user.findMany({ select: { id: true } }).execute();
  // result may be { ok: false, data: null, errors: [...] }
  // but no exception is thrown, so the catch block is skipped entirely
  const users = result.data; // users is null — silent failure!
} catch (error) {
  // This NEVER runs for GraphQL/HTTP errors
  console.error(error);
}
```

### The Fix: Use `.unwrap()` or Check `.ok`

**Option A — `.unwrap()` (recommended for most cases):**
Converts the result pattern into throw-on-error, making `try/catch` work as expected:

```typescript
try {
  const users = await db.user.findMany({ select: { id: true } }).unwrap();
  // users is typed T — errors throw GraphQLRequestError
} catch (error) {
  // This RUNS on GraphQL/HTTP errors
  console.error('Failed:', error.message);
}
```

**Option B — Check `.ok` (recommended for control flow):**
Use the discriminated union directly for fine-grained error handling:

```typescript
const result = await db.user.findMany({ select: { id: true } }).execute();
if (!result.ok) {
  // result.errors is GraphQLError[] with message, locations, path
  console.error('Errors:', result.errors.map(e => e.message).join('; '));
  return [];
}
// result.data is typed T
return result.data;
```

## QueryResult Type

The actual type returned by `.execute()`:

```typescript
type QueryResult<T> =
  | { ok: true;  data: T;    errors: undefined }
  | { ok: false; data: null;  errors: GraphQLError[] };

interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}
```

Key points:
- On success: `ok` is `true`, `data` contains the typed result, `errors` is `undefined`
- On failure: `ok` is `false`, `data` is `null`, `errors` is a non-empty array
- HTTP errors (e.g. 500, 404) are also returned as `{ ok: false }` — NOT thrown

## Recommended Approach: `.unwrap()`

For most code, **`.unwrap()` is the preferred method**. It throws a `GraphQLRequestError` on failure and returns the typed data on success. This makes error propagation natural and prevents silent failures.

```typescript
// Simple and safe — errors propagate automatically
const users = await db.user.findMany({
  select: { id: true, name: true },
}).unwrap();
```

`.unwrap()` is a method on `QueryBuilder`, not on the result. Call it **instead of** `.execute()`:

```typescript
// These are equivalent:
const data = await db.user.findMany({...}).execute().then(r => { if (!r.ok) throw ...; return r.data; });
const data = await db.user.findMany({...}).unwrap(); // Much cleaner
```

The thrown `GraphQLRequestError` includes:
- `.message`: Joined error messages (e.g. `"GraphQL Error: permission denied; ..."`)
- `.errors`: The original `GraphQLError[]` array
- `.data`: The raw data (usually `null`)

## Helper Methods

All helper methods are on `QueryBuilder` and are alternatives to `.execute()`:

### `.unwrap()`

Throws `GraphQLRequestError` on error, returns typed data on success:

```typescript
try {
  const user = await db.user.findOne({ id, select: { id: true, name: true } }).unwrap();
  console.log(user.name);
} catch (error) {
  // GraphQLRequestError with .errors and .message
  console.error('Failed:', error.message);
}
```

Use when:
- Errors should propagate up the call stack
- You want `try/catch` to actually catch errors
- Error is truly exceptional (not expected control flow)

### `.unwrapOr(defaultValue)`

Returns default value on error instead of throwing:

```typescript
const user = await db.user.findOne({ id, select: { id: true, name: true } })
  .unwrapOr({ id: '', name: 'Unknown User' });

// user is always defined — uses default if query failed
console.log(user.name);
```

Use when:
- You have a sensible default
- UI should show placeholder on error
- Operation is non-critical

### `.unwrapOrElse(callback)`

Calls callback with `GraphQLError[]` on error:

```typescript
const user = await db.user.findOne({ id, select: { id: true, name: true } })
  .unwrapOrElse((errors) => {
    logger.error('Failed to fetch user', { id, errors });
    Sentry.captureException(new Error(errors[0]?.message));
    return { id, name: 'Error loading user' };
  });
```

Use when:
- Need to log/report errors with full details
- Want custom fallback logic
- Need access to the `GraphQLError[]` array

### `.execute()` with `.ok` check

Use when you need explicit control over both success and error paths:

```typescript
const result = await db.user.findOne({ id, select: { id: true, name: true } }).execute();

if (!result.ok) {
  // Handle error — result.errors is GraphQLError[]
  for (const err of result.errors) {
    console.error(err.message, err.path);
  }
  return null;
}

// result.data is typed
return result.data;
```

Use when:
- Different error types need different handling
- You want to inspect individual errors
- Control flow depends on error details

## Decision Matrix

| Scenario | Method | Why |
|----------|--------|-----|
| General queries and mutations | `.unwrap()` | Errors propagate, no silent failures |
| UI with fallback | `.unwrapOr(default)` | Always renders, graceful degradation |
| Error logging + fallback | `.unwrapOrElse(fn)` | Log/report then return fallback |
| Fine-grained error routing | `.execute()` + `.ok` | Inspect individual errors |
| Scripts / CLI tools | `.unwrap()` | Fail fast, clear error messages |

## React Query Error Handling

Generated React Query hooks automatically unwrap results internally, so standard React Query error handling works:

### Query Errors

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data, error, isError, refetch } = useUserQuery(
    { id: userId },
    {
      retry: (failureCount, error) => {
        if (error.message.includes('not found')) return false;
        return failureCount < 3;
      },
    }
  );

  if (isError) {
    return (
      <div className="error">
        <p>Error: {error.message}</p>
        <button onClick={() => refetch()}>Try Again</button>
      </div>
    );
  }

  // ...
}
```

### Mutation Errors

```typescript
function CreateUserForm() {
  const createUser = useCreateUserMutation({
    onError: (error) => {
      if (error.message.includes('duplicate')) {
        toast.error('Email already in use');
      } else {
        toast.error('Failed to create user');
      }
    },
    onSuccess: () => {
      toast.success('User created!');
    },
  });

  const handleSubmit = async (data: FormData) => {
    try {
      await createUser.mutateAsync({
        input: {
          name: data.get('name') as string,
          email: data.get('email') as string,
        },
      });
    } catch (error) {
      // Error already handled by onError callback
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {createUser.isError && (
        <div className="error">{createUser.error.message}</div>
      )}
      {/* ... */}
    </form>
  );
}
```

### Error Boundaries

```typescript
'use client';

import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';

function ErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: Error;
  resetErrorBoundary: () => void;
}) {
  return (
    <div className="error-fallback">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

export function QueryErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ReactErrorBoundary onReset={reset} FallbackComponent={ErrorFallback}>
          {children}
        </ReactErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
```

## Server-Side Error Handling

### Next.js API Routes

```typescript
// app/api/users/[id]/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  const result = await db.user.findOne({
    id: params.id,
    select: { id: true, name: true, email: true },
  }).execute();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.errors[0]?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }

  return NextResponse.json(result.data);
}
```

### Server Actions

```typescript
'use server';

import { getDb } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function updateUser(id: string, data: { name: string }) {
  const db = getDb();
  const result = await db.user.update({
    id,
    patch: { name: data.name },
  }).execute();

  if (!result.ok) {
    return { success: false, error: result.errors[0]?.message ?? 'Update failed' };
  }

  revalidatePath(`/users/${id}`);
  return { success: true, user: result.data };
}
```

## Logging and Monitoring

### Structured Logging

```typescript
import pino from 'pino';

const logger = pino();

async function fetchUser(id: string) {
  const db = getDb();
  const result = await db.user.findOne({ id, select: { id: true, name: true } }).execute();

  if (!result.ok) {
    logger.error({
      operation: 'fetchUser',
      userId: id,
      errors: result.errors.map(e => e.message),
    }, 'Failed to fetch user');
    return null;
  }

  return result.data;
}
```

### Error Reporting

```typescript
import * as Sentry from '@sentry/nextjs';

async function criticalOperation() {
  const result = await db.payment.create({
    input: { amount: 100, userId: '123' },
  }).execute();

  if (!result.ok) {
    Sentry.captureException(new Error(result.errors[0]?.message), {
      tags: { operation: 'payment.create' },
      extra: { errors: result.errors },
    });
    throw new Error('Payment failed');
  }

  return result.data;
}
```

## Best Practices

1. **Prefer `.unwrap()` by default** — prevents silent error swallowing, makes `try/catch` work
2. **Never use bare `.execute()` in `try/catch`** — errors are returned, not thrown
3. **Use `.execute()` + `.ok` check for control flow** — when you need to route on error type
4. **Use `.unwrapOr()` for non-critical UI** — graceful degradation with defaults
5. **Use `.unwrapOrElse()` for logging + fallback** — report errors then continue
6. **Log errors with context** — include operation name, IDs, and the `errors` array
7. **Report to monitoring** — send errors to Sentry/DataDog for tracking
