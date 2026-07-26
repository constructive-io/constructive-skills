# Sidebar API

Use this reference after installing `app-shell`, `app-bar`, or `sidebar`
through the pinned Blocks local-consumption workflow. The examples use the
conventional source alias; substitute the alias in the consumer's
`components.json` when it differs.

## Provider and state

`SidebarProvider` owns desktop and mobile state in one context:

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `defaultOpen` | `boolean` | `true` | Initial uncontrolled desktop state |
| `open` | `boolean` | — | Controlled desktop state |
| `onOpenChange` | `(open: boolean) => void` | — | Controlled desktop change callback |

`useSidebar()` returns `state`, `open`, `setOpen`, `openMobile`,
`setOpenMobile`, `isMobile`, and `toggleSidebar`. `state` is derived from the
desktop `open` value and is either `expanded` or `collapsed`.

Use one state model:

```tsx
'use client';

import * as React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';

export function UncontrolledSidebar({
  children,
  defaultOpen
}: Readonly<{
  children: React.ReactNode;
  defaultOpen: boolean;
}>) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      {children}
    </SidebarProvider>
  );
}

export function ControlledSidebar({
  children,
  defaultOpen
}: Readonly<{
  children: React.ReactNode;
  defaultOpen: boolean;
}>) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <SidebarProvider open={open} onOpenChange={setOpen}>
      {children}
    </SidebarProvider>
  );
}
```

## Cookie hydration

The provider writes `sidebar_state=true|false` with `path=/` and a seven-day
maximum age when desktop state changes. It does not read that cookie. Read it
in the Next.js 16 server layout and pass the result as `defaultOpen` or
`defaultSidebarOpen`; this prevents the first client render from guessing a
different state.

```tsx
import { cookies } from 'next/headers';

import { TenantShell } from './tenant-shell';

export default async function TenantLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_state');
  const defaultSidebarOpen = sidebarCookie?.value !== 'false';

  return (
    <TenantShell defaultSidebarOpen={defaultSidebarOpen}>
      {children}
    </TenantShell>
  );
}
```

Controlled desktop changes still go through the provider, so it invokes
`onOpenChange` and writes the cookie. Mobile state is separate, starts closed,
and is not persisted by this cookie.

## Sidebar variants and collapse modes

`Sidebar` accepts independent presentation and collapse props:

| Prop | Values | Default |
|---|---|---|
| `side` | `left`, `right` | `left` |
| `variant` | `sidebar`, `floating`, `inset` | `sidebar` |
| `collapsible` | `offcanvas`, `icon`, `none` | `offcanvas` |

`variant="floating"` adds an inset frame, rounded inner panel, ring, and
shadow. `variant="inset"` also frames the sidebar and makes `SidebarInset` a
rounded content surface on desktop. `variant` does not select icon collapse.

`collapsible="offcanvas"` moves the desktop sidebar out of view when closed.
`collapsible="icon"` contracts it to `--sidebar-width-icon`. Expansion happens
only through provider state changes, the trigger, rail, or keyboard shortcut;
hover does not expand it. `collapsible="none"` renders a fixed sidebar on every
viewport and bypasses the mobile Sheet behavior.

For the collapsible modes, mobile renders a Sheet with its own `openMobile`
state and an `18rem` width. `SidebarTrigger` toggles mobile state on mobile and
desktop state otherwise, while `Cmd+B` or `Ctrl+B` follows the same rule. Use
`setOpenMobile(false)` after accepted custom navigation when the host owns the
link rendering.

## Navigation composition

Compose custom router links with Base UI's `render` prop:

```tsx
'use client';

import Link from 'next/link';
import { HomeIcon } from 'lucide-react';

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@/components/ui/sidebar';

export function PrimaryNavigation() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive
          tooltip="Home"
          render={<Link href="/home" />}
        >
          <HomeIcon aria-hidden="true" />
          <span>Home</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
```

`SidebarMenuButton` supports `default`, `sm`, and `lg` sizes, `default` and
`outline` variants, active state, and a collapsed-mode tooltip.
`SidebarMenuAction` is a separate action and can use `showOnHover`; that prop
only changes action visibility and never sidebar expansion.

## Structure and sizing

Use `SidebarHeader` and `SidebarFooter` for pinned regions,
`SidebarContent` for the scrollable region, and
`SidebarGroup`/`SidebarGroupContent`/`SidebarMenu` for navigation. Place the
main column in `SidebarInset` and toggle with `SidebarTrigger`. `SidebarRail`
provides the desktop edge control.

The expanded desktop width is `--sidebar-width` (`16rem` by default) and the
icon width is `--sidebar-width-icon` (`3rem` by default). Override them through
provider or AppShell styles; the mobile Sheet uses its component-local `18rem`
value.
