# Error Handling

Comprehensive guide to handling errors with generated code.

## Discriminated Unions

The ORM returns discriminated union results for type-safe error handling:

```typescript
interface SuccessResult<T> {
  ok: true;
  value: T;
}

interface ErrorResult {
  ok: false;
  error: {
    type: 'graphql' | 'network' | 'validation';
    message: string;
    // Additional fields based on type
  };
}

type Result<T> = SuccessResult<T> | ErrorResult;
```

### Basic Pattern

```typescript
const result = await db.user.findOne({ id: '123' }).execute();

if (result.ok) {
  // TypeScript knows result.value exists and is typed
  console.log(result.value.name);
} else {
  // TypeScript knows result.error exists
  console.error(result.error.message);
}
```

### Exhaustive Handling

```typescript
const result = await db.user.findOne({ id }).execute();

if (!result.ok) {
  switch (result.error.type) {
    case 'graphql':
      // GraphQL execution error (invalid query, resolver error)
      console.error('GraphQL error:', result.error.message);
      break;
    case 'network':
      // Network failure (timeout, connection refused)
      console.error('Network error:', result.error.message);
      break;
    case 'validation':
      // Input validation error
      console.error('Validation error:', result.error.message);
      break;
  }
  return null;
}

return result.value;
```

## Helper Methods

### `.unwrap()`

Throws on error, returns value on success:

```typescript
try {
  const user = await db.user.findOne({ id }).execute().unwrap();
  // user is typed, no null check needed
  console.log(user.name);
} catch (error) {
  // Error thrown with message from result.error
  console.error('Failed:', error.message);
}
```

Use when:
- Errors should propagate up
- In try/catch blocks
- When error is truly exceptional

### `.unwrapOr(defaultValue)`

Returns default value on error:

```typescript
const user = await db.user.findOne({ id }).execute()
  .unwrapOr({ id: '', name: 'Unknown User', email: '' });

// user is always defined, uses default if fetch failed
console.log(user.name);
```

Use when:
- You have a sensible default
- UI should show placeholder on error
- Operation is non-critical

### `.unwrapOrElse(callback)`

Calls callback on error:

```typescript
const user = await db.user.findOne({ id }).execute()
  .unwrapOrElse((error) => {
    // Log error, report to monitoring
    logger.error('Failed to fetch user', { id, error });
    Sentry.captureException(error);

    // Return fallback
    return { id, name: 'Error loading user', email: '' };
  });
```

Use when:
- Need to log/report errors
- Want custom fallback logic
- Need access to error details

## React Query Error Handling

### Query Errors

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data, error, isError, refetch } = useUserQuery(
    { id: userId },
    {
      retry: (failureCount, error) => {
        // Don't retry on 404
        if (error.message.includes('not found')) return false;
        return failureCount < 3;
      },
      onError: (error) => {
        toast.error(`Failed to load user: ${error.message}`);
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
        input: {
          name: data.get('name') as string,
          email: data.get('email') as string,
        },
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
    if (result.error.type === 'graphql') {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }

  return NextResponse.json(result.value);
}
```

### Server Actions

```typescript
// app/actions/user.ts
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
    // Return error to client
    return { success: false, error: result.error.message };
  }

  // Revalidate cached data
  revalidatePath(`/users/${id}`);

  return { success: true, user: result.value };
}

// Usage in client component
const result = await updateUser(userId, { name: newName });
if (!result.success) {
  toast.error(result.error);
} else {
  toast.success('Updated!');
}
```

## Logging and Monitoring

### Structured Logging

```typescript
import pino from 'pino';

const logger = pino();

async function fetchUser(id: string) {
  const db = getDb();
  const result = await db.user.findOne({ id }).execute();

  if (!result.ok) {
    logger.error({
      operation: 'fetchUser',
      userId: id,
      errorType: result.error.type,
      errorMessage: result.error.message,
    }, 'Failed to fetch user');

    return null;
  }

  logger.info({ operation: 'fetchUser', userId: id }, 'User fetched');
  return result.value;
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
    Sentry.captureException(new Error(result.error.message), {
      tags: {
        errorType: result.error.type,
        operation: 'payment.create',
      },
      extra: {
        errorDetails: result.error,
      },
    });

    throw new Error('Payment failed');
  }

  return result.value;
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
