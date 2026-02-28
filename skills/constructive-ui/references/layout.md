# constructive-ui-layout

Layout and navigation components from `@constructive-io/ui` for building application shells, page structure, and navigational patterns.

## Sidebar

The most complex layout component. Full sub-component tree:

```
SidebarProvider
├── Sidebar (variant: sidebar | floating | inset | icon)
│   ├── SidebarHeader
│   ├── SidebarContent
│   │   ├── SidebarGroup
│   │   │   ├── SidebarGroupLabel
│   │   │   ├── SidebarGroupAction
│   │   │   └── SidebarGroupContent
│   │   │       └── SidebarMenu
│   │   │           ├── SidebarMenuItem
│   │   │           │   ├── SidebarMenuButton (isActive, tooltip)
│   │   │           │   ├── SidebarMenuAction
│   │   │           │   └── SidebarMenuBadge
│   │   │           ├── SidebarMenuSub
│   │   │           │   └── SidebarMenuSubItem
│   │   │           │       └── SidebarMenuSubButton
│   │   │           └── SidebarMenuSkeleton
│   │   └── SidebarSeparator
│   ├── SidebarFooter
│   └── SidebarInput
├── SidebarInset (main content area)
└── SidebarTrigger (toggle button)
```

Usage example:

```tsx
'use client';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarFooter, SidebarInset, SidebarTrigger, useSidebar,
} from '@constructive-io/ui/sidebar';
import { Home, Settings, Users, LogOut } from 'lucide-react';

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <h2 className="px-4 text-lg font-semibold">My App</h2>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive tooltip="Home">
                    <Home className="size-4" />
                    <span>Home</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Users">
                    <Users className="size-4" />
                    <span>Users</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings">
                    <Settings className="size-4" />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenuButton>
            <LogOut className="size-4" />
            <span>Logout</span>
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1>Page Title</h1>
        </header>
        <main className="p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

**useSidebar hook:**

```tsx
const { state, open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar } = useSidebar();
// state: 'expanded' | 'collapsed'
```

Keyboard: `Cmd/Ctrl+B` toggles sidebar. State persisted to cookie `sidebar_state`.
Mobile: Renders as a Sheet (slide-out).
Variants: `sidebar` (default), `floating`, `inset`, `icon` (collapsed to icons only).

See `references/sidebar-api.md` for full sub-component props.

## Tabs

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@constructive-io/ui/tabs';

// Uncontrolled
<Tabs defaultValue="general">
  <TabsList>
    <TabsTrigger value="general">General</TabsTrigger>
    <TabsTrigger value="security">Security</TabsTrigger>
    <TabsTrigger value="notifications">Notifications</TabsTrigger>
  </TabsList>
  <TabsContent value="general">General settings...</TabsContent>
  <TabsContent value="security">Security settings...</TabsContent>
  <TabsContent value="notifications">Notification prefs...</TabsContent>
</Tabs>

// Controlled
const [tab, setTab] = useState('general');
<Tabs value={tab} onValueChange={setTab}>
  ...
</Tabs>
```

Built on `@base-ui/react/tabs`. Minimal wrapper.

## Breadcrumb

```tsx
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbSeparator, BreadcrumbPage, BreadcrumbEllipsis,
} from '@constructive-io/ui/breadcrumb';

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/">Home</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Profile</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

With ellipsis for deep paths:

```tsx
<BreadcrumbItem>
  <BreadcrumbEllipsis />
</BreadcrumbItem>
```

`BreadcrumbLink` supports `asChild` for Next.js `Link`.

## Pagination

```tsx
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from '@constructive-io/ui/pagination';

<Pagination>
  <PaginationContent>
    <PaginationItem>
      <PaginationPrevious href="#" />
    </PaginationItem>
    <PaginationItem>
      <PaginationLink href="#" isActive>1</PaginationLink>
    </PaginationItem>
    <PaginationItem>
      <PaginationLink href="#">2</PaginationLink>
    </PaginationItem>
    <PaginationItem>
      <PaginationEllipsis />
    </PaginationItem>
    <PaginationItem>
      <PaginationLink href="#">10</PaginationLink>
    </PaginationItem>
    <PaginationItem>
      <PaginationNext href="#" />
    </PaginationItem>
  </PaginationContent>
</Pagination>
```

Uses `buttonVariants` for styling. Renders as `<a>` elements.

## Stepper

```tsx
import {
  Stepper, StepperItem, StepperTrigger,
  StepperIndicator, StepperTitle, StepperDescription, StepperSeparator,
} from '@constructive-io/ui/stepper';

