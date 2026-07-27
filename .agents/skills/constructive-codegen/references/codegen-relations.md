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

Records on both sides can have multiple related records, linked through a junction table.

```
Post <-> Tags        (junction: post_tags)
User <-> Roles       (junction: user_roles)
Product <-> Categories (junction: product_categories)
```

#### How M:N Relations Work

M:N relations require three database tables: two entity tables and a junction table that links them.

```sql
-- Entity tables
CREATE TABLE posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT);
CREATE TABLE tags  (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);

-- Junction table with composite primary key (no surrogate id)
CREATE TABLE post_tags (
  post_id UUID REFERENCES posts(id),
  tag_id  UUID REFERENCES tags(id),
  PRIMARY KEY (post_id, tag_id)
);
```

**Important:** Junction tables should use a composite primary key `(post_id, tag_id)` with no surrogate `id` column. This ensures:
- Natural uniqueness (no duplicate links)
- Efficient deletes by composite key
- PostGraphile generates `deletePostTagByPostIdAndTagId` instead of `deletePostTagById`

#### expose_in_api (relation_provision)

M:N relations are controlled by the `expose_in_api` boolean on the `metaschema_modules_public.relation_provision` table. When `true` (the default), PostGraphile exposes the M:N shortcut fields (e.g., `post.tags`) via `ManyToManyOptInPreset`. When `false`, only the raw junction table CRUD is available.

The `expose_in_api` flag is stored on `relation_provision` and synced to the junction table's `smart_tags` via database triggers. This is the single source of truth for whether an M:N relation appears in the GraphQL API.

```sql
-- Enable M:N shortcut for a relation (default)
UPDATE metaschema_modules_public.relation_provision
SET expose_in_api = true
WHERE out_junction_table_id = '<junction_table_id>';

-- Disable M:N shortcut (only raw junction CRUD available)
UPDATE metaschema_modules_public.relation_provision
SET expose_in_api = false
WHERE out_junction_table_id = '<junction_table_id>';
```

## Querying Relations

### BelongsTo Relations

Fetch the related parent record:

```typescript
// ORM
const postsResult = await db.post.findMany({
  select: {
    id: true,
    title: true,
    author: {
      select: { id: true, name: true, avatar: true },
    },
  },
}).unwrap();
const posts = postsResult.posts.nodes;

// Access
posts.forEach(post => {
  console.log(`${post.title} by ${post.author?.name ?? 'Unknown author'}`);
});
```

```typescript
// React Query Hook
const { data } = usePostsQuery({
  selection: {
    fields: {
      id: true,
      title: true,
      author: { select: { id: true, name: true } },
    },
  },
});

// Generated hooks return the fields selected by the caller.
data?.posts?.nodes.forEach(post => {
  console.log(`${post.title} by ${post.author?.name}`);
});
```

### HasMany Relations

Fetch child records as a collection:

```typescript
// ORM
const usersResult = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true, publishedAt: true },
      filter: { published: { equalTo: true } },
      orderBy: ['PUBLISHED_AT_DESC'],
      first: 5,
    },
  },
}).unwrap();
const users = usersResult.users.nodes;

// Access
users.forEach(user => {
  console.log(`${user.name} has ${user.posts.nodes.length} recent posts`);
  user.posts.nodes.forEach(post => {
    console.log(`  - ${post.title}`);
  });
});
```

### ManyToMany Relations

When `expose_in_api` is `true`, M:N relations appear as direct connection fields (e.g., `post.tags`, `tag.posts`). The junction table is transparent:

```typescript
// ORM - query posts with their tags (M:N shortcut)
const postsResult = await db.post.findMany({
  select: {
    id: true,
    title: true,
    tags: {
      select: { id: true, name: true, color: true },
    },
  },
}).unwrap();
const posts = postsResult.posts.nodes;

// Access - junction table is invisible
posts.forEach(post => {
  const tagNames = post.tags.nodes.map(t => t.name).join(', ');
  console.log(`${post.title} [${tagNames}]`);
});
```

Reverse direction works the same way:

```typescript
// ORM - query tags with their posts
const tagsResult = await db.tag.findMany({
  select: {
    name: true,
    posts: {
      select: { id: true, title: true },
    },
  },
}).unwrap();
const tags = tagsResult.tags.nodes;

tags.forEach(tag => {
  console.log(`${tag.name}: ${tag.posts.nodes.length} posts`);
});
```

## M:N Writes

Use the junction-table ORM model directly. The current generator can emit
`add<Relation>()` and `remove<Relation>()` helpers, but `add<Relation>()`
selects a junction `id` even when the documented composite-key table has no
such field. Those helpers are outside the supported contract until their
selection is derived from the junction primary key.

Direct junction CRUD works regardless of `expose_in_api`:

