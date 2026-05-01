# Config File Reference (Advanced / Last Resort)

Config files (`pgpm.json` / `pgpm.config.js`) are supported but **should rarely be needed**. The preferred approach is to use environment variables and runtime overrides via `getEnvOptions()`.

Config files exist primarily for workspaces that need shared base settings across many packages (e.g., a monorepo where every package shares the same DB extensions list).

## When You Might Need a Config File

- You have a large workspace where many packages share the same non-default settings
- You need dynamic configuration that depends on runtime logic (`pgpm.config.js` only)
- You're working with `pgpm init workspace` which generates one automatically

**In most cases, env vars + `getEnvOptions()` overrides are sufficient.**

## How It Works

`loadConfigSync(cwd)` walks up the directory tree from `cwd` looking for `pgpm.config.js` (checked first) or `pgpm.json`. The first found is used. If none is found, an empty object is returned and defaults still apply.

Config file values sit in the merge hierarchy between defaults and env vars:

```
defaults → config file → env vars → runtime overrides
```

Env vars always override config file values.

## Source

- **Config loading logic:** `pgpm/env/src/config.ts`
- **Workspace resolution:** `pgpm/env/src/workspace.ts`
