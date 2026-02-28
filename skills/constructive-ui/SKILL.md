---
name: constructive-ui
description: Build UIs with the @constructive-io/ui component library. Use when working with Constructive UI components, Base UI primitives, cva variants, Tailwind CSS v4 theming, forms, overlays, layout, animations, advanced inputs, or the shadcn registry. Covers 50+ components across forms, overlays, layout, data display, and advanced inputs.
compatibility: React 19, Next.js 15+, @constructive-io/ui, Tailwind CSS v4
metadata:
  author: constructive-io
  version: "1.0.0"
---

# Constructive UI

Build UIs with `@constructive-io/ui` — 50+ components on Base UI + Tailwind CSS v4.

## When to Apply

- Building UIs with `@constructive-io/ui` components
- Creating custom components with cva/cn/data-slot
- Setting up theming, dark mode, OKLCH tokens
- Building forms, overlays, layouts, advanced inputs
- Using the shadcn registry
- Adding animations with motion/react

## Quick Start

### Deep Import Convention

```tsx
// Correct — tree-shakeable
import { Button } from '@constructive-io/ui/button';
import { Dialog, DialogTrigger, DialogPopup } from '@constructive-io/ui/dialog';
import { cn } from '@constructive-io/ui/lib/utils';

// Avoid — barrel import pulls entire library
import { Button } from '@constructive-io/ui';
```

### PortalRoot Setup (Required)

All overlay components (dialogs, popovers, tooltips, sheets) require `PortalRoot` in your root layout:

```tsx
import { PortalRoot } from '@constructive-io/ui/portal';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PortalRoot />
      </body>
    </html>
  );
}
```

### Toaster Setup

Add `Toaster` to your root layout for toast notifications:

```tsx
import { Toaster } from '@constructive-io/ui/sonner';
// Place <Toaster /> alongside <PortalRoot /> in your body
```

## Component Architecture

Every component follows: `cva` for variant definitions, `cn()` for class merging, `data-slot` on root, named exports.

```tsx
'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@constructive-io/ui/lib/utils';

const myVariants = cva('base-classes', {
  variants: { variant: { default: '...', secondary: '...' } },
  defaultVariants: { variant: 'default' },
});

type MyProps = React.ComponentProps<'div'> & VariantProps<typeof myVariants>;

function MyComponent({ className, variant, ...props }: MyProps) {
  return <div data-slot="my-component" className={cn(myVariants({ variant }), className)} {...props} />;
}

export { MyComponent, myVariants, type MyProps };
```

Key rules:
- `React.ComponentProps<'element'>` over `React.HTMLAttributes`
- Always set `data-slot` on root element
- `cn()` to merge className — never concatenate
- Named exports only, `'use client'` when using hooks/events
- `Slot` + `Slottable` from `@constructive-io/ui/lib/utils` for polymorphic `asChild`

See [references/foundations.md](references/foundations.md) for full patterns, Base UI mapping, TypeScript conventions.

## Theming & Tokens

OKLCH token system in `globals.css` with `@theme inline` for Tailwind v4.

### Key Tokens

| Category | Tokens |
|----------|--------|
| Surface | `background`, `foreground`, `card`, `popover` |
| Interactive | `primary`, `secondary`, `accent`, `muted`, `destructive` |
| Status | `info`, `success`, `warning` |
| Input | `border`, `input`, `ring` |
| Sidebar | `sidebar`, `sidebar-primary`, `sidebar-accent`, `sidebar-border` |
| Chart | `chart-1` through `chart-5` |

### Dark Mode

Class-based via `.dark` on `<html>`. Tailwind v4 directive: `@custom-variant dark (&:is(.dark *));`

```tsx
// Toggle implementation
document.documentElement.classList.toggle('dark', isDark);
localStorage.setItem('theme', isDark ? 'dark' : 'light');
```

### Tailwind v4 Migration

| v3 | v4 |
|----|----|
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| `rounded-sm` | `rounded-xs` |
| `rounded` | `rounded-sm` |
| `outline-none` | `outline-hidden` |
| `bg-opacity-*` | `bg-black/50` |
| `bg-[--brand]` | `bg-(--brand)` |

See [references/theming.md](references/theming.md) for complete globals.css, z-index layers, shadow utilities.
See [references/token-values.md](references/token-values.md) for all light/dark OKLCH values.