```typescript
// Create a junction row (link post to tag)
await db.postTag.create({
  data: { postId: POST_1, tagId: TAG_TECH },
  select: { postId: true, tagId: true },
}).execute();

// Delete by composite primary key
await db.postTag.delete({
  where: { postId: POST_1, tagId: TAG_TECH },
  select: { postId: true, tagId: true },
}).execute();

// Query junction rows
const links = await db.postTag.findMany({
  select: { postId: true, tagId: true },
  where: { postId: { equalTo: POST_1 } },
}).execute();
```

## Composite Primary Keys

Junction tables use composite primary keys (e.g., `(post_id, tag_id)`) instead of a surrogate `id`. The ORM and codegen handle this transparently.

### How Composite PKs Are Detected

1. **Introspection:** `infer-tables.ts` matches mutations like `deletePostTagByPostIdAndTagId` via `startsWith('deletePostTagBy')` pattern
2. **Input type derivation:** The input type name is derived from the actual mutation name: `DeletePostTagByPostIdAndTagIdInput`
3. **PK inference:** `inferPrimaryKeyFromInputObject()` extracts all non-patch, non-clientMutationId fields as PK fields

### Naming Conventions

PostGraphile generates mutation and input type names based on the table's PK structure:

| Table PK | Delete Mutation | Input Type |
|----------|----------------|------------|
| Single `id` | `deletePost` | `DeletePostInput` |
| Composite `(post_id, tag_id)` | `deletePostTagByPostIdAndTagId` | `DeletePostTagByPostIdAndTagIdInput` |

The naming is centralized in two places:
- **`utils.ts`**: `getDeleteInputTypeName(table)` and `getUpdateInputTypeName(table)` - derive from `table.query.delete` / `table.query.update`
- **`infer-tables.ts`**: `inputTypeFromMutation(mutationName, fallback)` - local helper for introspection-time derivation

Both follow the same rule: `ucFirst(mutationName) + 'Input'` when the mutation name is known, else fall back to `${Verb}${Entity}Input`.

### ORM Delete with Composite Keys

```typescript
// Single PK (standard)
await db.post.delete({
  where: { id: postId },
  select: { id: true },
}).execute();

// Composite PK (junction table)
await db.postTag.delete({
  where: { postId: POST_1, tagId: TAG_TECH },
  select: { postId: true, tagId: true },
}).execute();
```

The `buildDeleteByPkDocument` in `query-builder.ts` handles both cases - it maps each PK field to a GraphQL variable and wraps them in the correct input type.

### PK Type Safety

Junction-model `data`, `where`, and `select` fields are resolved from the
actual table constraints, so composite UUID and integer keys retain their
generated field types without relying on the unsupported convenience helpers.

## Nested Relations

Go multiple levels deep:

```typescript
const usersResult = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: {
        id: true,
        title: true,
        tags: {
          select: { name: true, color: true },
        },
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
}).unwrap();
const users = usersResult.users.nodes;

// Access deeply nested data
users.forEach(user => {
  user.posts.nodes.forEach(post => {
    const tagNames = post.tags.nodes.map(t => t.name).join(', ');
    console.log(`${post.title} [${tagNames}]`);
    post.comments.nodes.forEach(comment => {
      console.log(`  ${comment.author?.name ?? 'Unknown author'}: ${comment.body}`);
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
  where: {
    authorId: { equalTo: 'user-123' },
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
        and: [
          { published: { equalTo: true } },
          { publishedAt: { greaterThanOrEqualTo: '2024-01-01' } },
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
  where: {
    posts: {
      some: { published: { equalTo: true } },
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
      orderBy: ['PUBLISHED_AT_DESC'],
    },
    comments: {
      select: { id: true, body: true, createdAt: true },
      orderBy: ['CREATED_AT_ASC'],
    },
  },
}).execute();
```

## Bounded Nested Relations

```typescript
// Bound the nested posts selected with this user
const user = await db.user.findOne({
  id: userId,
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true, title: true },
      first: 10,
    },
  },
}).execute();
```

Generated nested relation selections currently accept only `first`, `filter`,
and `orderBy`; they do not expose `offset`, cursors, or an implicit page-size
default. For independent pagination, query the related entity model at the
root and apply its generated foreign-key filter with the top-level pagination
arguments.

## React Query Patterns

### Loading Relations Separately

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data: user } = useUserQuery({
    id: userId,
    selection: { fields: { id: true, name: true } },
  });
  const { data: posts } = usePostsQuery({
    selection: {
      fields: { id: true, title: true },
      where: { authorId: { equalTo: userId } },
      first: 10,
    },
    enabled: Boolean(userId),
  });

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
const authorsResult = await db.user.findMany({
  select: {
    id: true,
    name: true,
    posts: {
      select: { id: true },
    },
  },
}).unwrap();
const authors = authorsResult.users.nodes;

