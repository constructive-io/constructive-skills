# Working with Relations

Guide to querying and mutating related data using generated code.

## Relation Types

### BelongsTo (Many-to-One)

A record references a single parent record.

```
Post -> Author (User)
Comment -> Post
Order -> Customer
```

### HasMany (One-to-Many)

A record has multiple child records.

```
User -> Posts
Post -> Comments
Category -> Products
```

### ManyToMany

Records on both sides can have multiple related records.

```
Post <-> Tags
User <-> Roles
Product <-> Categories
```

## Querying Relations

### BelongsTo Relations

Fetch the related parent record:

```typescript
// ORM
const posts = await db.post.findMany({
  select: {
    id: true,
    title: true,
    author: {
      select: { id: true, name: true, avatar: true },
    },
  },
}).execute().unwrap();

// Access
posts.forEach(post => {
  console.log(`${post.title} by ${post.author.name}`);
});
```

```typescript
// React Query Hook
const { data } = usePostsQuery({});

// The hook returns the full relation if schema includes it
data?.posts?.nodes.forEach(post => {
  console.log(`${post.title} by ${post.author?.name}`);
});
```

### HasMany Relations

Fetch child records as a collection:

```typescript
// ORM
const users = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true, publishedAt: true },
      filter: { published: { eq: true } },
      orderBy: { publishedAt: 'DESC' },
      first: 5, // Limit to 5 posts
    },
  },
}).execute().unwrap();

// Access
users.forEach(user => {
  console.log(`${user.name} has ${user.posts.length} recent posts`);
  user.posts.forEach(post => {
    console.log(`  - ${post.title}`);
  });
});
```

### ManyToMany Relations

Same pattern as HasMany:

```typescript
// ORM
const posts = await db.post.findMany({
  select: {
    id: true,
    title: true,
    tags: {
      select: { id: true, name: true, color: true },
    },
  },
}).execute().unwrap();

// Access
posts.forEach(post => {
  const tagNames = post.tags.map(t => t.name).join(', ');
  console.log(`${post.title} [${tagNames}]`);
});
```

## Nested Relations

Go multiple levels deep:

```typescript
const users = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: {
        id: true,
        title: true,
        comments: {
          select: {
            id: true,
            body: true,
            author: {
              select: { id: true, name: true },
            },
          },
          first: 3,
        },
      },
      first: 5,
    },
  },
}).execute().unwrap();

// Access deeply nested data
users.forEach(user => {
  user.posts.forEach(post => {
    post.comments.forEach(comment => {
      console.log(`${comment.author.name}: ${comment.body}`);
    });
  });
});
```

## Filtering on Relations

### Filter by Related Record

```typescript
// Find posts by a specific author
const posts = await db.post.findMany({
  select: { id: true, title: true },
  filter: {
    authorId: { eq: 'user-123' },
  },
}).execute();
```

### Filter Related Records

```typescript
// Get users with only their published posts
const users = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true },
      filter: {
        AND: [
          { published: { eq: true } },
          { publishedAt: { gte: '2024-01-01' } },
        ],
      },
    },
  },
}).execute();
```

### Filter Parent by Child Conditions

```typescript
// Find users who have at least one published post
// Note: This depends on your GraphQL schema supporting such filters
const users = await db.user.findMany({
  select: { id: true, name: true },
  filter: {
    posts: {
      some: { published: { eq: true } },
    },
  },
}).execute();
```

## Ordering Relations

```typescript
const users = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true, publishedAt: true },
      orderBy: { publishedAt: 'DESC' }, // Most recent first
    },
    comments: {
      select: { id: true, body: true, createdAt: true },
      orderBy: { createdAt: 'ASC' }, // Oldest first
    },
  },
}).execute();
```

## Pagination on Relations

```typescript
// Get first page of posts for a user
const user = await db.user.findOne({
  id: userId,
  select: {
    id: true,
    name: true,
    posts: {
      select: {
        id: true,
        title: true,
      },
      first: 10,
      offset: 0, // Page 1
    },
  },
}).execute();

// Get second page
const userPage2 = await db.user.findOne({
  id: userId,
  select: {
    id: true,
    posts: {
      select: { id: true, title: true },
      first: 10,
      offset: 10, // Page 2
    },
  },
}).execute();
```

## React Query Patterns

### Loading Relations Separately

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data: user } = useUserQuery({ id: userId });
  const { data: posts } = usePostsQuery(
    {
      filter: { authorId: { eq: userId } },
      first: 10,
    },
    { enabled: !!userId }
  );

  return (
    <div>
      <h1>{user?.user?.name}</h1>
      <PostList posts={posts?.posts?.nodes ?? []} />
    </div>
  );
}
```

### Prefetching Relations

```typescript
function UserCard({ user }: { user: User }) {
  const queryClient = useQueryClient();

  const prefetchPosts = () => {
    queryClient.prefetchQuery({
      queryKey: ['posts', { authorId: user.id }],
      queryFn: () => fetchUserPosts(user.id),
    });
  };

  return (
    <div onMouseEnter={prefetchPosts}>
      <Link href={`/users/${user.id}`}>
        {user.name}
      </Link>
    </div>
  );
}
```

## Common Patterns

### Author with Post Count

```typescript
const authors = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true }, // Just need IDs for count
    },
  },
}).execute().unwrap();

const authorsWithCounts = authors.map(author => ({
  ...author,
  postCount: author.posts.length,
}));
```

### Posts with Comment Count and Latest Comment

```typescript
const posts = await db.post.findMany({
  select: {
    id: true,
    title: true,
    comments: {
      select: { id: true, body: true, createdAt: true },
      orderBy: { createdAt: 'DESC' },
    },
  },
}).execute().unwrap();

const postsWithStats = posts.map(post => ({
  id: post.id,
  title: post.title,
  commentCount: post.comments.length,
  latestComment: post.comments[0] ?? null,
}));
```

### User Feed with Mixed Content

```typescript
const user = await db.user.findOne({
  id: userId,
  select: {
    id: true,
    name: true,
    // Own posts
    posts: {
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'DESC' },
      first: 10,
    },
    // Comments made
    comments: {
      select: {
        id: true,
        body: true,
        createdAt: true,
        post: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'DESC' },
      first: 10,
    },
    // Favorites
    favorites: {
      select: {
        post: {
          select: { id: true, title: true, author: { select: { name: true } } },
        },
        createdAt: true,
      },
      orderBy: { createdAt: 'DESC' },
      first: 10,
    },
  },
}).execute().unwrap();
```

## Type Safety

The select determines the return type:

```typescript
// Only selecting id and name
const minimalUser = await db.user.findOne({
  id,
  select: { id: true, name: true },
}).execute().unwrap();

// minimalUser.email would be a TypeScript error

// Selecting with posts relation
const userWithPosts = await db.user.findOne({
  id,
  select: {
    id: true,
    name: true,
    posts: { select: { id: true, title: true } },
  },
}).execute().unwrap();

// userWithPosts.posts is typed as { id: string; title: string }[]
```
