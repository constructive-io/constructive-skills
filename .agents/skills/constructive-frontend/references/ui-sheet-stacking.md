# Sheet stacking

`SheetStackProvider` coordinates nested Sheets that should remain visually
related. Install `sheet` through the pinned Blocks local-consumption workflow
and use the consumer's source aliases.

## Stack modes

Pass `stackMode="cascade"` to indent every underlying sheet by
`SHEET_INDENT` (`24px`). Pass `stackMode="collapse"` to give the sheet directly
below the top sheet the full push treatment while deeper sheets retain their
relative cascade.

```tsx
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetStackProvider,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';

<SheetStackProvider stackMode="cascade">
  <Sheet>
    <SheetTrigger render={<Button />}>Open customers</SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Customers</SheetTitle>
        <SheetDescription>Select a customer to inspect.</SheetDescription>
      </SheetHeader>

      <Sheet>
        <SheetTrigger render={<Button variant="ghost" />}>
          Open Ada Lovelace
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Ada Lovelace</SheetTitle>
            <SheetDescription>Customer details.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    </SheetContent>
  </Sheet>
</SheetStackProvider>
```

Nesting is derived from the React tree. Give a Sheet a stable `sheetId` when a
host needs to identify it across renders; otherwise the component generates
one.

## Current-sheet state

`useSheet()` must run inside a Sheet and returns `isOpen`, `sheetId`, `depth`,
`sheetsAbove`, `isTopSheet`, and `close`.

```tsx
import { Button } from '@/components/ui/button';
import { useSheet } from '@/components/ui/sheet';

export function SheetStatus() {
  const sheet = useSheet();

  return (
    <div className="flex items-center gap-2">
      <span>{sheet.sheetsAbove} sheets above</span>
      <Button variant="outline" onClick={sheet.close}>
        Close this sheet
      </Button>
    </div>
  );
}
```

`useSheetStack()` returns the provider context or `undefined` outside a
provider. Its current surface includes `sheets`, `sheetSizes`, `stackMode`,
registration and size helpers, `isTopSheet`, and `getSheetsAbove`. Prefer
`useSheet()` for ordinary leaf content so application code does not mutate the
stack registry directly.

## Layout and interaction

Each Sheet preserves its own `side`, width, and Base UI dismissal behavior.
Nested floating overlays use the modal portal scope, so menus and popovers stay
above the active sheet without application z-index overrides. Set a deliberate
responsive width on side sheets:

```tsx
<SheetContent side="right" className="w-full sm:max-w-lg" />
```

Keep a title and description for every nested Sheet, preserve focus return,
and use controlled `open`/`onOpenChange` only when the host owns that Sheet's
state.