## Registry Installation

Install components via shadcn registry or npm.

```json
// components.json — add constructive registry
{
  "registries": {
    "@constructive": "https://constructive-io.github.io/dashboard/r/{name}.json"
  }
}
```

```bash
npx shadcn@latest add @constructive/button
npx shadcn@latest add @constructive/form-kit      # all form components
npx shadcn@latest add @constructive/overlay-kit    # all overlay components
npx shadcn@latest add @constructive/layout-kit     # all layout components
npx shadcn@latest add @constructive/constructive-theme  # full token system
```

**npm** = centralized updates, version-locked. **Registry** = source ownership, deep customization.

See [references/registry.md](references/registry.md) for full component list, bundles, build pipeline.

## Animation System

Import from `motion/react` (NOT `framer-motion`). Use presets from `@constructive-io/ui/lib/motion/motion-config`.

| Preset | Use For |
|--------|---------|
| `variants.fadeScale` | Modal/dialog enter |
| `variants.fadeSlideUp` | List items with stagger |
| `variants.fadeSlideDown` | Toast/notification |
| `variants.fade` | Subtle presence change |
| `variants.floatUp` | Hero entrance |
| `transitions.panel` | Sheet/drawer slide |
| `springs.snappy` | Button press (`whileTap`) |
| `transitions.enterExit` | Tab/route transitions |

```tsx
'use client';
import { motion, AnimatePresence } from 'motion/react';
import { variants } from '@constructive-io/ui/lib/motion/motion-config';

<AnimatePresence mode="wait">
  {isOpen && (
    <motion.div key="panel" variants={variants.fadeScale} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  )}
</AnimatePresence>
```

See [references/motion.md](references/motion.md) for all presets, stagger patterns, reduced motion, performance rules.

## Forms

Three layers: **Field** (standalone labels), **FormControl** (floating labels), **Form** (react-hook-form).

```tsx
// Layer 1: Field — simple label + input
import { Field } from '@constructive-io/ui/field';
import { Input } from '@constructive-io/ui/input';

<Field label="Email" error={errors.email} required>
  <Input type="email" placeholder="name@example.com" />
</Field>

// Layer 3: Form — react-hook-form integration
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@constructive-io/ui/form';

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField control={form.control} name="email" render={({ field }) => (
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl><Input {...field} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  </form>
</Form>
```

**InputGroup** for addons: `InputGroupAddon` with `position="inline-start|inline-end|block-start|block-end"`.

See [references/forms.md](references/forms.md) for all form patterns, Zod validation, composition examples.
See [references/input-components.md](references/input-components.md) for Input, Textarea, Checkbox, RadioGroup, Switch, Select API.

## Overlays

| Component | Use When |
|-----------|----------|
| **Dialog** | Modal form, confirmation, focused content |
| **AlertDialog** | Destructive confirmation (blocks interaction) |
| **Sheet** | Side panel for details, editing |
| **Popover** | Contextual info/controls, filter panels |
| **Tooltip** | Brief hints on hover/focus |
| **DropdownMenu** | Action menus, context menus |
| **Command** | Command palette (Cmd+K), search-driven command execution |

```tsx
// Dialog
import { Dialog, DialogTrigger, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@constructive-io/ui/dialog';

<Dialog>
  <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
  <DialogPopup>
    <DialogHeader><DialogTitle>Title</DialogTitle></DialogHeader>
    {/* content */}
    <DialogFooter><Button>Save</Button></DialogFooter>
  </DialogPopup>
</Dialog>

// Sheet
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@constructive-io/ui/sheet';

<Sheet>
  <SheetTrigger asChild><Button>Open Panel</Button></SheetTrigger>
  <SheetContent side="right">{/* content */}</SheetContent>
</Sheet>
```

Floating elements inside modals auto-elevate z-index via `useFloatingOverlayPortalProps()`.

See [references/overlays.md](references/overlays.md) for all overlay components, nesting patterns.
See [references/sheet-stacking.md](references/sheet-stacking.md) for SheetStackProvider deep dive.
See [references/dropdown-menu-api.md](references/dropdown-menu-api.md) for DropdownMenu sub-component API.
See [references/command-palette.md](references/command-palette.md) for full command palette system — registry, hooks, multi-step wizards, background tasks, keyboard shortcuts.

## Layout & Navigation

