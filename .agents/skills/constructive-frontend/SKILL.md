---
name: constructive-frontend
description: "Build polished Constructive application UI with Constructive primitives, Tailwind CSS v4, app shell and app bar composition, CRUD Stack cards, and custom domain views. Use for visual composition, forms, overlays, layout, theming, accessibility, or bespoke domain UI. Use constructive-blocks for feature-pack and Console Kit installation/runtime work."
metadata:
  author: constructive-io
  version: "2.0.0"
---

# Constructive Frontend

Build and polish custom Constructive application UI. This skill owns visual composition and bespoke domain views; [`constructive-blocks`](../constructive-blocks/SKILL.md) owns the registry, feature packs, Console Kit, tenant descriptors, and runtime integration.

## When to Apply

Use this skill when:

- Composing pages with Constructive primitives, forms, overlays, tables, or navigation.
- Customizing the app shell, app bar, typography, color, motion, responsive behavior, or accessibility.
- Building a bespoke domain screen that does not already exist as a feature pack.
- Creating CRUD actions with Stack cards.
- Extending an installed block without changing its endpoint, session, discovery, or store contract.

Use `constructive-blocks` instead when choosing or installing a registry root, mounting Console Kit, supplying tenant endpoints, integrating a feature pack, or diagnosing `ready`, `partial`, or `unavailable` capability state.

## Distribution Boundary

Constructive UI primitives can be consumed as versioned npm subpaths or editable shadcn source. Choose one ownership model per component and keep it consistent.

```tsx
import { Button } from '@constructive-io/ui/button';
import { Dialog, DialogPopup, DialogTrigger } from '@constructive-io/ui/dialog';
```

For source installation, configure the Blocks registry namespace and use the pinned shadcn CLI version documented by `constructive-blocks`:

```bash
pnpm dlx shadcn@4.13.1 add @constructive/button
```

Do not use the retired Dashboard registry, `shadcn@latest`, or an unconfigured direct URL. Nested registry dependencies resolve through the `@constructive` namespace.

See [ui-registry.md](./references/ui-registry.md) for the distribution decision and [`constructive-blocks`](../constructive-blocks/SKILL.md) for the canonical install contract.

## UI Composition

Constructive primitives use Base UI, Tailwind CSS v4, OKLCH tokens, `cva` variants, and `data-slot` attributes. Prefer deep npm imports, preserve keyboard and focus behavior when styling, and keep interactive state close to the component that owns it.

| Area | Reference |
|---|---|
| Architecture, deep imports, and component conventions | [ui-components.md](./references/ui-components.md) |
| Tokens, dark mode, and theme composition | [ui-foundations.md](./references/ui-foundations.md), [ui-theming.md](./references/ui-theming.md), [ui-token-values.md](./references/ui-token-values.md) |
| Form and input composition | [ui-forms.md](./references/ui-forms.md), [ui-input-components.md](./references/ui-input-components.md), [ui-advanced-inputs.md](./references/ui-advanced-inputs.md) |
| Dialogs, sheets, menus, and stacked overlays | [ui-overlays.md](./references/ui-overlays.md), [ui-sheet-stacking.md](./references/ui-sheet-stacking.md) |
| App layout and navigation | [ui-layout.md](./references/ui-layout.md), [ui-sidebar-api.md](./references/ui-sidebar-api.md), [ui-stack-navigation.md](./references/ui-stack-navigation.md) |
| Tables, cards, status, and feedback | [ui-data-display.md](./references/ui-data-display.md), [ui-card-patterns.md](./references/ui-card-patterns.md) |
| Motion | [ui-motion.md](./references/ui-motion.md) |

## Custom Domain Data

Start with the Data feature pack when the goal is generic application-table exploration or spreadsheet CRUD. It already uses the current `_meta` contract, standard introspection, explicit endpoints, and authenticated runtime evidence.

For a bespoke domain screen:

1. Receive the data endpoint and session through the host's tenant runtime; never derive a related hostname.
2. Import the current metadata query and compatibility helpers from `@constructive-io/data` instead of copying a `_meta` query into the app.
3. Reconcile `_meta` schema facts with standard GraphQL introspection before constructing operations.
4. Treat runtime reads and mutations as the authority for grants and RLS; do not substitute an operator endpoint when rows are hidden.
5. Generate a client only when the domain schema is stable and compile-time types are worth the regeneration workflow.

See [meta-forms.md](./references/meta-forms.md) for the custom-domain boundary. For optional generated clients, use [`constructive-codegen`](../constructive-codegen/SKILL.md), [`constructive-orm`](../constructive-orm/SKILL.md), or [`constructive-hooks`](../constructive-hooks/SKILL.md).

## CRUD Stack Cards

Use Stack cards for focused create, edit, and delete workflows that benefit from maintaining page context. Keep destructive confirmation explicit and preserve mobile sheet behavior.

See [crud-stack.md](./references/crud-stack.md) for the card API and composition pattern. Use the Data feature pack rather than recreating a generic metadata-driven CRUD stack.

## Cross-References

- [`constructive-blocks`](../constructive-blocks/SKILL.md) — exact registry roots, feature packs, Console Kit, runtime, and verification.
- [`constructive-builder`](../constructive-builder/SKILL.md) — agent-driven tenant frontend assembly and acceptance against an already-provisioned tenant.
- [`constructive-security`](../constructive-security/SKILL.md) — RLS and authorization behavior behind application UI.
- [`constructive-platform`](../constructive-platform/SKILL.md) — public API and deployment configuration.
