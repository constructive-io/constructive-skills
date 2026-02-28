Install and configure @constructive-io/ui components via the shadcn registry.

## Registry vs npm Decision Guide

| Factor | npm (`@constructive-io/ui`) | Registry (`@constructive/`) |
|---|---|---|
| Use case | Internal apps, version-locked teams | External consumers, code ownership |
| Install | `pnpm add @constructive-io/ui` | `npx shadcn add @constructive/button` |
| Updates | Bump version in package.json | Re-run `npx shadcn add` (overwrites) |
| Customization | Override via CSS/className | Full source ownership in project |
| Tree-shaking | Via deep imports | Automatic (source copied into project) |
| Versioning | Semver, lockfile controlled | Latest at time of install |
| Dependencies | Shared via node_modules | Inlined into project |

**Choose npm** when you want centralized updates and consistent versions across a monorepo.

**Choose registry** when you want to own the source, customize deeply, or distribute to external teams.

## components.json Setup

Create `components.json` in your project root:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": {
    "@constructive": "https://constructive-io.github.io/dashboard/r/{name}.json"
  }
}
```

Key points:
- `registries.@constructive` maps the `@constructive/` prefix to the GitHub Pages URL
- `aliases.ui` controls where component files are placed (`@/components/ui/`)
- `css` points to your globals.css for theme token injection
- Leave `tailwind.config` empty for Tailwind v4 (CSS-first config)

## Installing Components

### Individual components

```bash
# Using the configured registry prefix
npx shadcn@latest add @constructive/button
npx shadcn@latest add @constructive/dialog
npx shadcn@latest add @constructive/card
npx shadcn@latest add @constructive/input
npx shadcn@latest add @constructive/select
npx shadcn@latest add @constructive/tabs

# Using direct URL (no components.json registry config needed)
npx shadcn@latest add https://constructive-io.github.io/dashboard/r/button.json
```

### Multi-file blocks

Some components install multiple files:

```bash
# Stack installs the Stack component + motion config
npx shadcn@latest add @constructive/stack

# Toast installs Sonner wrapper + toast utilities
npx shadcn@latest add @constructive/toast
```

### Bundles (install related components together)

```bash
npx shadcn@latest add @constructive/form-kit
npx shadcn@latest add @constructive/overlay-kit
npx shadcn@latest add @constructive/layout-kit
```

## Theme Installation

Install the full OKLCH token system via registry:

```bash
npx shadcn@latest add @constructive/constructive-theme
```

This sets up:
- OKLCH color tokens (light and dark)
- Radius scale (xs through 2xl)
- CSS shadow utilities (shadow-card, shadow-card-lg)
- Z-index layer variables
- Font family variables
- Base layer reset (border, outline, body styles)

## Full Component List

### Primitives

| Component | Install command |
|---|---|
| `button` | `npx shadcn@latest add @constructive/button` |
| `badge` | `npx shadcn@latest add @constructive/badge` |
| `label` | `npx shadcn@latest add @constructive/label` |
| `skeleton` | `npx shadcn@latest add @constructive/skeleton` |
| `card` | `npx shadcn@latest add @constructive/card` |
| `separator` | `npx shadcn@latest add @constructive/separator` |
| `alert` | `npx shadcn@latest add @constructive/alert` |

### Form

| Component | Install command |
|---|---|
| `input` | `npx shadcn@latest add @constructive/input` |
| `textarea` | `npx shadcn@latest add @constructive/textarea` |
| `checkbox` | `npx shadcn@latest add @constructive/checkbox` |
| `checkbox-group` | `npx shadcn@latest add @constructive/checkbox-group` |
| `radio-group` | `npx shadcn@latest add @constructive/radio-group` |
| `switch` | `npx shadcn@latest add @constructive/switch` |
| `select` | `npx shadcn@latest add @constructive/select` |
| `progress` | `npx shadcn@latest add @constructive/progress` |
| `form` | `npx shadcn@latest add @constructive/form` |
| `form-control` | `npx shadcn@latest add @constructive/form-control` |
| `input-group` | `npx shadcn@latest add @constructive/input-group` |
| `field` | `npx shadcn@latest add @constructive/field` |

### Overlay

| Component | Install command |
|---|---|
| `dialog` | `npx shadcn@latest add @constructive/dialog` |
| `alert-dialog` | `npx shadcn@latest add @constructive/alert-dialog` |
| `sheet` | `npx shadcn@latest add @constructive/sheet` |
| `drawer` | `npx shadcn@latest add @constructive/drawer` |
| `popover` | `npx shadcn@latest add @constructive/popover` |
| `tooltip` | `npx shadcn@latest add @constructive/tooltip` |
| `dropdown-menu` | `npx shadcn@latest add @constructive/dropdown-menu` |
| `command` | `npx shadcn@latest add @constructive/command` |

### Layout

| Component | Install command |
|---|---|
| `tabs` | `npx shadcn@latest add @constructive/tabs` |
| `collapsible` | `npx shadcn@latest add @constructive/collapsible` |
| `resizable` | `npx shadcn@latest add @constructive/resizable` |
| `scroll-area` | `npx shadcn@latest add @constructive/scroll-area` |
| `sidebar` | `npx shadcn@latest add @constructive/sidebar` |
| `breadcrumb` | `npx shadcn@latest add @constructive/breadcrumb` |
| `pagination` | `npx shadcn@latest add @constructive/pagination` |
| `stepper` | `npx shadcn@latest add @constructive/stepper` |
| `page-header` | `npx shadcn@latest add @constructive/page-header` |
| `dock` | `npx shadcn@latest add @constructive/dock` |
| `portal` | `npx shadcn@latest add @constructive/portal` |

### Data

| Component | Install command |
|---|---|
| `table` | `npx shadcn@latest add @constructive/table` |
| `avatar` | `npx shadcn@latest add @constructive/avatar` |

### Advanced Inputs

| Component | Install command |
|---|---|
| `autocomplete` | `npx shadcn@latest add @constructive/autocomplete` |
| `combobox` | `npx shadcn@latest add @constructive/combobox` |
| `multi-select` | `npx shadcn@latest add @constructive/multi-select` |
| `tags` | `npx shadcn@latest add @constructive/tags` |
| `record-picker` | `npx shadcn@latest add @constructive/record-picker` |
| `calendar-rac` | `npx shadcn@latest add @constructive/calendar-rac` |
| `json-input` | `npx shadcn@latest add @constructive/json-input` |

### Effects

| Component | Install command |
|---|---|
| `flickering-grid` | `npx shadcn@latest add @constructive/flickering-grid` |
| `motion-grid` | `npx shadcn@latest add @constructive/motion-grid` |
| `progressive-blur` | `npx shadcn@latest add @constructive/progressive-blur` |
| `progressive-blur-scroll-container` | `npx shadcn@latest add @constructive/progressive-blur-scroll-container` |
| `responsive-diagram` | `npx shadcn@latest add @constructive/responsive-diagram` |

### Blocks

| Component | Install command |
|---|---|
| `stack` | `npx shadcn@latest add @constructive/stack` |
| `toast` | `npx shadcn@latest add @constructive/toast` |
| `sonner` | `npx shadcn@latest add @constructive/sonner` |

### Utilities

| Utility | Install command |
|---|---|
| `cn` | `npx shadcn@latest add @constructive/cn` |
| `slot` | `npx shadcn@latest add @constructive/slot` |
| `motion-config` | `npx shadcn@latest add @constructive/motion-config` |
| `use-controllable-state` | `npx shadcn@latest add @constructive/use-controllable-state` |
| `use-debounce` | `npx shadcn@latest add @constructive/use-debounce` |
| `use-mobile` | `npx shadcn@latest add @constructive/use-mobile` |

## Bundle Contents

### form-kit

Installs all form-related components in one command:

```bash
npx shadcn@latest add @constructive/form-kit
```

Includes: input, textarea, checkbox, checkbox-group, radio-group, switch, select, progress, form, form-control, input-group, field, label

### overlay-kit

Installs all overlay/modal components:

```bash
npx shadcn@latest add @constructive/overlay-kit
```

Includes: dialog, alert-dialog, sheet, drawer, popover, tooltip, dropdown-menu, command

### layout-kit

Installs all layout components:

```bash
npx shadcn@latest add @constructive/layout-kit
```

Includes: tabs, collapsible, resizable, scroll-area, sidebar, breadcrumb, pagination, stepper, page-header, dock, portal, separator

## Build Pipeline Overview

For contributors maintaining the registry:

```
packages/ui/src/components/    (source components)
        |
        v
