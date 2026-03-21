# Query Key Factory Reference

The generated React Query hooks include a centralized query key factory for type-safe cache management, following the [lukemorales/query-key-factory](https://tanstack.com/query/docs/framework/react/community/lukemorales-query-key-factory) pattern.

## Generated Files

| File | Purpose |
|------|---------|
| `query-keys.ts` | Query key factories for all entities |
| `mutation-keys.ts` | Mutation key factories for tracking in-flight mutations |
| `invalidation.ts` | Type-safe cache invalidation helpers |

## Query Key Structure

Each entity gets a query key factory with hierarchical structure:

```typescript
import { userKeys } from './generated/hooks';

// Root key for all user queries
userKeys.all;              // ['user']

// List queries
userKeys.lists();          // ['user', 'list']
userKeys.list({ first: 10 }); // ['user', 'list', { first: 10 }]

// Detail queries
userKeys.details();        // ['user', 'detail']
userKeys.detail('user-123'); // ['user', 'detail', 'user-123']
```

## Using Query Keys

### Manual Cache Invalidation

```typescript
import { userKeys } from './generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

function MyComponent() {
  const queryClient = useQueryClient();

  const handleUpdate = () => {
    // Invalidate ALL user queries
    queryClient.invalidateQueries({ queryKey: userKeys.all });

    // Invalidate only list queries
    queryClient.invalidateQueries({ queryKey: userKeys.lists() });

    // Invalidate a specific user
    queryClient.invalidateQueries({ queryKey: userKeys.detail(userId) });
  };
}
```

### Invalidation Helpers

Type-safe invalidation utilities are generated:

```typescript
import { invalidate, remove } from './generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Invalidate queries (triggers refetch)
invalidate.user.all(queryClient);        // All user queries
invalidate.user.lists(queryClient);      // All list queries
invalidate.user.detail(queryClient, id); // Specific user

// Remove from cache (for delete operations)
remove.user(queryClient, userId);
```

### Mutation Callbacks

Use invalidation helpers in mutation callbacks:

```typescript
import { useCreateUserMutation, invalidate } from './generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

function CreateUserForm() {
  const queryClient = useQueryClient();
  
  const createUser = useCreateUserMutation({
    onSuccess: () => {
      // Invalidate all user list queries to refetch
      invalidate.user.lists(queryClient);
    },
  });

  return (
    <button onClick={() => createUser.mutate({ input: { name: 'John' } })}>
      Create User
    </button>
  );
}
```

## Mutation Keys

Track in-flight mutations with mutation keys:

```typescript
import { userMutationKeys } from './generated/hooks';
import { useIsMutating } from '@tanstack/react-query';

function UserList() {
  // Check if any user mutations are in progress
  const isMutating = useIsMutating({ mutationKey: userMutationKeys.all });

  // Check if a specific user is being created
  const isCreating = useIsMutating({ mutationKey: userMutationKeys.create });

  // Check if a specific user is being deleted
  const isDeleting = useIsMutating({ 
    mutationKey: userMutationKeys.delete(userId) 
  });

  return (
    <div>
      {isMutating > 0 && <Spinner />}
      <button disabled={isDeleting > 0}>Delete</button>
    </div>
  );
}
```

### Mutation Key Structure

```typescript
userMutationKeys.all;           // ['user', 'mutation']
userMutationKeys.create;        // ['user', 'mutation', 'create']
userMutationKeys.update(id);    // ['user', 'mutation', 'update', id]
userMutationKeys.delete(id);    // ['user', 'mutation', 'delete', id]
```

## Optimistic Updates

Combine query keys with optimistic updates:

```typescript
import { useCreateUserMutation, userKeys } from './generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

function CreateUser() {
  const queryClient = useQueryClient();

  const createUser = useCreateUserMutation({
    onMutate: async (newUser) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: userKeys.lists() });

      // Snapshot previous value
      const previous = queryClient.getQueryData(userKeys.list());

      // Optimistically update cache
      queryClient.setQueryData(userKeys.list(), (old) => ({
        ...old,
        users: {
          ...old.users,
          nodes: [...old.users.nodes, { id: 'temp', ...newUser.input.user }],
        },
      }));

      return { previous };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      queryClient.setQueryData(userKeys.list(), context.previous);
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });

  return <button onClick={() => createUser.mutate({ input: { name: 'John' } })}>Create</button>;
}
```

## Prefetching

Use query keys for prefetching:

```typescript
import { userKeys } from './generated/hooks';
import { useQueryClient } from '@tanstack/react-query';

function UserListItem({ user }) {
  const queryClient = useQueryClient();

  const handleHover = () => {
    // Prefetch user details on hover
    queryClient.prefetchQuery({
      queryKey: userKeys.detail(user.id),
      queryFn: () => fetchUserDetails(user.id),
    });
  };

  return (
    <Link to={`/users/${user.id}`} onMouseEnter={handleHover}>
      {user.name}
    </Link>
  );
}
```

## Configuration

Query key generation is enabled by default. Configure in your config file:

```typescript
export default defineConfig({
  endpoint: 'https://api.example.com/graphql',
  
  queryKeys: {
    // Key structure style
    style: 'hierarchical',  // or 'flat'
    
    // Generate scope-aware keys
    generateScopedKeys: true,
    
    // Generate cascade invalidation helpers
    generateCascadeHelpers: true,
    
    // Generate mutation keys
    generateMutationKeys: true,
    
    // Define entity relationships for cascade invalidation
    relationships: {
      table: { parent: 'database', foreignKey: 'databaseId' },
      field: { parent: 'table', foreignKey: 'tableId' },
    },
  },
});
```

## Cascade Invalidation

When relationships are defined, cascade invalidation helpers are generated:

```typescript
import { invalidate } from './generated/hooks';

// Invalidate a database and all its tables
invalidate.database.cascade(queryClient, databaseId);

// Invalidate a table and all its fields
invalidate.table.cascade(queryClient, tableId);
```

This automatically invalidates:
1. The parent entity
2. All child entities
3. All ancestor entities (if defined)

## Best Practices

1. **Use invalidation helpers** instead of manual `invalidateQueries` for type safety
2. **Invalidate lists after mutations** to ensure fresh data
3. **Use mutation keys** to track in-flight operations and disable UI
4. **Prefer cascade invalidation** when working with hierarchical data
5. **Use optimistic updates** for better UX, but always handle rollback
6. **Prefetch on hover** for instant navigation
7. **Remove from cache** on delete operations instead of invalidating

## Example: Complete CRUD with Cache Management

```typescript
import {
  useUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  invalidate,
  remove,
  userMutationKeys,
} from './generated/hooks';
import { useQueryClient, useIsMutating } from '@tanstack/react-query';

function UserManagement() {
  const queryClient = useQueryClient();
  
  // Check if any mutations are in progress
  const isMutating = useIsMutating({ mutationKey: userMutationKeys.all });

  // Query
  const { data, isLoading } = useUsersQuery({ first: 10 });

  // Create
  const createUser = useCreateUserMutation({
    onSuccess: () => invalidate.user.lists(queryClient),
  });

  // Update
  const updateUser = useUpdateUserMutation({
    onSuccess: (data, variables) => {
      // Invalidate both the specific user and all lists
      invalidate.user.detail(queryClient, variables.input.id);
      invalidate.user.lists(queryClient);
    },
  });

  // Delete
  const deleteUser = useDeleteUserMutation({
    onSuccess: (data, variables) => {
      // Remove from cache and invalidate lists
      remove.user(queryClient, variables.input.id);
      invalidate.user.lists(queryClient);
    },
  });

  if (isLoading) return <Spinner />;

  return (
    <div>
      {isMutating > 0 && <GlobalSpinner />}
      
      <button onClick={() => createUser.mutate({ input: { name: 'New User' } })}>
        Create User
      </button>

      {data?.users.nodes.map(user => (
        <div key={user.id}>
          <span>{user.name}</span>
          <button onClick={() => updateUser.mutate({ 
            input: { id: user.id, patch: { name: 'Updated' } } 
          })}>
            Update
          </button>
          <button onClick={() => deleteUser.mutate({ input: { id: user.id } })}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
```
