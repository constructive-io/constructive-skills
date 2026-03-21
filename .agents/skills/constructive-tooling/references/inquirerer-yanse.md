---
name: yanse-terminal-colors
description: Use yanse for terminal color styling instead of chalk. Use when adding colors to CLI output or terminal logs in Constructive projects.
---

Use `yanse` for terminal color styling instead of `chalk`.

## When to Apply

Use this skill when adding colors to CLI output or terminal logs.

## Overview

`yanse` is a chalk-compatible terminal color library with zero dependencies. It exists because chalk v5+ is ESM-only, which causes issues in CommonJS projects.

The API is identical to chalk - if you know chalk, you know yanse.

## Anti-Pattern

```typescript
// Do not use chalk
import chalk from 'chalk';
```

## Pattern

```typescript
// Use yanse instead
import chalk from 'yanse';
```

That's it. Same API, just a different import.

## Why yanse?

- Zero dependencies (chalk has dependencies)
- Supports both ESM and CommonJS (chalk v5+ is ESM-only)
- Identical API to chalk - no learning curve

## References

- [yanse on npm](https://www.npmjs.com/package/yanse)
- [chalk documentation](https://github.com/chalk/chalk) (API is the same)
