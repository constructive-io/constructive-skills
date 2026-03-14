Build overlay and modal UIs with @constructive-io/ui components.

## Portal System Setup

```tsx
// Root layout -- required for all overlay components
import { PortalRoot } from '@constructive-io/ui/portal';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <PortalRoot />
      </body>
    </html>
  );
}
```

Portal constants and hooks:
- `PORTAL_ROOT_ID = 'portal-root'` -- the fixed-position container div
- `ModalPortalScope` -- wraps modal content; increments depth for nested modals
- `usePortalContext()` -- access `{ layer, depth, floatingPortalStrategy, floatingZIndex }`
- `useInModalOverlay()` -- boolean, true inside a modal
- `useRootPortalContainer()` -- returns `#portal-root` HTMLElement
- `useFloatingOverlayPortalProps()` -- returns `{ container?, zIndexClass }` for floating elements

### Z-Index Layers

```
--z-layer-floating: 1000          Tooltips, popovers, dropdowns
--z-layer-modal-backdrop: 2000    Modal backdrop overlay
--z-layer-modal-content: 2001     Modal content
--z-layer-floating-elevated: 3000 Floating elements inside modals
--z-layer-toast: 4000             Toast notifications
--z-layer-portal-root: 9999       Portal root container
```

## Dialog

```tsx
'use client';
import {
  Dialog, DialogTrigger, DialogPopup, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose, DialogPanel,
} from '@constructive-io/ui/dialog';
import { Button } from '@constructive-io/ui/button';

function EditProfileDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Edit Profile</Button>
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Make changes to your profile.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {/* Form content */}
        </DialogPanel>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button>Save changes</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
```

**Key sub-components:**
- `Dialog` -- root (controlled via `open`/`onOpenChange`)
- `DialogTrigger` -- click to open
- `DialogPopup` / `DialogContent` (alias) -- the modal content
- `DialogHeader`, `DialogTitle`, `DialogDescription` -- header section
- `DialogPanel` / `DialogViewport` -- scrollable content area
- `DialogFooter` -- action buttons (has `variant?: 'default' | 'sticky'`)
- `DialogClose` -- close button
- `DialogBackdrop` / `DialogOverlay` -- backdrop
- `bottomStickOnMobile` prop -- renders as bottom sheet on mobile

### Controlled Dialog

```tsx
'use client';
import { useState } from 'react';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogFooter } from '@constructive-io/ui/dialog';
import { Button } from '@constructive-io/ui/button';

function ControlledDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Controlled Dialog</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
```

## AlertDialog

```tsx
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from '@constructive-io/ui/alert-dialog';
import { Button } from '@constructive-io/ui/button';

<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete Account</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Use AlertDialog (not Dialog) for destructive confirmations -- it blocks interaction and requires explicit dismiss.

## Sheet (Slide-Out Panel)

```tsx
'use client';
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader,
  SheetTitle, SheetDescription, SheetFooter, SheetClose,
} from '@constructive-io/ui/sheet';
import { Button } from '@constructive-io/ui/button';

<Sheet>
  <SheetTrigger asChild>
    <Button>Open Panel</Button>
  </SheetTrigger>
  <SheetContent side="right"> {/* 'left' | 'right' | 'top' | 'bottom' */}
    <SheetHeader>
      <SheetTitle>Panel Title</SheetTitle>
      <SheetDescription>Panel description</SheetDescription>
    </SheetHeader>
    <div className="py-4">{/* Content */}</div>
    <SheetFooter>
      <SheetClose asChild><Button variant="outline">Close</Button></SheetClose>
      <Button>Save</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

Side variants: `left`, `right` (default), `top`, `bottom`. Uses motion/react for GPU-accelerated transform animations with `springs.panel`.

### Sheet with Form

```tsx
<Sheet>
  <SheetTrigger asChild>
    <Button>Edit Item</Button>
  </SheetTrigger>
  <SheetContent side="right" className="w-[400px] sm:w-[540px]">
    <SheetHeader>
      <SheetTitle>Edit Item</SheetTitle>
    </SheetHeader>
    <div className="space-y-4 py-4">
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
    </div>
    <SheetFooter>
      <SheetClose asChild><Button variant="outline">Cancel</Button></SheetClose>
      <Button onClick={handleSave}>Save</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

## Popover

```tsx
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from '@constructive-io/ui/popover';
import { Button } from '@constructive-io/ui/button';

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open</Button>
  </PopoverTrigger>
  <PopoverContent className="w-80">
    <div className="grid gap-4">
      <h4 className="font-medium">Popover content</h4>
      <p className="text-sm text-muted-foreground">Configure settings here.</p>
    </div>
  </PopoverContent>