const authorsWithCounts = authors.map(author => ({
  id: author.id,
  name: author.name,
  posts: author.posts,
  postCount: author.posts.totalCount,
}));
```

### Posts with Comment Count and Latest Comment

```typescript
const postsResult = await db.post.findMany({
  select: {
    id: true,
    title: true,
    comments: {
      select: { id: true, body: true, createdAt: true },
      orderBy: ['CREATED_AT_DESC'],
    },
  },
}).unwrap();
const posts = postsResult.posts.nodes;

const postsWithStats = posts.map(post => ({
  id: post.id,
  title: post.title,
  commentCount: post.comments.totalCount,
  latestComment: post.comments.nodes[0] ?? null,
}));
```

### User Feed with Mixed Content

```typescript
const userResult = await db.user.findOne({
  id: userId,
  select: {
    id: true,
    name: true,
    // Own posts
    posts: {
      select: { id: true, title: true, createdAt: true },
      orderBy: ['CREATED_AT_DESC'],
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
      orderBy: ['CREATED_AT_DESC'],
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
      orderBy: ['CREATED_AT_DESC'],
      first: 10,
    },
  },
}).unwrap();
const user = userResult.user;
```

### Full M:N Lifecycle

```typescript
// 1. Create entities
const postResult = await db.post.create({
  data: { title: 'My Post', body: 'Hello world' },
  select: { id: true },
}).unwrap();
const post = postResult.createPost.post;

const tagResult = await db.tag.create({
  data: { name: 'TypeScript', color: '#3178C6' },
  select: { id: true },
}).unwrap();
const tag = tagResult.createTag.tag;

// 2. Link them (create junction row)
await db.postTag.create({
  data: { postId: post.id, tagId: tag.id },
  select: { postId: true, tagId: true },
}).execute();

// 3. Query the M:N relation
const postWithTags = await db.post.findMany({
  select: {
    title: true,
    tags: { select: { name: true, color: true } },
  },
  where: { id: { equalTo: post.id } },
}).execute();

// 4. Unlink (delete junction row by composite PK)
await db.postTag.delete({
  where: { postId: post.id, tagId: tag.id },
  select: { postId: true, tagId: true },
}).execute();
```

## Type Safety

The select determines the return type:

```typescript
// Only selecting id and name
const minimalUserResult = await db.user.findOne({
  id,
  select: { id: true, name: true },
}).unwrap();
const minimalUser = minimalUserResult.user;

// minimalUser?.email would be a TypeScript error

// Selecting with posts relation
const userWithPostsResult = await db.user.findOne({
  id,
  select: {
    id: true,
    name: true,
    posts: { select: { id: true, title: true } },
  },
}).unwrap();
const userWithPosts = userWithPostsResult.user;

// userWithPosts?.posts is a typed ConnectionResult.
```

## Codegen Architecture (Internal)

### How Relations Flow Through the Pipeline

```
1. Schema introspection (infer-tables.ts)
   |- matchMutationOperations() - detects delete/update mutations
   |  '- startsWith('deletePostTagBy') matches composite PK mutations
   |- inferConstraints() - extracts PK fields from input types
   |  '- inferPrimaryKeyFromInputObject() - supports composite keys
   '- inferRelations() - detects belongsTo, hasMany, manyToMany

2. _meta enrichment (enrich-relations.ts)
   '- Adds junctionLeftKeyFields, junctionRightKeyFields, leftKeyFields,
      rightKeyFields from _meta.tables[].relations.manyToMany

3. ORM codegen (model-generator.ts)
   |- Standard CRUD: findMany, findFirst, findOne, create, update, delete
   '- M:N convenience helpers may be emitted but are not part of the supported
      contract until create selections follow the junction primary key

4. Input type naming (centralized)
   |- utils.ts: getDeleteInputTypeName(table), getUpdateInputTypeName(table)
   '- infer-tables.ts: inputTypeFromMutation(mutationName, fallback)
   Rule: ucFirst(mutationName) + 'Input' when known, else ${Verb}${Entity}Input
```

### Filter Type Safety from Schema

Plugin-injected filter fields (BM25, tsvector, trigram, pgvector, PostGIS) are typed from the schema source of truth. The `OrderBy` enum values are resolved directly from the introspected schema rather than being hardcoded, ensuring type-safe filter and ordering for all search strategies.

```typescript
// These filter fields are type-safe - their types come from schema introspection
where: {
  tsvBody: { matches: 'search query' },
  bm25Body: { query: 'relevance search' },
  trgmName: { similarTo: 'fuzzy match' },
}

// OrderBy values are schema-derived enum members
orderBy: ['BODY_BM25_SCORE_ASC', 'NAME_TRGM_SIMILARITY_DESC']
```
