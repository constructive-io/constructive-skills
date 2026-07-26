# Constructive UI layout

Layout and navigation components for application shells, page structure, and
navigational patterns. Install the selected source through the pinned
`constructive-blocks` local-consumption workflow before using the package or
registry imports in this reference.

## AppShell, AppBar, and Sidebar

Use [ui-app-shell.md](./ui-app-shell.md) for the source-aligned application
frame, router adapter, account actions, breadcrumbs, bar placement, and
server-read sidebar state. Use [ui-sidebar-api.md](./ui-sidebar-api.md) when
composing the sidebar primitives directly.

```
AppShell
├── AppBar
├── SidebarProvider
│   ├── Sidebar (variant: sidebar | floating | inset)
│   │   └── collapsible: offcanvas | icon | none
│   ├── SidebarInset
│   └── SidebarTrigger
└── page content
```

The provider writes desktop state to `sidebar_state`, but it does not read the
cookie. The Next.js server layout supplies the initial state. Mobile uses a
separate Sheet state for `offcanvas` and `icon`; `none` stays fixed. Icon mode
changes width through explicit state and never expands on hover.

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

Use Base UI's `render` prop when a breadcrumb must use Next.js navigation:

```tsx
import Link from 'next/link';

<BreadcrumbLink render={<Link href="/settings" />}>
  Settings
</BreadcrumbLink>
```

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

- Prefer `AppShell` for the application frame; use one `SidebarProvider` at
  the layout level when composing primitives directly
- Sidebar `tooltip` on `SidebarMenuButton` shows in collapsed/icon mode
- Use Base UI `render` with Next.js `Link` for client-side navigation
- Stepper should be controlled -- manage `activeStep` in parent state
- Set `minSize` on `ResizablePanel` to prevent panels from collapsing to zero
- ScrollArea `scrollFade` is great for long lists inside fixed-height containers
- Use source aliases or valid package subpaths such as
  `@constructive-io/ui/sidebar`; current packages require the Blocks pinned
  local-consumption workflow
- All layout components with interactivity require `'use client'`
- Tailwind v4 syntax: use `bg-black/50` not `bg-opacity-*`, `shadow-xs` not `shadow-sm` (v3)
- Prefer `size-4` shorthand over separate `w-4 h-4` for icon sizing
- Sidebar `inset` gives the content area a card-like appearance inside the
  sidebar frame; `icon` is a collapse mode, not a variant
- For vertical Stepper, each `StepperItem` content sits below its trigger before the separator
