# Sheet Stacking Reference

Deep dive into the SheetStackProvider system for multi-level sheet navigation.

## Setup

```tsx
import { SheetStackProvider } from '@constructive-io/ui/sheet';

// Wrap your app/section to enable sheet stacking
<SheetStackProvider mode="cascade">
  {children}
</SheetStackProvider>
```

## Stack Modes

### cascade (default)

Each nested sheet indents by `SHEET_INDENT` (24px), creating a cascading stack effect. Previous sheets remain partially visible behind the new sheet.

```tsx
<SheetStackProvider mode="cascade">
  <Sheet>
    <SheetTrigger asChild><Button>Open First</Button></SheetTrigger>
    <SheetContent>
      {/* First sheet, full width */}
      <Sheet>
        <SheetTrigger asChild><Button>Open Second</Button></SheetTrigger>
        <SheetContent>
          {/* Second sheet, indented 24px from first */}
        </SheetContent>
      </Sheet>
    </SheetContent>
  </Sheet>
</SheetStackProvider>
```

### collapse

Previous sheet is pushed/collapsed to reveal the new sheet. Only the topmost sheet is fully visible.

```tsx
<SheetStackProvider mode="collapse">
  {children}
</SheetStackProvider>
```

## Hooks

### useSheetStack

Access stack metadata from any component inside the provider.

```tsx
import { useSheetStack } from '@constructive-io/ui/sheet';

function SheetContent() {
  const { stackCount, isInStack } = useSheetStack();

  return (
    <div>
      <p>Sheets open: {stackCount}</p>
      <p>Is stacked: {isInStack ? 'yes' : 'no'}</p>
    </div>
  );
}
```

### useSheet

Access the current sheet's state and actions.

```tsx
import { useSheet } from '@constructive-io/ui/sheet';

function SheetBody() {
  const { close, isOpen, side } = useSheet();

  return (
    <div>
      <p>Side: {side}</p>
      <Button onClick={close}>Close this sheet</Button>
    </div>
  );
}
```

## Nested Sheets Example

```tsx
<Sheet>
  <SheetTrigger asChild><Button>Open First</Button></SheetTrigger>
  <SheetContent>
    <SheetHeader><SheetTitle>List View</SheetTitle></SheetHeader>
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost">{item.name}</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader><SheetTitle>{item.name}</SheetTitle></SheetHeader>
              {/* Detail view -- stacks on top of list */}
              <Sheet>
                <SheetTrigger asChild><Button>Edit</Button></SheetTrigger>
                <SheetContent>
                  <SheetHeader><SheetTitle>Edit {item.name}</SheetTitle></SheetHeader>
                  {/* Edit form -- third level */}
                </SheetContent>
              </Sheet>
            </SheetContent>
          </Sheet>
        </li>
      ))}
    </ul>
  </SheetContent>
</Sheet>
```

## Global Escape Handling

- Escape key closes the topmost sheet in the stack
- Backdrop click closes the topmost sheet
- Each sheet manages its own animation independently
- Closing a parent sheet also closes all child sheets in the stack

## Animation Details

- Uses `motion.div` from motion/react with `springs.panel` for smooth transforms
- Side-specific transforms:
  - `right` -- `translateX(100%)` to `translateX(0)`
  - `left` -- `translateX(-100%)` to `translateX(0)`
  - `top` -- `translateY(-100%)` to `translateY(0)`
  - `bottom` -- `translateY(100%)` to `translateY(0)`
- Cascade mode applies `translateX(-(stackIndex * SHEET_INDENT))` to underlying sheets
- Exit animations reverse the enter transform
- Backdrop opacity animates in sync with sheet position

## Width Customization

```tsx
// Fixed width
<SheetContent side="right" className="w-[400px]">

// Responsive width
<SheetContent side="right" className="w-full sm:w-[540px] lg:w-[720px]">

// Max width with fill
<SheetContent side="right" className="w-full max-w-2xl">
```

## Stacking with Different Sides

Sheets can stack even when using different sides. Each sheet animates from its own direction independently.

```tsx
<Sheet>
  <SheetTrigger asChild><Button>Open Right</Button></SheetTrigger>
  <SheetContent side="right">
    <Sheet>
      <SheetTrigger asChild><Button>Open Bottom</Button></SheetTrigger>
      <SheetContent side="bottom">
        {/* Bottom sheet stacks on top of right sheet */}
      </SheetContent>
    </Sheet>
  </SheetContent>
</Sheet>
```
