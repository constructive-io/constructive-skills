# Constructive overlays

Install overlay primitives through the pinned Blocks local-consumption workflow
and use the consumer's source aliases below. All trigger and close composition
uses Base UI's `render` prop.

## Portal root

Mount one portal root so modal and floating layers share Constructive's z-index
policy. The hooks fall back to `document.body` while the root is unavailable,
but the explicit root is the stable application target.

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

Modal content owns `ModalPortalScope`; floating overlays inside it select the
elevated floating layer automatically. Keep titles and descriptions in every
modal, using `sr-only` when the accessible name should be visually hidden.

## Dialog

Use Dialog for focused content or a modal form. Use `DialogPanel` for the
scrollable body and `DialogFooter` with `default` or `bare` presentation.

```tsx
'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

export function EditProfileDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        Edit profile
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Update the visible account details.</DialogDescription>
        </DialogHeader>
        <DialogPanel>{/* Form fields */}</DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit">Save changes</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
```

For programmatic control, pass `open` and `onOpenChange` to `Dialog`. Keep one
source of truth; do not mix a controlled root with an independent trigger
state.

## AlertDialog

Use AlertDialog for a destructive action that requires an explicit decision.
Its action and cancel exports already carry their button treatments.

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

<AlertDialog>
  <AlertDialogTrigger render={<Button variant="destructive" />}>
    Delete account
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete this account?</AlertDialogTitle>
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

## Sheet

Use Sheet for secondary navigation, details, or editing that should retain page
context. `side` accepts `left`, `right`, `top`, or `bottom`.

```tsx
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';

<Sheet>
  <SheetTrigger render={<Button />}>Open details</SheetTrigger>
  <SheetContent side="right">
    <SheetHeader>
      <SheetTitle>Record details</SheetTitle>
      <SheetDescription>Review this record without leaving the list.</SheetDescription>
    </SheetHeader>
    <div className="flex flex-col gap-4 py-4">{/* Content */}</div>
    <SheetFooter>
      <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
      <Button>Save</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

For nested sheets, wrap the owning region in `SheetStackProvider` and follow
[ui-sheet-stacking.md](./ui-sheet-stacking.md).

## Popover and Tooltip

Use Popover for interactive contextual content and Tooltip for a short label or
hint. Reuse one `TooltipProvider` for a region with several tooltips.

```tsx
import { InfoIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

<>
  <Popover>
    <PopoverTrigger render={<Button variant="outline" />}>Filters</PopoverTrigger>
    <PopoverContent align="end">
      <PopoverTitle>Filters</PopoverTitle>
      <PopoverDescription>Narrow the visible records.</PopoverDescription>
    </PopoverContent>
  </Popover>

  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" />}>
        <InfoIcon aria-hidden="true" />
        <span className="sr-only">About retention</span>
      </TooltipTrigger>
      <TooltipContent side="top" showArrow>
        Records are retained for 30 days.
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</>
```

## DropdownMenu

Put items inside a group, use separators between semantic groups, and keep
destructive actions visibly distinct.

```tsx
import { MoreHorizontalIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

<DropdownMenu>
  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
    <MoreHorizontalIcon aria-hidden="true" />
    <span className="sr-only">Record actions</span>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuGroup>
      <DropdownMenuLabel>Actions</DropdownMenuLabel>
      <DropdownMenuItem>Edit</DropdownMenuItem>
      <DropdownMenuItem>Duplicate</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>
```

## Selection guide

| Need | Component |
|---|---|
| Focused form or content | Dialog |
| Destructive confirmation | AlertDialog |
| Context-preserving panel | Sheet |
| Small interactive surface | Popover |
| Short hover/focus hint | Tooltip |
| Compact action list | DropdownMenu |

Use controlled `open`/`onOpenChange` only when the host needs programmatic
control. Respect reduced motion, keep focus behavior from the primitive, and
avoid hand-authored z-index values for nested overlays.
