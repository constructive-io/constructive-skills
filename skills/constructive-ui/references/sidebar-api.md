# Sidebar API Reference

Complete sub-component props reference for the Sidebar layout system.

## SidebarProvider

Root context provider. Wrap your entire layout.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `defaultOpen` | `boolean` | `true` | Initial open state (uncontrolled) |
| `open` | `boolean` | -- | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | -- | Callback when state changes |
| `children` | `React.ReactNode` | -- | Layout contents |

Provides context via `useSidebar()`:

```tsx
const {
  state,         // 'expanded' | 'collapsed'
  open,          // boolean
  setOpen,       // (open: boolean) => void
  openMobile,    // boolean
  setOpenMobile, // (open: boolean) => void
  isMobile,      // boolean
  toggleSidebar, // () => void
} = useSidebar();
```

## Sidebar

Main sidebar container.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `side` | `'left' \| 'right'` | `'left'` | Which side to render on |
| `variant` | `'sidebar' \| 'floating' \| 'inset' \| 'icon'` | `'sidebar'` | Visual style |
| `collapsible` | `'offcanvas' \| 'icon' \| 'none'` | `'offcanvas'` | Collapse behavior |

- On mobile: renders as Sheet (side panel overlay)
- On desktop: renders as `<aside>` with CSS width transitions
- Hover expansion: when `collapsible="icon"`, hovering expands temporarily (`data-state="expanded"` via `data-collapsible="icon"`)

## SidebarTrigger

Toggle button for sidebar open/close.

- Renders as `Button` with `variant="ghost"`, `size="icon"`
- Shows menu/panel-left icon based on current state
- No additional props beyond standard button props

## SidebarInset

Main content wrapper, positioned adjacent to the sidebar.

- Automatically adjusts width when sidebar collapses
- CSS: `flex flex-1 flex-col overflow-hidden`
- Place page header and main content inside this component

## SidebarInput

Search input inside the sidebar.

- Auto-styled with sidebar-specific padding and border radius
- Extends standard `<input>` props

## SidebarHeader

Fixed area at the top of the sidebar.

- Typically contains logo, app name, or user avatar
- Not scrollable -- stays pinned at top

## SidebarFooter

Fixed area at the bottom of the sidebar.

- Has `data-slot="sidebar-footer"` attribute
- Typically contains logout button or user menu
- Not scrollable -- stays pinned at bottom

## SidebarContent

Scrollable area between header and footer.

- `overflow-auto` for vertical scrolling
- Contains one or more `SidebarGroup` components

## SidebarGroup

Groups related menu items within `SidebarContent`.

| Sub-component | Purpose |
|---------------|---------|
| `SidebarGroupLabel` | Section title text, hides in icon mode |
| `SidebarGroupAction` | Action button in group header (e.g., "Add" button) |
| `SidebarGroupContent` | Wrapper for the `SidebarMenu` |

## SidebarMenu

Container for menu items. Renders as `<ul>`.

## SidebarMenuItem

Individual menu item. Renders as `<li>`.

Contains: `SidebarMenuButton`, optional `SidebarMenuAction`, `SidebarMenuBadge`.

## SidebarMenuButton

Primary interactive element within a menu item.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isActive` | `boolean` | `false` | Highlights as current page |
| `tooltip` | `string \| TooltipContentProps` | -- | Tooltip shown in collapsed/icon mode |
| `variant` | `'default' \| 'outline'` | `'default'` | Visual style |
| `size` | `'sm' \| 'default' \| 'lg'` | `'default'` | Button size |

Supports `asChild` for wrapping Next.js `Link`:

```tsx
<SidebarMenuButton asChild isActive={pathname === '/home'}>
  <Link href="/home">
    <Home className="size-4" />
    <span>Home</span>
  </Link>
</SidebarMenuButton>
```

## SidebarMenuAction

Secondary action button on a menu item (e.g., kebab menu, delete).

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `showOnHover` | `boolean` | `false` | Only visible on hover |

## SidebarMenuBadge

Badge or count display on menu items. Renders inline after the button text.

## SidebarMenuSkeleton

Loading placeholder for menu items.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `showIcon` | `boolean` | `false` | Show icon placeholder circle |

## SidebarMenuSub

Nested sub-menu tree. Renders as nested `<ul>`.

## SidebarMenuSubItem

Item within a sub-menu. Renders as `<li>`.

## SidebarMenuSubButton

Button within a sub-menu item.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isActive` | `boolean` | `false` | Highlights as current page |
| `size` | `'sm' \| 'md'` | `'md'` | Button size |

## SidebarSeparator

Visual divider between groups or sections within the sidebar.

## CSS Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `--sidebar-width` | `16rem` | Expanded sidebar width |
| `--sidebar-width-icon` | `3rem` | Collapsed width (icon mode) |
| `--sidebar-width-mobile` | `18rem` | Mobile sheet width |

## Cookie Persistence

Sidebar open/closed state is persisted to the cookie `sidebar_state`.

- Uses `document.cookie` directly
- Value: `"true"` or `"false"`
- Read on mount to restore previous state

## Keyboard Shortcut

- `Cmd+B` (macOS) / `Ctrl+B` (Windows/Linux) toggles sidebar
- Registered globally within `SidebarProvider`

## Variant Comparison

| Variant | Collapsed Behavior | Use Case |
|---------|-------------------|----------|
| `sidebar` | Slides off-screen | Standard app sidebar |
| `floating` | Floats over content with shadow | Overlay navigation |
| `inset` | Content area has card appearance | Dashboard layouts |
| `icon` | Collapses to icon strip, expands on hover | Dense navigation |