</Popover>
```

`PopoverAnchor` -- alternative positioning reference (instead of trigger). Supports `showArrow` prop and `side` prop (top/right/bottom/left).

## Tooltip

```tsx
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@constructive-io/ui/tooltip';
import { Button } from '@constructive-io/ui/button';
import { Info } from 'lucide-react';

// Wrap app/section in TooltipProvider (controls delay)
<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="icon" size="icon"><Info className="size-4" /></Button>
    </TooltipTrigger>
    <TooltipContent side="top" showArrow>
      <p>Helpful information</p>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

## DropdownMenu

```tsx
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
  DropdownMenuGroup, DropdownMenuShortcut, DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@constructive-io/ui/dropdown-menu';
import { Button } from '@constructive-io/ui/button';
import { MoreHorizontal } from 'lucide-react';

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>Actions</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem>
        Edit <DropdownMenuShortcut>&#8984;E</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem>Duplicate</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>Share</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem>Email</DropdownMenuItem>
        <DropdownMenuItem>Link</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Checkbox and Radio Menu Items

```tsx
<DropdownMenuContent>
  <DropdownMenuLabel>View</DropdownMenuLabel>
  <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
    Show Grid
  </DropdownMenuCheckboxItem>
  <DropdownMenuCheckboxItem checked={showRulers} onCheckedChange={setShowRulers}>
    Show Rulers
  </DropdownMenuCheckboxItem>
  <DropdownMenuSeparator />
  <DropdownMenuLabel>Density</DropdownMenuLabel>
  <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
    <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
    <DropdownMenuRadioItem value="normal">Normal</DropdownMenuRadioItem>
    <DropdownMenuRadioItem value="relaxed">Relaxed</DropdownMenuRadioItem>
  </DropdownMenuRadioGroup>
</DropdownMenuContent>
```

## Decision Guide

| Component | Use When |
|-----------|----------|
| **Dialog** | Modal form, confirmation, content that needs full attention |
| **AlertDialog** | Destructive confirmation (blocks interaction, requires explicit dismiss) |
| **Sheet** | Side panel for details, editing, secondary navigation |
| **Drawer** | Bottom sheet (mobile), content tray (uses Vaul) |
| **Popover** | Contextual info/controls, filter panels, small forms |
| **Tooltip** | Brief hints on hover/focus, icon labels |
| **DropdownMenu** | Action menus, context menus, option lists |

## Overlay-Inside-Overlay Rules

- Floating elements (Tooltip, Popover, Dropdown) inside modals automatically get `z-[var(--z-layer-floating-elevated)]`
- The `ModalPortalScope` tracks nesting depth
- `useFloatingOverlayPortalProps()` returns correct z-index class based on context
- Sheets support stacking via `SheetStackProvider` (see `references/sheet-stacking.md`)

### Tooltip Inside Dialog

```tsx
<Dialog>
  <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
  <DialogPopup>
    <DialogHeader><DialogTitle>Settings</DialogTitle></DialogHeader>
    <DialogPanel>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="icon" size="icon"><Info className="size-4" /></Button>
          </TooltipTrigger>
          <TooltipContent>
            {/* Automatically elevated z-index inside modal */}
            <p>This tooltip renders above the dialog</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </DialogPanel>
  </DialogPopup>
</Dialog>
```

### Dropdown Inside Sheet

```tsx
<Sheet>
  <SheetTrigger asChild><Button>Details</Button></SheetTrigger>
  <SheetContent>
    <SheetHeader><SheetTitle>Item Details</SheetTitle></SheetHeader>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {/* Automatically elevated z-index inside sheet */}
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </SheetContent>
</Sheet>
```

## Best Practices

- Always use `asChild` on triggers to preserve semantic HTML
- Set up `PortalRoot` once in root layout -- all overlays require it
- Use `DialogPopup` (not `DialogContent`) as the primary popup component name
- Sheet `side` defaults to `right`; use `left` for navigation panels
- Wrap areas with many tooltips in a single `TooltipProvider` to share delay settings
- Use AlertDialog (not Dialog) for destructive confirmations -- it blocks interaction
- Use controlled mode (`open`/`onOpenChange`) when you need programmatic open/close
- Prefer `align="end"` on dropdown menus triggered by icon buttons
- Set explicit width on SheetContent for consistent panel sizing
- DialogFooter `variant="sticky"` keeps actions visible during scroll
