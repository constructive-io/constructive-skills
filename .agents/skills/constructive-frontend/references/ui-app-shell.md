# AppShell and AppBar

`AppShell` is the application-frame block: it composes navigation, branding,
account actions, breadcrumbs, responsive sidebar behavior, and `AppBar` around
page content. `AppBar` can also be used directly inside a `SidebarProvider`.

## Install from the pinned source

Resolve `app-shell` through the validated Blocks catalog; it installs
`app-bar` and its primitive closure transitively.

```bash
node /absolute/path/to/constructive-skills/.agents/skills/constructive-blocks/scripts/check-blocks-contract.mjs \
  --registry-item app-shell
```

The pinned snapshot is branch-only with `publicRegistryReady: false`, so run
the local-consumption workflow linked by `constructive-blocks`. Do not run the
catalog's public command until a released snapshot explicitly opens that gate.

## Client shell

Keep route activity and account actions explicit. `renderLink` adapts every
brand, navigation, breadcrumb, and account link to the host router; forward
the supplied click handler because AppShell uses it to close accepted mobile
navigation.

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  BoxesIcon,
  DatabaseIcon,
  LogOutIcon,
  SettingsIcon,
  UsersIcon
} from 'lucide-react';

import {
  AppShell,
  type AppNavigationGroup
} from '@/components/ui/app-shell';
import type { AppLinkRenderProps } from '@/components/ui/app-bar';

const navigation: AppNavigationGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    placement: 'main',
    items: [
      {
        id: 'data',
        label: 'Data',
        href: '/data',
        icon: DatabaseIcon,
        isActive: true
      },
      {
        id: 'members',
        label: 'Members',
        href: '/members',
        icon: UsersIcon
      }
    ]
  },
  {
    id: 'settings',
    placement: 'footer',
    items: [
      {
        id: 'settings',
        label: 'Settings',
        href: '/settings',
        icon: SettingsIcon
      }
    ]
  }
];

function renderLink(props: AppLinkRenderProps) {
  return (
    <Link
      href={props.href}
      aria-current={props['aria-current']}
      aria-disabled={props['aria-disabled']}
      className={props.className}
      onClick={props.onClick}
      tabIndex={props.tabIndex}
      target={props.target}
    >
      {props.children}
    </Link>
  );
}

export function TenantShell({
  children,
  defaultSidebarOpen,
  onSignOut
}: Readonly<{
  children: React.ReactNode;
  defaultSidebarOpen: boolean;
  onSignOut: () => void;
}>) {
  return (
    <AppShell
      navigation={navigation}
      brand={{
        name: 'Constructive',
        description: 'Tenant console',
        href: '/',
        logo: <BoxesIcon aria-hidden="true" />
      }}
      account={{
        name: 'Ada Lovelace',
        secondaryLabel: 'ada@example.com',
        actionGroups: [
          {
            id: 'session',
            actions: [
              {
                id: 'account',
                label: 'Account settings',
                href: '/account',
                icon: SettingsIcon
              },
              {
                id: 'sign-out',
                label: 'Sign out',
                onSelect: onSignOut,
                icon: LogOutIcon,
                variant: 'destructive'
              }
            ]
          }
        ]
      }}
      breadcrumbs={[
        { id: 'tenant', label: 'Acme', href: '/' },
        { id: 'data', label: 'Data', current: true }
      ]}
      renderLink={renderLink}
      defaultSidebarOpen={defaultSidebarOpen}
      barPlacement="top"
    >
      {children}
    </AppShell>
  );
}
```

`navigation` groups render in the main or footer region. A navigation item can
carry an icon, badge, active/disabled state, and nested children. `brand`
supports a logo, name, description, and optional link. `account` renders an
avatar fallback and grouped link or callback actions. AppShell defaults its
desktop sidebar to `collapsible="icon"`; pass `sidebarProps` when the product
needs `offcanvas`, `none`, another side, or another visual variant.

## Server-read initial state

`AppShell` passes `defaultSidebarOpen` to `SidebarProvider`, whose client code
writes but never reads the `sidebar_state` cookie. Read it in the Next.js 16
server layout:

```tsx
import { cookies } from 'next/headers';

import { signOut } from './actions';
import { TenantShell } from './tenant-shell';

export default async function Layout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_state');
  const defaultSidebarOpen = sidebarCookie?.value !== 'false';

  return (
    <TenantShell
      defaultSidebarOpen={defaultSidebarOpen}
      onSignOut={signOut}
    >
      {children}
    </TenantShell>
  );
}
```

For controlled desktop state, pass `sidebarOpen` and
`onSidebarOpenChange` together. For uncontrolled state, pass only
`defaultSidebarOpen`. Mobile always uses the sidebar context's separate Sheet
state; accepted navigation closes that Sheet, while desktop state and its
cookie remain unchanged.

## App bar placement and direct use

`barPlacement="top"` renders one full-width sticky bar above the sidebar and
content row. `barPlacement="content"` keeps the bar over the main column while
the sidebar occupies the viewport height. Use `barLeading`, `barSearch`, and
`barActions` for host content, and `barProps` for AppBar root props.

AppBar always includes `SidebarTrigger`. On narrow screens it hides
non-current breadcrumb items and keeps the current label truncated. When used
without AppShell, wrap it in the same `SidebarProvider` as its sidebar:

```tsx
import { AppBar } from '@/components/ui/app-bar';
import { SidebarProvider } from '@/components/ui/sidebar';

export function FramedHeader() {
  return (
    <SidebarProvider>
      <AppBar
        breadcrumbs={[
          { id: 'workspace', label: 'Acme', href: '/' },
          { id: 'members', label: 'Members', current: true }
        ]}
        renderLink={renderLink}
      />
    </SidebarProvider>
  );
}
```
