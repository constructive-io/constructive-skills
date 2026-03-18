Core architecture patterns for building and extending @constructive-io/ui components.

## Component Architecture Pattern

Every component follows a consistent structure: cva for variant definitions, cn() for class merging, data-slot on root, named exports.

```tsx
'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@constructive-io/ui/lib/utils';

const myComponentVariants = cva('base-classes', {
  variants: {
    variant: {
      default: 'variant-classes',
      secondary: 'secondary-classes',
    },
    size: {
      sm: 'size-sm-classes',
      default: 'size-default-classes',
      lg: 'size-lg-classes',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

type MyComponentProps = React.ComponentProps<'div'> &
  VariantProps<typeof myComponentVariants> & {
    customProp?: string;
  };

function MyComponent({ className, variant, size, customProp, ...props }: MyComponentProps) {
  return (
    <div
      data-slot="my-component"
      className={cn(myComponentVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { MyComponent, myComponentVariants, type MyComponentProps };
```

Key rules:
- Always use `React.ComponentProps<'element'>` over `React.HTMLAttributes`
- Always set `data-slot` on the root element
- Always use `cn()` to merge className -- never concatenate strings
- Always forward unknown props via `...props` spread
- Always use named exports, never default exports
- Keep variant definitions close to the component, not in separate files
- Use cva only when a component genuinely has visual variants

## Deep Import Convention

```tsx
// Correct -- tree-shakeable, individual subpath
import { Button } from '@constructive-io/ui/button';
import { Dialog, DialogTrigger, DialogPopup } from '@constructive-io/ui/dialog';
import { cn } from '@constructive-io/ui/lib/utils';

// Avoid -- barrel import pulls entire library
import { Button, Dialog } from '@constructive-io/ui';
```

### Available Subpath Exports

Primitives: `button`, `badge`, `label`, `skeleton`, `card`, `separator`, `alert`

Form: `input`, `textarea`, `checkbox`, `checkbox-group`, `radio-group`, `switch`, `select`, `progress`, `form`, `form-control`, `input-group`, `field`

Overlay: `tooltip`, `popover`, `dialog`, `alert-dialog`, `dropdown-menu`, `sheet`, `drawer`, `command`

Layout: `tabs`, `collapsible`, `scroll-area`, `resizable`, `sidebar`, `breadcrumb`, `pagination`, `stepper`, `page-header`, `dock`

Data: `table`, `avatar`

Advanced inputs: `autocomplete`, `combobox`, `multi-select`, `tags`, `record-picker`, `calendar-rac`, `json-input`

Notifications: `sonner`, `toast`

Navigation: `stack`

Utilities: `portal`, `lib/utils`, `lib/motion/motion-config`, `globals.css`

## The asChild / Slot / Slottable Pattern

The library exports `Slot` and `Slottable` from `@constructive-io/ui/lib/utils`. These enable polymorphic rendering -- a component can render as any element the consumer provides.

```tsx
'use client';

import { Slot, Slottable } from '@constructive-io/ui/lib/utils';
import { cn } from '@constructive-io/ui/lib/utils';

type PolymorphicButtonProps = React.ComponentProps<'button'> & {
  asChild?: boolean;
  leftIcon?: React.ReactNode;
};

function PolymorphicButton({
  asChild,
  leftIcon,
  children,
  className,
  ...props
}: PolymorphicButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp className={cn('btn-classes', className)} {...props}>
      {leftIcon && <span data-slot="icon">{leftIcon}</span>}
      <Slottable>{children}</Slottable>
    </Comp>
  );
}

export { PolymorphicButton, type PolymorphicButtonProps };
```

Usage -- renders as an `<a>` tag instead of `<button>`:

```tsx
import { LinkIcon } from 'lucide-react';

<PolymorphicButton asChild leftIcon={<LinkIcon />}>
  <a href="/page">Go to page</a>
</PolymorphicButton>
```

How it works:
- `Slot` merges props and refs from the wrapper onto the child element
- `Slottable` marks where the child's own children go within wrapper markup
- Also exported: `composeRefs` for merging multiple refs and `mergeProps` for merging event handlers

## Base UI Primitive Relationship

Components are built on `@base-ui/react` primitives. The library wraps these with styling, variants, and consistent API surface.

### Components built on Base UI

| UI Component | Base UI Primitive |
|---|---|
| Dialog, DialogTrigger, DialogPopup | `@base-ui/react/dialog` |
| AlertDialog | `@base-ui/react/alert-dialog` |
| Tooltip | `@base-ui/react/tooltip` |
| Popover | `@base-ui/react/popover` |
| DropdownMenu | `@base-ui/react/menu` |
| Select | `@base-ui/react/select` |
| Checkbox | `@base-ui/react/checkbox` |
| Switch | `@base-ui/react/switch` |
| RadioGroup | `@base-ui/react/radio-group` |
| Progress | `@base-ui/react/progress` |
| Tabs | `@base-ui/react/tabs` |
| Collapsible | `@base-ui/react/collapsible` |
| ScrollArea | `@base-ui/react/scroll-area` |
| Separator | `@base-ui/react/separator` |
| Avatar | `@base-ui/react/avatar` |
| Input | `@base-ui/react/input` |
| Autocomplete | `@base-ui/react/autocomplete` |
| Combobox | `@base-ui/react/combobox` |