<Stepper activeStep={2}>
  <StepperItem step={1}>
    <StepperTrigger>
      <StepperIndicator />
      <div>
        <StepperTitle>Account</StepperTitle>
        <StepperDescription>Create your account</StepperDescription>
      </div>
    </StepperTrigger>
    <StepperSeparator />
  </StepperItem>
  <StepperItem step={2}>
    <StepperTrigger>
      <StepperIndicator />
      <div>
        <StepperTitle>Profile</StepperTitle>
        <StepperDescription>Set up your profile</StepperDescription>
      </div>
    </StepperTrigger>
    <StepperSeparator />
  </StepperItem>
  <StepperItem step={3}>
    <StepperTrigger>
      <StepperIndicator />
      <div>
        <StepperTitle>Complete</StepperTitle>
        <StepperDescription>Review and finish</StepperDescription>
      </div>
    </StepperTrigger>
  </StepperItem>
</Stepper>
```

States: `active` (current step), `completed` (past steps), `inactive` (future steps), `loading` (processing).
Orientation: `horizontal` (default), `vertical`.

## Collapsible

```tsx
import { Collapsible, CollapsibleTrigger, CollapsibleContent, CollapsibleIcon } from '@constructive-io/ui/collapsible';

<Collapsible>
  <CollapsibleTrigger className="flex items-center gap-2">
    <CollapsibleIcon /> {/* Animated chevron */}
    <span>Advanced Options</span>
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div className="pt-2">Hidden content revealed on toggle</div>
  </CollapsibleContent>
</Collapsible>
```

Built on `@base-ui/react/collapsible`. `CollapsibleIcon` is an animated chevron that rotates on open. Height transition via CSS `--collapsible-panel-height` variable.

## Resizable Panels

```tsx
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@constructive-io/ui/resizable';

<ResizablePanelGroup direction="horizontal">
  <ResizablePanel defaultSize={25} minSize={15}>
    <div className="p-4">Left panel</div>
  </ResizablePanel>
  <ResizableHandle withHandle /> {/* Visual grip icon */}
  <ResizablePanel defaultSize={75}>
    <div className="p-4">Right panel</div>
  </ResizablePanel>
</ResizablePanelGroup>
```

Built on `react-resizable-panels`. `withHandle` adds a visual grip indicator.

## ScrollArea

```tsx
import { ScrollArea, ScrollBar } from '@constructive-io/ui/scroll-area';

<ScrollArea className="h-[300px]">
  <div className="p-4">{longContent}</div>
  <ScrollBar orientation="vertical" />
</ScrollArea>

// With scroll fade (CSS mask gradient at edges)
<ScrollArea scrollFade>
  {content}
</ScrollArea>
```

Built on `@base-ui/react/scroll-area`. Scrollbar only visible on hover/scroll. `scrollFade` adds gradient mask. `scrollbarGutter` adds padding when scrollbar appears.

## Separator

```tsx
import { Separator } from '@constructive-io/ui/separator';

<Separator /> {/* Horizontal by default */}
<Separator orientation="vertical" className="h-6" />
```

## PageHeader

```tsx
import { PageHeader } from '@constructive-io/ui/page-header';
// Simple page title component for consistent page headers
```

## Dock

```tsx
import { Dock, DockIcon } from '@constructive-io/ui/dock';
// macOS-style dock with magnification effect
// Uses motion for spring-based hover animations
```

## Best Practices

- Use `SidebarProvider` at the layout level, not per-page
- Sidebar `tooltip` on `SidebarMenuButton` shows in collapsed/icon mode
- Use `BreadcrumbLink asChild` with Next.js `Link` for client-side navigation
- Stepper should be controlled -- manage `activeStep` in parent state
- Set `minSize` on `ResizablePanel` to prevent panels from collapsing to zero
- ScrollArea `scrollFade` is great for long lists inside fixed-height containers
- Use deep imports: `@constructive-io/ui/sidebar` not `@constructive-io/ui`
- All layout components with interactivity require `'use client'`
- Tailwind v4 syntax: use `bg-black/50` not `bg-opacity-*`, `shadow-xs` not `shadow-sm` (v3)
- Prefer `size-4` shorthand over separate `w-4 h-4` for icon sizing
- Sidebar variants: `inset` gives the content area a card-like appearance inside the sidebar frame
- For vertical Stepper, each `StepperItem` content sits below its trigger before the separator
