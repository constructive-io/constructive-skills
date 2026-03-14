---
name: constructive-frontend
description: "Frontend UI and application development for Constructive — the @constructive-io/ui component library (50+ components on Base UI + Tailwind CSS v4), CRUD Stack card patterns for CRM interfaces, and the Next.js application boilerplate with authentication, organization management, and GraphQL SDK. Use when building UIs with Constructive components, creating CRUD interfaces, scaffolding frontend applications, or working with Base UI primitives, cva variants, and Tailwind CSS v4 theming."
user-invocable: false
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Frontend

Consolidated skill for frontend UI development, CRUD card patterns, and application scaffolding in the Constructive ecosystem.

## UI Component Library

- 50+ components built on Base UI + Tailwind CSS v4 with cva variants, cn() class merging, and data-slot conventions
- Covers forms, overlays, layout, data display, advanced inputs, animations, and theming with OKLCH tokens
- Deep import convention (`@constructive-io/ui/button`) and shadcn registry installation support
- Includes iOS-style Stack navigation, command palette system, and visual effects

**Triggers:** "build UI with Constructive components", "Base UI primitives", "cva variants", "Tailwind CSS v4 theming", "shadcn registry", "forms", "overlays", "layout", "animations", "advanced inputs"

See [ui-components.md](./references/ui-components.md) for the full component guide.

### UI Sub-References

| Reference | Description |
|-----------|-------------|
| [ui-foundations.md](./references/ui-foundations.md) | Component architecture: cva, cn, Slot, data-slot, Base UI mapping, TypeScript patterns |
| [ui-theming.md](./references/ui-theming.md) | OKLCH tokens, globals.css setup, dark mode, z-index layers, Tailwind v4 migration |
| [ui-token-values.md](./references/ui-token-values.md) | Complete light/dark OKLCH token value table |
| [ui-registry.md](./references/ui-registry.md) | shadcn registry setup, npm vs registry, component bundles, build pipeline |
| [ui-motion.md](./references/ui-motion.md) | motion/react presets, AnimatePresence, springs, stagger patterns, reduced motion |
| [ui-forms.md](./references/ui-forms.md) | Field, FormControl, Form (react-hook-form), InputGroup patterns, Zod validation |
| [ui-input-components.md](./references/ui-input-components.md) | Input, Textarea, Checkbox, RadioGroup, Switch, Select API reference |
| [ui-overlays.md](./references/ui-overlays.md) | Dialog, AlertDialog, Sheet, Popover, Tooltip, DropdownMenu usage and nesting |
| [ui-sheet-stacking.md](./references/ui-sheet-stacking.md) | SheetStackProvider modes, useSheetStack, nested sheets |
| [ui-dropdown-menu-api.md](./references/ui-dropdown-menu-api.md) | DropdownMenu sub-component props reference |
| [ui-command-palette.md](./references/ui-command-palette.md) | Command palette system: registry, hooks, multi-step wizards, background tasks, keyboard shortcuts |
| [ui-layout.md](./references/ui-layout.md) | Sidebar, Tabs, Breadcrumb, Pagination, Stepper, Collapsible, Resizable, ScrollArea |
| [ui-sidebar-api.md](./references/ui-sidebar-api.md) | Sidebar sub-component props, CSS variables, cookie persistence |
| [ui-data-display.md](./references/ui-data-display.md) | Table, Badge, Alert, Avatar, Skeleton, Progress, Toast, visual effects |
| [ui-advanced-inputs.md](./references/ui-advanced-inputs.md) | Autocomplete, Combobox, MultiSelect, Tags, RecordPicker, Calendar, JsonInput |
| [ui-combobox-api.md](./references/ui-combobox-api.md) | Combobox sub-component props, multiple mode, useComboboxFilter |
| [ui-card-patterns.md](./references/ui-card-patterns.md) | Card variants (default/elevated/flat/ghost/interactive), usage patterns, grid layouts |
| [ui-stack-navigation.md](./references/ui-stack-navigation.md) | iOS-style card navigation: CardStackApi, route registry, peek gestures, mobile behavior |

## CRUD Stack Cards

- Build create/edit/delete actions as slide-in Stack cards with Cancel/Save/Delete sticky footers
- CardComponent structure with injected `card` prop for close/push/setTitle/updateProps
- Deferred data loading via `useCardReady()` to avoid janky mid-animation fetches
- Stacked confirm-delete pattern and CardStackProvider setup

**Triggers:** "CRUD actions as Stack cards", "slide-in panels", "card API", "useCardReady", "stacked confirm delete", "CRM card patterns"

See [crud-stack.md](./references/crud-stack.md) for details.

## Next.js Application Boilerplate

- Scaffold a Constructive frontend app with `pgpm init` using the nextjs/constructive-app template
- Production-ready authentication flows, organization management, invite handling, and member management
- Generated GraphQL SDK via `@constructive-io/graphql-codegen` against a running backend
- Project structure with app shell, sidebar navigation, permissions, and branding configuration

**Triggers:** "scaffold Constructive frontend", "set up new Constructive app", "constructive-app boilerplate", "pgpm init nextjs", "Next.js boilerplate with auth"

See [nextjs-boilerplate.md](./references/nextjs-boilerplate.md) for details.
