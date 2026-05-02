---
name: constructive-frontend
description: "Build Constructive frontend UIs — 50+ components (@constructive-io/ui on Base UI + Tailwind CSS v4), CRUD Stack cards (iOS-style slide-in panels), and dynamic _meta forms (zero-config CRUD for any table). Use when building UIs, creating forms, working with Stack cards, or using the component library."
compatibility: React 19, Next.js 15+, @constructive-io/ui, Tailwind CSS v4
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive Frontend

Build Constructive frontend UIs with the component library, CRUD Stack cards, and dynamic meta forms.

## When to Apply

Use this skill when:
- Building UIs with `@constructive-io/ui` components (forms, overlays, layout, data display, advanced inputs)
- Creating CRUD actions as Stack cards (iOS-style slide-in panels)
- Building dynamic forms that introspect `_meta` at runtime
- Setting up theming, dark mode, OKLCH tokens
- Using the shadcn registry for Constructive components

## UI Components

50+ components on Base UI + Tailwind CSS v4 with cva variants and data-slot architecture.

**Install components:**
```bash
npx shadcn@latest add @constructive/<component>
```

**Categories:** Forms, overlays (dialogs, sheets, dropdowns), layout (sidebar, stack navigation), data display (tables, cards), advanced inputs (combobox, command palette), motion/animation.

See [ui-components.md](./references/ui-components.md) for the full component reference.

## CRUD Stack Cards

Build create/edit/delete actions as slide-in Stack cards with sticky Cancel/Save/Delete footers. Cards stack naturally (e.g., confirm-delete on top of edit).

See [crud-stack.md](./references/crud-stack.md) for the Stack card pattern, CardComponent structure, card API, and stacked confirm-delete.

## Dynamic Meta Forms

Build fully dynamic CRUD forms for any Constructive-provisioned table — zero static field configuration. The `_meta` query introspects field names, types, required status, FK relationships, and mutation names at runtime.

See [meta-forms.md](./references/meta-forms.md) for DynamicFormCard, locked FK pre-fill, and O2M/M2M patterns.

## Reference Guide

### Component Library

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [ui-components.md](./references/ui-components.md) | Full component library overview | Understanding architecture, installation, component categories |
| [ui-foundations.md](./references/ui-foundations.md) | Theming, tokens, dark mode | Setting up OKLCH tokens, CSS variables, theme switching |
| [ui-forms.md](./references/ui-forms.md) | Form components | Input, Select, Checkbox, Radio, Switch, DatePicker |
| [ui-overlays.md](./references/ui-overlays.md) | Overlay components | Dialog, Sheet, Popover, Tooltip |
| [ui-layout.md](./references/ui-layout.md) | Layout components | Sidebar, Tabs, Accordion, Separator |
| [ui-data-display.md](./references/ui-data-display.md) | Data display components | Table, Card, Badge, Avatar |
| [ui-advanced-inputs.md](./references/ui-advanced-inputs.md) | Advanced input components | Combobox, Command palette, multi-select |
| [ui-input-components.md](./references/ui-input-components.md) | Input component patterns | Text, number, password, textarea variants |
| [ui-card-patterns.md](./references/ui-card-patterns.md) | Card layout patterns | Card composition, headers, footers, actions |
| [ui-motion.md](./references/ui-motion.md) | Motion and animation | Transitions, enter/exit animations |
| [ui-theming.md](./references/ui-theming.md) | Theme configuration | Custom themes, CSS variable overrides |
| [ui-token-values.md](./references/ui-token-values.md) | Design token reference | Color, spacing, typography token values |
| [ui-registry.md](./references/ui-registry.md) | shadcn registry setup | Registry configuration, component installation |
| [ui-combobox-api.md](./references/ui-combobox-api.md) | Combobox API reference | Combobox props, async loading, filtering |
| [ui-command-palette.md](./references/ui-command-palette.md) | Command palette | Keyboard shortcuts, command groups |
| [ui-dropdown-menu-api.md](./references/ui-dropdown-menu-api.md) | Dropdown menu API | Menu items, submenus, separators |
| [ui-sidebar-api.md](./references/ui-sidebar-api.md) | Sidebar API reference | Collapsible sidebar, navigation items |
| [ui-sheet-stacking.md](./references/ui-sheet-stacking.md) | Sheet stacking patterns | Multi-level sheet navigation |
| [ui-stack-navigation.md](./references/ui-stack-navigation.md) | Stack navigation | Push/pop card navigation |

### CRUD & Forms

| Reference | Topic | Consult When |
|-----------|-------|--------------|
| [crud-stack.md](./references/crud-stack.md) | Stack card CRUD pattern | Building create/edit/delete actions as slide-in cards |
| [meta-forms.md](./references/meta-forms.md) | Dynamic `_meta` forms | Runtime-introspected CRUD forms, FK pre-fill, related records |

## Cross-References

- `constructive-sdk-graphql` — Code generation and SDK usage (data fetching for components)
- `constructive-starter-kits` — Next.js app boilerplate (uses these UI components)
- `constructive-platform` — Platform core, server configuration
