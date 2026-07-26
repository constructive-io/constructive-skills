# DropdownMenu API Reference

Current sub-component API for the Constructive dropdown menu, built on
`@base-ui/react/menu`. Install it through the pinned Blocks local-consumption
workflow before using the source or package import.

## DropdownMenu

Root component. Manages open/close state.

**Props:**
- `open?: boolean` -- controlled open state
- `onOpenChange?: (open: boolean) => void` -- state change handler

```tsx
<>
  {/* Uncontrolled */}
  <DropdownMenu>{/* Items */}</DropdownMenu>

  {/* Controlled */}
  <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
    {/* Items */}
  </DropdownMenu>
</>
```

## DropdownMenuTrigger

Element that toggles the menu.

Compose the trigger with Base UI's `render` prop:

```tsx
<DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
  <MoreHorizontal aria-hidden="true" />
  <span className="sr-only">Open actions</span>
</DropdownMenuTrigger>
```

## DropdownMenuPortal

Optional portal wrapper. Used internally by default -- rarely needed explicitly.

## DropdownMenuContent

The popup panel containing menu items.

**Props:**
- `side?: 'top' | 'right' | 'bottom' | 'left'` -- placement relative to trigger (default: `'bottom'`)
- `sideOffset?: number` -- distance from trigger in pixels (default: `4`)
- `align?: 'start' | 'center' | 'end'` -- alignment along the side axis (default: `'start'`)

The wrapper accepts Base UI popup props plus these three positioning props. It does not expose the Positioner's `alignOffset` prop.

```tsx
<DropdownMenuContent align="end" sideOffset={8}>
  {/* Menu items */}
</DropdownMenuContent>
```

## DropdownMenuGroup

Groups related items visually. No semantic props beyond standard div attributes.

```tsx
<DropdownMenuGroup>
  <DropdownMenuItem>Cut</DropdownMenuItem>
  <DropdownMenuItem>Copy</DropdownMenuItem>
  <DropdownMenuItem>Paste</DropdownMenuItem>
</DropdownMenuGroup>
```

## DropdownMenuItem

Clickable menu item.

**Props:**
- `variant?: 'default' | 'destructive'` -- visual style
- `disabled?: boolean` -- prevents interaction
- `onClick?: () => void` -- called when the item is activated

```tsx
<DropdownMenuGroup>
  <DropdownMenuItem onClick={handleEdit}>Edit</DropdownMenuItem>
  <DropdownMenuItem disabled>Archive</DropdownMenuItem>
  <DropdownMenuItem variant="destructive" onClick={handleDelete}>
    Delete
  </DropdownMenuItem>
</DropdownMenuGroup>
```

## DropdownMenuCheckboxItem

Menu item with a checkbox indicator.

**Props:**
- `checked?: boolean` -- controlled checked state
- `onCheckedChange?: (checked: boolean) => void` -- state change handler

```tsx
<DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
  Show Grid
</DropdownMenuCheckboxItem>
```

## DropdownMenuRadioGroup

Container for mutually exclusive radio items.

**Props:**
- `value?: string` -- controlled selected value
- `onValueChange?: (value: string) => void` -- selection change handler

```tsx
<DropdownMenuRadioGroup value={sortBy} onValueChange={setSortBy}>
  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
  <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
  <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
</DropdownMenuRadioGroup>
```

## DropdownMenuRadioItem

Radio option within a radio group.

**Props:**
- `value: string` -- the value this option represents

## DropdownMenuLabel

Non-interactive group label.

**Props:**
- `inset?: boolean` -- adds left padding to align with items that have icons

```tsx
<DropdownMenuGroup>
  <DropdownMenuLabel>Actions</DropdownMenuLabel>
  <DropdownMenuLabel inset>More actions</DropdownMenuLabel>
</DropdownMenuGroup>
```

## DropdownMenuSeparator

Visual divider between groups of items.

```tsx
<DropdownMenuSeparator />
```

## DropdownMenuShortcut

Keyboard shortcut display. Renders as `<kbd>` with muted, right-aligned styling.

```tsx
<DropdownMenuItem>
  Save <DropdownMenuShortcut>&#8984;S</DropdownMenuShortcut>
</DropdownMenuItem>
```

## DropdownMenuSub

Sub-menu root. Nests inside DropdownMenuContent.

```tsx
<DropdownMenuSub>
  <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
  <DropdownMenuSubContent>
    <DropdownMenuItem>Email</DropdownMenuItem>
    <DropdownMenuItem>Slack</DropdownMenuItem>
  </DropdownMenuSubContent>
</DropdownMenuSub>
```

## DropdownMenuSubTrigger

Opens the sub-menu on hover/focus. Renders a chevron indicator.

**Props:**
- `inset?: boolean` -- adds left padding for icon alignment

## DropdownMenuSubContent

Sub-menu popup panel. It accepts Base UI popup props only; the wrapper fixes its Positioner to `side="right"` and `sideOffset={-4}`.

## Z-Index Handling

Uses `useFloatingOverlayPortalProps()` internally for correct z-index layering. When rendered inside a modal (Dialog, Sheet), the dropdown automatically receives `z-[var(--z-layer-floating-elevated)]` to appear above the modal content.
