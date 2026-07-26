# Constructive registry consumption

Constructive Blocks publishes the `@constructive` shadcn registry. The registry contains UI primitives, app shell and app bar blocks, billing blocks, standalone feature packs, Console Kit modules, official preset roots, and the complete Console Kit.

[`constructive-blocks`](../../constructive-blocks/SKILL.md) is the authority for exact root names, dependency closure, compatibility manifests, runtime requirements, and verification. This reference only explains how a custom UI project consumes the namespace.

## Configure the namespace

Initialize shadcn when the application does not already have `components.json`:

```bash
pnpm dlx shadcn@4.13.1 init
```

Preserve the generated aliases and add the registry mapping:

```json
{
  "registries": {
    "@constructive": "https://constructive-io.github.io/blocks/r/{name}.json"
  }
}
```

Install through the namespace:

```bash
pnpm dlx shadcn@4.13.1 add @constructive/button
pnpm dlx shadcn@4.13.1 add @constructive/app-shell
```

The namespace remains required even when installing a root by direct URL because nested `@constructive/*` dependencies resolve through `components.json`. Use exactly shadcn `4.13.1`, as emitted by the Blocks install plan; do not substitute `shadcn@latest` or another version.

## Registry source or npm package

| Need | Choose | Import style |
|---|---|---|
| Editable source owned by the application | Registry | Consumer alias such as `@/components/ui/button` |
| Centralized upgrades through a lockfile | `@constructive-io/ui` | Deep package import such as `@constructive-io/ui/button` |
| Feature pack or Console Kit | Registry | Installed block paths |

Do not install the same primitive from npm and the registry in one application. Registry roots copy their required primitive source and theme, while package-backed feature packs may also add their own declared runtime packages.

## Safe updates

Re-running `shadcn add` can overwrite locally customized registry source. Review the diff, preserve deliberate application changes, and run the verification commands emitted by the Blocks install contract.

If a root is missing from the public Pages URL, treat it as unpublished. Do not fall back to the retired Dashboard registry or guess another root name.