```tsx
// Sidebar — full app shell
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarInset, SidebarTrigger } from '@constructive-io/ui/sidebar';

<SidebarProvider>
  <Sidebar>
    <SidebarContent>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive tooltip="Home"><Home className="size-4" /><span>Home</span></SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarContent>
  </Sidebar>
  <SidebarInset>{/* main content */}</SidebarInset>
</SidebarProvider>

// Tabs
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@constructive-io/ui/tabs';

<Tabs defaultValue="general">
  <TabsList>
    <TabsTrigger value="general">General</TabsTrigger>
    <TabsTrigger value="security">Security</TabsTrigger>
  </TabsList>
  <TabsContent value="general">...</TabsContent>
  <TabsContent value="security">...</TabsContent>
</Tabs>
```

Also: Breadcrumb, Pagination, Stepper, Collapsible, Resizable, ScrollArea, PageHeader, Dock.

### Stack Navigation (iOS-Style Card Navigation)

The primary navigation pattern in the Constructive admin app. Cards push/pop from the right with peek interactions, gestures, and responsive layout.

```tsx
import { CardStackProvider, useCardStack, CardStackViewport } from '@constructive-io/ui/stack';

// Root layout — wraps entire app
<CardStackProvider layoutMode="side-by-side" defaultPeekOffset={48}>
  {children}
  <ClientOnlyStackViewport />
</CardStackProvider>

// Push cards imperatively
const stack = useCardStack();
stack.push({ title: 'Profile', Component: ProfileCard, props: { userId } });
```

Layout modes: `cascade` (overlapping peek) and `side-by-side` (master-detail). Cards support `useCardReady()` to defer queries until slide animation completes.

See [references/stack-navigation.md](references/stack-navigation.md) for full Stack API — CardSpec, CardStackApi, route registry, peek gestures, mobile behavior.

See [references/layout.md](references/layout.md) for all layout components.
See [references/sidebar-api.md](references/sidebar-api.md) for Sidebar sub-component props, CSS variables.

## Data Display & Feedback

```tsx
// Badge variants
import { Badge } from '@constructive-io/ui/badge';
<Badge variant="success">Active</Badge>
<Badge variant="destructive">Error</Badge>
<Badge variant="warning">Pending</Badge>

// Table
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@constructive-io/ui/table';

// Toast
import { showSuccessToast, showErrorToast } from '@constructive-io/ui/toast';
showSuccessToast('Saved');
showErrorToast('Failed', 'Please try again');
```

Also: Alert, Avatar, Skeleton, Progress, FlickeringGrid, MotionGrid, ProgressiveBlur.

See [references/data-display.md](references/data-display.md) for all data display components.

## Advanced Inputs

| Need | Component |
|------|-----------|
| Search + select one | **Autocomplete** (simple) or **Combobox** (richer) |
| Search + select multiple | **Combobox** `multiple` or **MultiSelect** |
| Tag-style multi-picker | **Tags** (create-on-enter) |
| Link/unlink records | **RecordPicker** (fuzzy search, checkboxes) |
| Date selection | **Calendar** / **RangeCalendar** |
| JSON editing | **JsonInput** (with validation) |

```tsx
// Combobox
import { Combobox, ComboboxInput, ComboboxTrigger, ComboboxContent, ComboboxItem, ComboboxList } from '@constructive-io/ui/combobox';

<Combobox value={value} onValueChange={setValue}>
  <ComboboxTrigger><ComboboxInput placeholder="Select..." /></ComboboxTrigger>
  <ComboboxContent>
    <ComboboxList>
      {items.map((item) => <ComboboxItem key={item.value} value={item.value}>{item.label}</ComboboxItem>)}
    </ComboboxList>
  </ComboboxContent>
</Combobox>
```

See [references/advanced-inputs.md](references/advanced-inputs.md) for all advanced input components.
See [references/combobox-api.md](references/combobox-api.md) for Combobox sub-component props, multiple mode, useComboboxFilter.

## Component Catalog

### Primitives
`button`, `badge`, `label`, `skeleton`, `card` ([patterns](references/card-patterns.md)), `separator`, `alert`

### Form
`input`, `textarea`, `checkbox`, `checkbox-group`, `radio-group`, `switch`, `select`, `progress`, `form`, `form-control`, `input-group`, `field`

### Overlay
`dialog`, `alert-dialog`, `sheet`, `drawer`, `popover`, `tooltip`, `dropdown-menu`, `command`