packages/ui/build-registry.mjs  (rewrites deep imports to relative)
        |
        v
packages/ui/registry/constructive/  (rewritten source files)
        |
        v
apps/registry/scripts/build.mjs  (copies + merges registry.json)
        |
        v
shadcn build                     (generates JSON manifests)
        |
        v
apps/registry/public/r/*.json   (static JSON files)
        |
        v
GitHub Pages                     (deployed via registry.yaml workflow)
```

Key files:
- `packages/ui/build-registry.mjs` -- import rewriting logic
- `apps/registry/scripts/build.mjs` -- source aggregation and merge
- `apps/registry/registry.json` -- component manifest definitions
- `.github/workflows/registry.yaml` -- CI/CD deployment

To add a new component to the registry:
1. Create the component in `packages/ui/src/components/`
2. Add its entry to `apps/registry/registry.json`
3. Run `pnpm --filter @constructive-io/registry build`
4. Verify the output in `apps/registry/public/r/`

## Troubleshooting

### Missing peer dependencies

Some components require peer dependencies. If `npx shadcn add` succeeds but the component errors at runtime:

```bash
# Common peer dependencies
pnpm add @base-ui/react          # Most overlay/form components
pnpm add lucide-react             # Icon components
pnpm add motion @use-gesture/react  # Stack component
pnpm add sonner                   # Toast notifications
pnpm add vaul                     # Drawer component
pnpm add react-aria-components @internationalized/date  # Calendar
pnpm add react-resizable-panels   # Resizable component
```

### Stale registry content

The registry is deployed via GitHub Pages. If you see outdated components:

```bash
# Force re-fetch by using the full URL
npx shadcn@latest add https://constructive-io.github.io/dashboard/r/button.json

# Or clear the shadcn cache
rm -rf ~/.shadcn
npx shadcn@latest add @constructive/button
```

### Import conflicts between npm and registry

Do not mix npm and registry installs for the same component. If you have `@constructive-io/ui` installed via npm and also install `button` via registry, you will get duplicate React component trees.

Choose one distribution method per project:
- **npm**: Import from `@constructive-io/ui/button`
- **Registry**: Import from `@/components/ui/button`

### components.json not found

Run `npx shadcn@latest init` to create a fresh `components.json`, then add the constructive registry:

```bash
npx shadcn@latest init
```

Then manually add the `registries` key as shown in the Setup section above.

## Best Practices

- Pick one distribution method (npm or registry) per project and stick with it
- Use bundles (form-kit, overlay-kit, layout-kit) for faster initial setup
- Install the theme first (`@constructive/constructive-theme`) before components
- Keep `components.json` in version control so the team shares registry config
- After installing via registry, components are yours -- customize freely
- Re-run `npx shadcn add` to pull upstream updates (overwrites local changes)
