# Error Handling

The generated ORM returns a precise `QueryResult` from `.execute()` and exposes error helpers directly on each `QueryBuilder`.

## `execute()` Result Contract

For a GraphQL error or a non-successful HTTP response, `.execute()` resolves to the failure branch instead of throwing. A rejected fetch or response-decoding failure can still reject the promise, so code that must handle both classes needs an `ok` check and a `try/catch` boundary.

```typescript
try {
  const result = await db.user.findMany({ select: { id: true } }).execute();

  if (!result.ok) {
    console.error(result.errors.map((error) => error.message).join('; '));
    return [];
  }

  return result.data.users.nodes;
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'The request failed');
  return [];
}
```

Use `.unwrap()` when a failed result should become an exception:

```typescript
const result = await db.user.findMany({ select: { id: true } }).unwrap();
const users = result.users.nodes;
```

## Discriminated Union

The current generated contract is:

```typescript
interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

type QueryResult<T> =
  | { ok: true; data: T; errors: undefined }
  | { ok: false; data: null; errors: GraphQLError[] };
```

The failure branch does not define a synthetic `graphql`, `network`, or `validation` discriminator. Inspect a server-provided `extensions` object only when that endpoint documents its shape.

```typescript
const result = await db.user.findOne({
  id: '123',
  select: { id: true, name: true },
}).execute();

if (result.ok) {
  console.log(result.data.user?.name);
} else {
  for (const error of result.errors) {
    console.error(error.message);
  }
}
```

## Helper Methods

### `.unwrap()`

`.unwrap()` executes the builder and returns its typed data. A failed `QueryResult` becomes `GraphQLRequestError`; transport rejections continue to propagate.

```typescript
try {
  const result = await db.user.findOne({
    id,
    select: { id: true, name: true },
  }).unwrap();
  console.log(result.user?.name);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Failed to fetch user');
}
```

### `.unwrapOr(defaultValue)`

`.unwrapOr()` returns the supplied value for a failed `QueryResult`:

```typescript
const result = await db.user
  .findOne({ id, select: { id: true, name: true, email: true } })
  .unwrapOr({
    user: { id: '', name: 'Unknown User', email: '' },
  });

console.log(result.user?.name);
```

It does not convert a rejected fetch into the default value.

### `.unwrapOrElse(callback)`

`.unwrapOrElse()` passes the complete `GraphQLError[]` to the callback:

```typescript
const result = await db.user.findOne({
  id,
  select: { id: true, name: true, email: true },
}).unwrapOrElse((errors) => {
  logger.error({ userId: id, errors }, 'Failed to fetch user');
  return {
    user: { id, name: 'Error loading user', email: '' },
  };
});
```

Use it when a failed result needs logging or a computed fallback. Transport rejections still propagate.

## React Query Error Handling

### Query Errors

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data, error, isError, refetch } = useUserQuery(
    {
      id: userId,
      selection: { fields: { id: true, name: true } },
      retry: (failureCount, error) => {
        if (error.message.includes('not found')) return false;
        return failureCount < 3;
      },
    }
  );

  React.useEffect(() => {
    if (error) toast.error(`Failed to load user: ${error.message}`);
  }, [error]);

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
    selection: { fields: { id: true, name: true, email: true } },
    onError: (error) => {
      // Handle specific error types
      if (error.message.includes('duplicate')) {
        toast.error('Email already in use');
      } else if (error.message.includes('validation')) {
        toast.error('Please check your input');
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
        name: data.get('name') as string,
        email: data.get('email') as string,
      });
    } catch (error) {
      // Error already handled by onError
      // But can do additional handling here
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Show inline error */}
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
// src/components/ErrorBoundary.tsx
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

export function QueryErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ReactErrorBoundary
          onReset={reset}
          FallbackComponent={ErrorFallback}
        >
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
import { createRequestDomainClient } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const db = await createRequestDomainClient(request);
  const result = await db.user.findOne({
    id: params.id,
    select: { id: true, name: true, email: true },
  }).execute();

  if (!result.ok) {
    console.error(result.errors);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }

  return NextResponse.json(result.data.user);
}
```

### Server Actions

```typescript
// app/actions/user.ts
'use server';

import { createRequestDomainClient } from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function updateUser(id: string, data: { name: string }) {
  const db = await createRequestDomainClient();
  const result = await db.user.update({
    where: { id },
    data: { name: data.name },
    select: { id: true, name: true },
  }).execute();

  if (!result.ok) {
    console.error(result.errors);
    return { success: false, error: 'The user could not be updated.' };
  }

  // Revalidate cached data
  revalidatePath(`/users/${id}`);

  return { success: true, user: result.data.updateUser.user };
}

// Usage in client component
const actionResult = await updateUser(userId, { name: newName });
if (!actionResult.success) {
  toast.error(actionResult.error);
} else {
  toast.success('Updated!');
}
```

## Logging and Monitoring

### Structured Logging

```typescript
import pino from 'pino';

const logger = pino();

async function fetchUser(db: DomainClient, id: string) {
  const result = await db.user.findOne({
    id,
    select: { id: true, name: true, email: true },
  }).execute();

  if (!result.ok) {
    logger.error({
      operation: 'fetchUser',
      userId: id,
      errors: result.errors,
    }, 'Failed to fetch user');

    return null;
  }

  logger.info({ operation: 'fetchUser', userId: id }, 'User fetched');
  return result.data.user;
}
```

### Error Reporting

```typescript
import * as Sentry from '@sentry/nextjs';

async function criticalOperation() {
  const result = await db.payment.create({
    data: { amount: 100, userId: '123' },
    select: { id: true, amount: true },
  }).execute();

  if (!result.ok) {
    const message = result.errors.map((error) => error.message).join('; ');
    Sentry.captureException(new Error(message), {
      tags: {
        operation: 'payment.create',
      },
      extra: {
        errors: result.errors,
      },
    });

    throw new Error('Payment failed');
  }

  return result.data.createPayment.payment;
}
```

## Best Practices

1. **Always handle errors explicitly** - Don't ignore the `ok` check
2. **Use appropriate helper** - `.unwrap()` for exceptional errors, `.unwrapOr()` for graceful degradation
3. **Log errors with context** - Include operation name, IDs, and error details
4. **Show user-friendly messages** - Don't expose raw error messages in UI
5. **Report to monitoring** - Send errors to Sentry/DataDog for tracking
6. **Retry transient failures** - Network errors may succeed on retry
7. **Validate before operations** - Catch validation errors early