### Layout
`tabs`, `collapsible`, `scroll-area`, `resizable`, `sidebar`, `breadcrumb`, `pagination`, `stepper`, `page-header`, `dock`

### Data
`table`, `avatar`

### Advanced Inputs
`autocomplete`, `combobox`, `multi-select`, `tags`, `record-picker`, `calendar-rac`, `json-input`

### Notifications
`sonner`, `toast`

### Navigation
`stack` ([full reference](references/stack-navigation.md))

### Utilities
`portal`, `lib/utils` (cn, Slot, Slottable, composeRefs, mergeProps, useControllableState), `lib/motion/motion-config`, `globals.css`

### Effects
`flickering-grid`, `motion-grid`, `progressive-blur`, `progressive-blur-scroll-container`, `responsive-diagram`

All imported via `@constructive-io/ui/{name}`.

## Best Practices

- **Imports**: Always use deep imports (`@constructive-io/ui/button`), never barrel imports
- **Components**: Named exports only, `data-slot` on root, `cn()` for class merging, `...props` spread
- **Types**: `React.ComponentProps<'element'>` over `React.HTMLAttributes`
- **Client**: `'use client'` on any component using hooks, events, or browser APIs
- **Tailwind v4**: `shadow-xs` not `shadow-sm`, `rounded-xs` not `rounded-sm`, `bg-black/50` not `bg-opacity-*`
- **Tokens**: Use semantic tokens (`bg-primary`) not raw colors (`bg-blue-500`), define light+dark for custom tokens
- **Z-index**: Use layer variables (`--z-layer-floating`), never hardcode values
- **Animation**: Use `motion-config` presets, respect `prefers-reduced-motion`
- **Forms**: `Field` for simple forms, `Form`+`FormField` for validation, `zodResolver` over inline rules
- **Overlays**: `asChild` on triggers, `PortalRoot` required, `AlertDialog` for destructive confirms
- **Icons**: `size-4` shorthand over `w-4 h-4`

## References

- [references/foundations.md](references/foundations.md) — Component architecture: cva, cn, Slot, data-slot, Base UI mapping
- [references/theming.md](references/theming.md) — OKLCH tokens, globals.css, dark mode, z-index layers, Tailwind v4 migration
- [references/token-values.md](references/token-values.md) — Complete light/dark OKLCH token value table
- [references/registry.md](references/registry.md) — shadcn registry setup, npm vs registry, bundles, troubleshooting
- [references/motion.md](references/motion.md) — motion/react presets, AnimatePresence, springs, reduced motion
- [references/forms.md](references/forms.md) — Field, FormControl, Form (react-hook-form), InputGroup patterns
- [references/input-components.md](references/input-components.md) — Input, Textarea, Checkbox, RadioGroup, Switch, Select API
- [references/overlays.md](references/overlays.md) — Dialog, AlertDialog, Sheet, Popover, Tooltip, DropdownMenu
- [references/sheet-stacking.md](references/sheet-stacking.md) — SheetStackProvider modes, useSheetStack, nested sheets
- [references/dropdown-menu-api.md](references/dropdown-menu-api.md) — DropdownMenu sub-component props reference
- [references/layout.md](references/layout.md) — Sidebar, Tabs, Breadcrumb, Pagination, Stepper, Collapsible, Resizable
- [references/sidebar-api.md](references/sidebar-api.md) — Sidebar sub-component props, CSS variables, cookie persistence
- [references/data-display.md](references/data-display.md) — Table, Badge, Alert, Avatar, Skeleton, Progress, Toast, effects
- [references/advanced-inputs.md](references/advanced-inputs.md) — Autocomplete, Combobox, MultiSelect, Tags, RecordPicker, Calendar, JsonInput
- [references/combobox-api.md](references/combobox-api.md) — Combobox sub-component props, multiple mode, useComboboxFilter
- [references/command-palette.md](references/command-palette.md) — Full command palette system: registry, hooks, multi-step wizards, background tasks, keyboard shortcuts
- [references/card-patterns.md](references/card-patterns.md) — Card variants (default/elevated/flat/ghost/interactive), usage patterns, grid layouts
- [references/stack-navigation.md](references/stack-navigation.md) — iOS-style card navigation: CardStackApi, route registry, peek gestures, mobile behavior
