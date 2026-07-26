# Constructive UI foundations

Build custom UI on the same foundation as the pinned Blocks source: Next.js 16
App Router, React Server Components, shadcn `4.13.1` with `base-nova`, Base UI,
Tailwind CSS v4, OKLCH semantic tokens, and Lucide icons.

The current UI package and registry are branch-only. Complete the
`constructive-blocks` pinned local-consumption workflow before using the
imports in this reference.

## Server and client boundaries

Keep pages, layouts, metadata reads, and data preparation in server components.
Add `'use client'` only to a boundary that uses browser state, effects, event
handlers, or a client-only Constructive primitive. Pass serializable data into
that boundary and keep credentials in the host's server/session layer.

## Source ownership and imports

Prefer the consumer aliases installed by the local `@constructive` registry:

```tsx
import { Button } from '@/components/ui/button';
import { Dialog, DialogPopup, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
```

When the pinned local package registry owns the component, use an exported
subpath:

```tsx
import { Button } from '@constructive-io/ui/button';
import { Dialog } from '@constructive-io/ui/dialog';
```

Utilities that are not package subpaths are available from the valid package
root, but source-installed application components should use their local
utility alias.

## Explicit application components

Keep application-level prop surfaces explicit. Use `cva` for genuine visual
variants, `cn()` for class composition, semantic tokens for color, and stable
`data-slot` values for structure.

```tsx
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const noticeVariants = cva('rounded-lg border px-4 py-3 text-sm', {
  variants: {
    tone: {
      neutral: 'bg-card text-card-foreground',
      warning: 'border-warning/30 bg-warning/10 text-warning-foreground'
    }
  },
  defaultVariants: {
    tone: 'neutral'
  }
});

type NoticeProps = Readonly<{
  children: React.ReactNode;
  className?: string;
  id?: string;
  tone?: VariantProps<typeof noticeVariants>['tone'];
}>;

export function Notice({ children, className, id, tone }: NoticeProps) {
  return (
    <div
      id={id}
      data-slot="notice"
      className={cn(noticeVariants({ tone }), className)}
    >
      {children}
    </div>
  );
}
```

Use broad native prop forwarding only for a reusable primitive whose contract
actually promises the native surface. Domain views should name the props they
support so invalid states and accidental DOM attributes do not become API.

## Base UI composition

Use Base UI's `render` prop to replace a default element while preserving the
primitive's semantics and event merging. Do not wrap a trigger in an extra
interactive element.

```tsx
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { SidebarMenuButton } from '@/components/ui/sidebar';

<>
  <Dialog>
    <DialogTrigger render={<Button />}>Open settings</DialogTrigger>
    <DialogPopup>
      <DialogTitle>Settings</DialogTitle>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>
          Cancel
        </DialogClose>
      </DialogFooter>
    </DialogPopup>
  </Dialog>

  <SidebarMenuButton render={<Link href="/settings" />}>
    Settings
  </SidebarMenuButton>
</>
```

For a custom polymorphic primitive, use Base UI's `useRender` and keep its
state attributes explicit:

```tsx
'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';

import { cn } from '@/lib/utils';

type ActionSurfaceProps = Readonly<{
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  render?: useRender.ComponentProps<'button'>['render'];
}>;

export function ActionSurface({
  children,
  className,
  disabled,
  render
}: ActionSurfaceProps) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>({
      children,
      className: cn('rounded-lg px-3 py-2', className),
      disabled,
      type: 'button'
    }),
    render,
    state: {
      slot: 'action-surface'
    }
  });
}
```

## State and accessibility

- Use controlled props plus change callbacks when the host owns state; use a
  `defaultValue` only for genuinely local state.
- Preserve focus rings, keyboard interaction, labels, titles, descriptions,
  `aria-invalid`, and reduced-motion behavior supplied by the primitive.
- Keep `DialogTitle`, `SheetTitle`, and equivalent accessible names even when
  they are visually hidden.
- Use Lucide components directly and mark decorative icons
  `aria-hidden="true"`.
- Use `data-state` and `data-slot` for stateful styling instead of brittle
  descendant class selectors.

## Portal root

Mount one portal root in the server layout so overlays share the intended
stacking container. Base UI can fall back to `document.body` while the root is
unavailable, but the explicit root keeps Constructive's z-layer policy stable.

```tsx
import { PortalRoot } from '@/components/ui/portal';

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
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

## Styling rules

Use Tailwind v4 semantic utilities such as `bg-background`, `text-foreground`,
`bg-card`, `text-muted-foreground`, and `border-border`. Use `gap-*` for
spacing, `size-*` for equal dimensions, and motion-reduction variants for
transitions. Keep `cva` definitions beside the primitive and use named exports.
