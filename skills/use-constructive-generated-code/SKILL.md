---
name: use-constructive-generated-code
description: Use Constructive GraphQL generated react query or orm code for GraphQL operations.
metadata:
  author: constructive-io
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Use Constructive Generated Code

Use generated code from Constructive's codegen tooling.

**Reference Documentation**: https://github.com/constructive-io/constructive/blob/main/graphql/codegen/README.md

## How It Works

### 1. Verify Generated Code

First, check if the codegen content has been generated properly and is available in the project.

### 2. Identify Code Type

Determine whether the generated code contains:
- React Query hooks
- ORM code
- Both hooks and ORM

Once identified, refer to the corresponding section in the codegen documentation for usage patterns.

### 3. Use Generated Code

Always prefer using the generated queries, mutations, and other methods from the codegen output to implement the user's request. **Do not write raw SQL or GraphQL operations manually** when generated code is available.

## Troubleshooting

- Verify the GraphQL server is accessible before using generated code
- Ensure all required dependencies are installed
- Import generated hooks/ORM methods from the correct output directory
- Use TypeScript types from generated code for type safety