### Custom implementations (no Base UI primitive)

Button, Badge, Card, Alert, Table, Breadcrumb, Pagination, Stepper, MultiSelect, Tags, RecordPicker, JsonInput, Sidebar, Stack, Toast

## data-slot Convention

Every component sets `data-slot` on its root element. This enables CSS targeting without fragile class selectors:

```css
/* Target card title globally */
[data-slot="card-title"] {
  @apply text-lg font-semibold;
}

/* Target within a specific context */
.dashboard [data-slot="card-content"] {
  @apply p-4;
}
```

### Common data-slot Values

| Component | Slots |
|---|---|
| Button | `button` |
| Card | `card`, `card-header`, `card-title`, `card-description`, `card-action`, `card-content`, `card-footer` |
| Badge | `badge` |
| Alert | `alert`, `alert-title`, `alert-description` |
| Input | `input` |
| Table | `table`, `table-header`, `table-body`, `table-footer`, `table-row`, `table-head`, `table-cell`, `table-caption` |
| Dialog | `dialog-overlay`, `dialog-content`, `dialog-header`, `dialog-footer`, `dialog-title`, `dialog-description`, `dialog-close` |
| Sidebar | `sidebar`, `sidebar-header`, `sidebar-footer`, `sidebar-content`, `sidebar-group`, `sidebar-group-label`, `sidebar-menu`, `sidebar-menu-button`, `sidebar-menu-item`, `sidebar-trigger` |

## TypeScript Patterns

### Export convention

Always export the component function, the variant function, and the props type:

```tsx
export { MyComponent, myComponentVariants, type MyComponentProps };
```

### Extracting variant types

```tsx
import type { VariantProps } from 'class-variance-authority';
type Props = VariantProps<typeof myComponentVariants>;
// Props = { variant?: 'default' | 'secondary'; size?: 'sm' | 'default' | 'lg' }
```

### Extending HTML elements

```tsx
type InputProps = React.ComponentProps<'input'> & {
  error?: string;
};

function Input({ error, className, ...props }: InputProps) {
  return (
    <div>
      <input
        data-slot="input"
        className={cn('input-base', error && 'border-destructive', className)}
        {...props}
      />
      {error && <p data-slot="input-error" className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
```

### Compound component typing

```tsx
type CardProps = React.ComponentProps<'div'> & VariantProps<typeof cardVariants>;
type CardHeaderProps = React.ComponentProps<'div'>;
type CardTitleProps = React.ComponentProps<'h3'>;

function Card({ className, variant, ...props }: CardProps) { /* ... */ }
function CardHeader({ className, ...props }: CardHeaderProps) { /* ... */ }
function CardTitle({ className, ...props }: CardTitleProps) { /* ... */ }

export { Card, CardHeader, CardTitle, type CardProps, type CardHeaderProps, type CardTitleProps };
```

## useControllableState Hook

For components that support both controlled and uncontrolled modes:

```tsx
'use client';

import { useControllableState } from '@constructive-io/ui/lib/utils';

type ToggleProps = {
  value?: boolean;
  defaultValue?: boolean;
  onChange?: (value: boolean) => void;
  children: React.ReactNode;
};

function Toggle({ value: valueProp, defaultValue = false, onChange, children }: ToggleProps) {
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue,
    onChange,
  });

  return (
    <button
      data-slot="toggle"
      data-state={value ? 'on' : 'off'}
      onClick={() => setValue(!value)}
    >
      {children}
    </button>
  );
}

export { Toggle, type ToggleProps };
```

When `value` is provided, the component is controlled. When omitted, internal state manages the value via `defaultValue`.

## PortalRoot Setup

Required once in your root layout for overlay components (dialogs, popovers, tooltips, sheets):

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

Without `PortalRoot`, overlay components will not render.

## Complete Component Example

A production-ready status badge with variants, proper types, and data-slot:

```tsx
'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@constructive-io/ui/lib/utils';

const statusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      status: {
        active: 'bg-success/15 text-success',
        inactive: 'bg-muted text-muted-foreground',
        pending: 'bg-warning/15 text-warning',
        error: 'bg-destructive/15 text-destructive',
      },
    },
    defaultVariants: {
      status: 'active',
    },
  }
);

type StatusBadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof statusBadgeVariants> & {
    dot?: boolean;
  };

function StatusBadge({ className, status, dot = true, children, ...props }: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    >
      {dot && (
        <span
          data-slot="status-dot"
          className="h-1.5 w-1.5 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  );
}

export { StatusBadge, statusBadgeVariants, type StatusBadgeProps };
```

## Best Practices

- Always use named exports (not default)
- Always set `data-slot` on root element of custom components
- Use `cn()` to merge className -- never concatenate strings
- Forward all unknown props via `...props` spread
- Use `React.ComponentProps<'element'>` over `React.HTMLAttributes`
- Keep variant definitions close to the component, not in separate files
- Use cva only when a component genuinely has visual variants
- Add `'use client'` directive when the component uses hooks, event handlers, or browser APIs
- Prefer composition (compound components) over configuration (many props)
- Use data-state attributes for interactive state (`data-state="open"`, `data-state="checked"`)
