# Constructive registry consumption

Use [`constructive-blocks`](../../constructive-blocks/SKILL.md) as the
installation authority. Its machine snapshot pins every registry item,
dependency closure, package version, source hash, shadcn version, and release
gate.

## Current release gate

The pinned Blocks snapshot is branch-only and declares
`release.publicRegistryReady: false`. Its `@constructive` registry and the
current `@constructive-io/ui`, `@constructive-io/data`,
`@constructive-io/schema-builder`, and `@constructive-io/sheets` packages must
be consumed through the pinned local workflow. A public URL or package version
is not evidence that it contains this snapshot.

Inspect the exact item before installing it:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --registry-item app-shell
```

Run the source preflight, local builds, package registry, block registry, and
consumer verification exactly as documented in
[`runtime-contract.md`](../../constructive-blocks/references/runtime-contract.md#pinned-local-consumption-before-release).
That workflow uses shadcn `4.13.1`, preserves the consumer's aliases, and keeps
temporary localhost package resolutions out of committed lockfiles.

## Source or package ownership

| Need | Choose | Import style |
|---|---|---|
| Editable component owned by the application | Local `@constructive` registry | The consumer alias written by shadcn, such as `@/components/ui/button` |
| Centralized component implementation | Locally served `@constructive-io/ui` package | A valid export such as `@constructive-io/ui/button` |
| Feature pack or Console Kit | Local `@constructive` registry | The installed block path returned by the selected install contract |

Do not mix registry and package ownership for the same primitive. Registry
roots copy required component and theme source, while package-backed roots may
also declare current Constructive packages.

## Promotion after release

Public installation is allowed only when a deliberately updated Blocks
snapshot points to a released commit, sets `publicRegistryReady: true`, and
passes the full checker. At that point, use the exact namespace and
`installCommand` returned by the validated catalog. Remove local registry
settings, regenerate the lockfile from public registries, and reject every
localhost resolution before committing.
