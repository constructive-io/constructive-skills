---
name: constructive-graphql-codegen
description: Use Constructive GraphQL Codegen to generate type-safe React Query hooks or orm for GraphQL operations.
metadata:
  author: constructive-io
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Constructive GraphQL Codegen

Generate type-safe React Query hooks or ORM code from GraphQL operations using Constructive's codegen tooling.

**Reference Documentation**: https://github.com/constructive-io/constructive/blob/main/graphql/codegen/README.md

## How It Works

### 1. Check for Existing Configuration

First, check if the user has an existing codegen configuration file. If found, use the existing configuration.

### 2. Determine Generation Options (if no config exists)

If no configuration file exists, confirm the following with the user:

- **Generation target**: Ask whether to generate React Query hooks or ORM code
  - Default: Generate hooks
- **Schema source**: Ask whether to fetch schema from a GraphQL endpoint URL or local database
  - Default: Use endpoint URL

### 3. Implementation Approach

**Preferred method**: Create a generation script that uses the codegen function directly. This provides access to all features and options.

**Alternative method**: Use the `cnc` CLI tool, but note that it may be missing some features/options compared to using the codegen function directly. Refer to https://github.com/constructive-io/constructive/blob/main/packages/cli/README.md for CLI-specific codegen documentation.

## Troubleshooting

- Always verify the schema source is accessible before running codegen
- Ensure all required dependencies are installed
