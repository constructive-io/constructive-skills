# Constructive UI composition

Constructive UI provides Base UI primitives styled with Tailwind CSS v4 and OKLCH design tokens. This reference covers composition conventions; use [`constructive-blocks`](../../constructive-blocks/SKILL.md) for the canonical registry catalog and installation plan.

## Consumption model

Use deep package imports when consuming `@constructive-io/ui`:

```tsx
import { Button } from '@constructive-io/ui/button';
import { Dialog, DialogPopup, DialogTrigger } from '@constructive-io/ui/dialog';
import { cn } from '@constructive-io/ui/lib/utils';
```

Avoid the package barrel because it widens the client bundle and obscures component ownership:

```tsx
// Avoid
import { Button, Dialog } from '@constructive-io/ui';
```

When the application needs editable source, install the corresponding registry item through the configured `@constructive` namespace. Do not mix npm and registry ownership for the same primitive.

## Component conventions

Custom components that extend the system should:

- derive native props with `React.ComponentProps<'element'>`;
- merge classes with `cn()`;
- put a stable `data-slot` on the root and meaningful subparts;
- keep `cva` variants close to the component;
- use named exports;
- add `'use client'` only for browser state, effects, or event handlers;
- preserve Base UI semantics, keyboard behavior, focus rings, and reduced motion;
- keep application-level component props explicit; only generic primitives should forward the full native prop surface.

```tsx
'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@constructive-io/ui/lib/utils';

const noticeVariants = cva('rounded-lg border px-4 py-3 text-sm', {
  variants: {
    tone: {
      neutral: 'bg-card text-card-foreground',
      warning: 'border-warning/30 bg-warning/10 text-warning-foreground'
    }
  },
  defaultVariants: { tone: 'neutral' }
});

type NoticeProps = Pick<React.ComponentProps<'div'>, 'children' | 'className'> &
  VariantProps<typeof noticeVariants>;

export function Notice({ children, className, tone }: NoticeProps) {
  return (
    <div
      data-slot="notice"
      className={cn(noticeVariants({ tone }), className)}
    >
      {children}
    </div>
  );
}
```

## Application foundations

Import the package Tailwind foundation when using the npm distribution:

```css
@import '@constructive-io/ui/globals.css';
```

Registry installs copy the required theme source into the consumer. In either model, use semantic tokens such as `background`, `foreground`, `card`, `muted`, `primary`, `destructive`, and the sidebar token family instead of fixed palette utilities.

Overlays need a stable portal target and toast viewport at the application root. Follow the installed source's exported component names rather than copying an older provider snippet.

## Reference map

| Topic | Reference |
|---|---|
| Component foundations and polymorphic composition | [ui-foundations.md](./ui-foundations.md) |
| Forms and form controls | [ui-forms.md](./ui-forms.md), [ui-input-components.md](./ui-input-components.md) |
| Dialogs, sheets, popovers, tooltips, and menus | [ui-overlays.md](./ui-overlays.md), [ui-dropdown-menu-api.md](./ui-dropdown-menu-api.md) |
| App layout, sidebar, and navigation | [ui-layout.md](./ui-layout.md), [ui-sidebar-api.md](./ui-sidebar-api.md), [ui-stack-navigation.md](./ui-stack-navigation.md) |
| Tables, cards, status, and feedback | [ui-data-display.md](./ui-data-display.md), [ui-card-patterns.md](./ui-card-patterns.md) |
| Advanced inputs | [ui-advanced-inputs.md](./ui-advanced-inputs.md), [ui-combobox-api.md](./ui-combobox-api.md) |
| Command palette | [ui-command-palette.md](./ui-command-palette.md) |
| Sheet stacking | [ui-sheet-stacking.md](./ui-sheet-stacking.md) |
| Motion and reduced-motion behavior | [ui-motion.md](./ui-motion.md) |
| Theme composition and token values | [ui-theming.md](./ui-theming.md), [ui-token-values.md](./ui-token-values.md) |
| Registry namespace and update behavior | [ui-registry.md](./ui-registry.md) |
