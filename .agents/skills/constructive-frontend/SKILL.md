---
name: constructive-frontend
description: "Build and polish Constructive application UI with App Kit, Constructive primitives, Tailwind CSS v4, app shell composition, and optional Stack navigation. Use for visual composition, forms, record and collection views, overlays, layout, theming, accessibility, responsive behavior, or bespoke domain UI. Use constructive-blocks to select and install App Kit, platform feature packs, or Console Kit."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Frontend

Build and polish custom Constructive application UI. This skill owns visual
composition and domain-specific presentation; [`constructive-blocks`](../constructive-blocks/SKILL.md)
owns App Kit contracts and installation, the registry, platform feature packs,
Console Kit, tenant descriptors, and runtime integration.

## When to Apply

Use this skill when:

- Composing pages with Constructive primitives, forms, overlays, tables, or navigation.
- Customizing the app shell, app bar, typography, color, motion, responsive behavior, or accessibility.
- Composing or extending App Kit controlled views around a domain design.
- Building a bespoke domain screen that does not fit an App Kit view family.
- Choosing a route, page, dialog, or Stack card for record opening and CRUD.
- Extending an installed block without changing its endpoint, session, discovery, or store contract.

Use `constructive-blocks` first when choosing or installing App Kit roots,
defining its resource/query/action boundary, mounting Console Kit, integrating a
feature pack, or diagnosing registry and runtime capability state.

## Pinned Distribution Boundary

The current Blocks snapshot is branch-only and declares
`release.publicRegistryReady: false`. Treat every current Constructive registry
root and every `@constructive-io/ui`, `@constructive-io/data`,
`@constructive-io/schema-builder`, or `@constructive-io/sheets` package as a
pinned local dependency. Do not issue a public install command.

Resolve the requested root through the validated Blocks catalog first:

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --registry-item app-shell
```

Then follow the pinned local-consumption workflow in
[`constructive-blocks/references/runtime-contract.md`](../constructive-blocks/references/runtime-contract.md#pinned-local-consumption-before-release).
It verifies the exact Blocks commit, builds local registries and packages, and
installs through shadcn `4.13.1` without treating localhost resolutions as
release artifacts. Public registry and package installation becomes valid
only after the Blocks snapshot says `publicRegistryReady: true` and its checker
passes against that released source.

Choose either editable registry source or a locally served package for a
primitive and keep that ownership consistent. Installed registry source uses
the consumer aliases returned by shadcn; locally served package consumption
uses exported subpaths such as `@constructive-io/ui/button`.

See [ui-registry.md](./references/ui-registry.md) for the distribution decision
and [`constructive-blocks`](../constructive-blocks/SKILL.md) for the canonical
install contract.

## UI Composition

Target Next.js 16 App Router with React Server Components, shadcn `4.13.1`,
the `base-nova` style, Base UI primitives, Tailwind CSS v4, and Lucide icons.
Interactive registry components carry `'use client'`; pages and layouts remain
server components until they need browser state. Compose polymorphic Base UI
parts with `render`, preserve keyboard and focus behavior, and keep interactive
state close to the component that owns it.

| Area | Reference |
|---|---|
| Architecture, deep imports, and component conventions | [ui-components.md](./references/ui-components.md) |
| Tokens, dark mode, and theme composition | [ui-foundations.md](./references/ui-foundations.md), [ui-theming.md](./references/ui-theming.md), [ui-token-values.md](./references/ui-token-values.md) |
| Form and input composition | [ui-forms.md](./references/ui-forms.md), [ui-input-components.md](./references/ui-input-components.md), [ui-advanced-inputs.md](./references/ui-advanced-inputs.md) |
| Dialogs, sheets, menus, and stacked overlays | [ui-overlays.md](./references/ui-overlays.md), [ui-sheet-stacking.md](./references/ui-sheet-stacking.md) |
| App layout and navigation | [ui-app-shell.md](./references/ui-app-shell.md), [ui-layout.md](./references/ui-layout.md), [ui-sidebar-api.md](./references/ui-sidebar-api.md), [ui-stack-navigation.md](./references/ui-stack-navigation.md) |
| Tables, cards, status, and feedback | [ui-data-display.md](./references/ui-data-display.md), [ui-card-patterns.md](./references/ui-card-patterns.md) |
| Motion | [ui-motion.md](./references/ui-motion.md) |

## Custom Domain Data

Start with App Kit when the goal is an application around domain records,
relations, actions, aggregates, boards, or time ranges. Read its
[composition](../constructive-blocks/references/app-composition.md),
[resource contract](../constructive-blocks/references/app-resource-contract.md),
and [view patterns](../constructive-blocks/references/app-view-patterns.md), then
use the [canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for exact APIs before styling the result.

Use the Data feature pack when the goal is generic application-table
exploration or spreadsheet-style inline CRUD. It owns its separate Sheets
metadata and state boundary; do not use it as the default for a domain app.

For an App Kit screen:

1. Receive endpoint and authenticated scope through the host; never derive a
   related hostname.
2. Reconcile `_meta` with final GraphQL introspection during generation/build
   and follow the canonical resource-validation procedure.
3. Inject abortable SDK, ORM, or GraphQL transport at the documented boundary;
   do not make views discover schema at runtime.
4. Preserve the selected controlled/connected ownership when changing visual
   composition, and treat runtime reads and mutations as authority for grants
   and RLS.

Use [meta-forms.md](./references/meta-forms.md) only for a bespoke dynamic
metadata surface outside App Kit. For generated clients, use
[`constructive-codegen`](../constructive-codegen/SKILL.md),
[`constructive-orm`](../constructive-orm/SKILL.md), or
[`constructive-hooks`](../constructive-hooks/SKILL.md).

## Optional CRUD Stack Cards

Use Stack cards only when a focused create, edit, detail, or delete flow benefits
from maintaining page context. Keep record opening host-controlled so the same
resource can use a route, dedicated page, dialog, or Stack adapter. Preserve
explicit destructive confirmation and mobile sheet behavior when Stack is
selected.

See [crud-stack.md](./references/crud-stack.md) for the optional adapter pattern.
Use App Kit data views for typed domain CRUD and the Data feature pack for
generic spreadsheet exploration rather than recreating either inside a card.

## Cross-References

- [`constructive-blocks`](../constructive-blocks/SKILL.md) — App Kit contracts, exact registry roots, platform feature packs, Console Kit, runtime, and verification.
- [`constructive-builder`](../constructive-builder/SKILL.md) — agent-driven tenant frontend assembly and acceptance against an already-provisioned tenant.
- [`constructive-security`](../constructive-security/SKILL.md) — RLS and authorization behavior behind application UI.
- [`constructive-platform`](../constructive-platform/SKILL.md) — public API and deployment configuration.
