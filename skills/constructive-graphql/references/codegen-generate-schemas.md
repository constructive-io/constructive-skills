# Generate Schemas

Export GraphQL schemas to `.graphql` SDL files without generating any code. This is useful for creating portable, version-controllable schema artifacts that can then be used as input for code generation via `schemaFile` or `schemaDir`.

## When to Use

- You want deterministic, portable builds that don't depend on a live database or endpoint at code generation time
- You want schema changes to show up as clear diffs in version control
- You need to share schemas across multiple projects or teams
- You're setting up the recommended two-step workflow: export schema first, then generate code from the exported file

## Programmatic API

```typescript
import { generate } from '@constructive-io/graphql-codegen';

// Export from database
await generate({
  db: { schemas: ['public'] },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'public.graphql',
});

// Export from PGPM module
await generate({
  db: {
    pgpm: { modulePath: './packages/my-module' },
    schemas: ['app_public'],
  },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'app_public.graphql',
});

// Export from endpoint
await generate({
  endpoint: 'https://api.example.com/graphql',
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
});

// Export from PGPM workspace + module name
await generate({
  db: {
    pgpm: {
      workspacePath: '.',
      moduleName: 'my-module',
    },
    schemas: ['app_public'],
  },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'app_public.graphql',
});
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `schemaOnly` | `boolean` | `false` | Enable schema export mode (no code generation) |
| `schemaOnlyOutput` | `string` | Same as `output` | Output directory for the exported schema file |
| `schemaOnlyFilename` | `string` | `'schema.graphql'` | Filename for the exported schema |

When `schemaOnly: true`, no generators run (`reactQuery`, `orm`, `cli` are all ignored). The function fetches the schema via introspection, converts it to SDL using `printSchema()`, and writes it to disk.

## Recommended Two-Step Workflow

### Step 1: Export schemas

```typescript
// scripts/export-schemas.ts
import { generate } from '@constructive-io/graphql-codegen';

// Export each schema you need
await generate({
  db: { schemas: ['public'] },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'public.graphql',
});

await generate({
  db: { schemas: ['admin'] },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'admin.graphql',
});
```

### Step 2: Generate code from schema directory

```typescript
// scripts/codegen.ts
import { generate } from '@constructive-io/graphql-codegen';

// schemaDir auto-expands each .graphql file to a target
await generate({
  schemaDir: './schemas',
  output: './generated',
  reactQuery: true,
  orm: true,
});
// Produces: generated/public/{hooks,orm}/, generated/admin/{hooks,orm}/
```

**Why this workflow is recommended:**
- **Deterministic** -- `.graphql` files are static, version-controllable artifacts
- **Portable** -- no live database or endpoint needed at code generation time
- **Fast** -- no network requests or ephemeral database creation during codegen
- **Reviewable** -- schema changes show up as clear diffs in version control

## Multi-Target Schema Export

When using `generateMulti()` with `schemaOnly: true`, each target's schema is exported with the target name as the filename:

```typescript
import { generateMulti } from '@constructive-io/graphql-codegen';

await generateMulti({
  configs: {
    public: {
      db: { schemas: ['public'] },
      output: './schemas',
    },
    admin: {
      db: { schemas: ['admin'] },
      output: './schemas',
    },
  },
  schemaOnly: true,
});
// Produces: schemas/public.graphql, schemas/admin.graphql
```

## Result Handling

```typescript
const result = await generate({
  db: { schemas: ['public'] },
  schemaOnly: true,
  schemaOnlyOutput: './schemas',
  schemaOnlyFilename: 'public.graphql',
});

if (result.success) {
  console.log(result.message);
  // "Schema exported to /absolute/path/schemas/public.graphql"
  console.log(result.filesWritten);
  // ["/absolute/path/schemas/public.graphql"]
} else {
  console.error(result.message);
  // e.g. "Schema introspection returned empty SDL."
  // e.g. "Failed to export schema: connection refused"
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Schema export produces empty file | Verify database/endpoint has tables in the specified schemas |
| "Schema introspection returned empty SDL" | The schema has no types -- check schema name spelling |
| Connection refused | Verify database is running and connection config is correct |
| Auth errors | Add `headers: { Authorization: 'Bearer token' }` for endpoint sources |
