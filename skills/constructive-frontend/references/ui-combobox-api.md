# Combobox API Reference

Full type definitions and sub-component props for the Combobox system.

## Combobox

Root component. Manages selection state and popup lifecycle.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | -- | Controlled single value |
| `defaultValue` | `string` | -- | Uncontrolled single value |
| `onValueChange` | `(value: string) => void` | -- | Callback on selection change |
| `multiple` | `boolean` | `false` | Enable multiple selection mode |
| `open` | `boolean` | -- | Controlled popup state |
| `onOpenChange` | `(open: boolean) => void` | -- | Callback when popup opens/closes |

## ComboboxInput

Text input for filtering items.

- Extends `React.ComponentProps<'input'>`
- Filters items as user types
- In multiple mode, sits after chips inside `ComboboxTrigger`

## ComboboxTrigger

Wrapper around input area. Shows chevron icon.

- In single mode: wraps `ComboboxInput`
- In multiple mode: wraps `ComboboxChips` + `ComboboxInput`

## ComboboxContent

Dropdown popup panel. Alias: `ComboboxPopup`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `side` | `'top' \| 'bottom'` | `'bottom'` | Popup position relative to trigger |
| `sideOffset` | `number` | -- | Distance from trigger in pixels |
| `align` | `'start' \| 'center' \| 'end'` | `'start'` | Horizontal alignment |

Uses `useFloatingOverlayPortalProps()` for correct z-index stacking inside modals/dialogs.

## ComboboxList

Scrollable list container. Wraps `ComboboxItem` elements.

## ComboboxItem

Individual selectable option.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | -- | Unique identifier (required) |
| `disabled` | `boolean` | `false` | Prevents selection |

Shows check icon when selected (single mode) or checkbox indicator (multiple mode).

## ComboboxGroup

Groups related items under a shared label.

Contains `ComboboxGroupLabel` followed by `ComboboxItem` elements.

## ComboboxGroupLabel

Non-interactive header text for a `ComboboxGroup`. Rendered as styled text, not selectable.

## ComboboxSeparator

Visual divider between groups or items. Renders as a horizontal rule.

## ComboboxEmpty

Shown when no items match the current filter text.

```tsx
<ComboboxEmpty>No results found</ComboboxEmpty>
```

## ComboboxValue

Displays the currently selected value(s) inside the trigger. Useful for custom display rendering.

## ComboboxClear

Clear button to reset the entire selection back to empty.

## ComboboxStatus

Accessibility status announcements for screen readers. Announces selection changes and filter results.

## ComboboxRow

Advanced: row wrapper for virtualized list rendering. Use when displaying large option sets with virtual scrolling.

## ComboboxCollection

Advanced: collection wrapper for virtualized rendering. Pairs with `ComboboxRow`.

## Multiple Mode Components

### ComboboxChips

Container for selected value chips in multiple mode. Renders as a flex-wrap container inside `ComboboxTrigger`.

```tsx
<ComboboxTrigger>
  <ComboboxChips>
    {selected.map((val) => (
      <ComboboxChip key={val} value={val}>
        {val}
        <ComboboxChipRemove />
      </ComboboxChip>
    ))}
  </ComboboxChips>
  <ComboboxInput placeholder="Add more..." />
</ComboboxTrigger>
```

### ComboboxChip

Individual chip representing a selected value.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | -- | Which selected item this chip represents (required) |

### ComboboxChipRemove

Remove button rendered inside a `ComboboxChip`. Clicking removes the corresponding value from the selection.

## useComboboxFilter Hook

Client-side fuzzy filtering utility. Uses `match-sorter` internally.

```tsx
import { useComboboxFilter } from '@constructive-io/ui/combobox';

const filteredItems = useComboboxFilter(allItems, inputValue, {
  keys: ['label', 'value'],  // Properties to match against
  threshold: 0.3,            // match-sorter threshold
});
```

| Param | Type | Description |
|-------|------|-------------|
| `items` | `T[]` | Full list of items to filter |
| `inputValue` | `string` | Current input text |
| `options.keys` | `string[]` | Object keys to match against |
| `options.threshold` | `number` | Match sensitivity (0-1, lower = stricter) |

Returns: filtered and ranked `T[]`.

Note: This is client-side only. For server-side filtering, manage the items array yourself by fetching filtered results from your API and passing them directly to `ComboboxItem` elements.

## Implementation Notes

- Built on `@base-ui/react/combobox`
- Portal rendering via `useFloatingOverlayPortalProps()` ensures correct z-index inside modals
- Keyboard navigation: arrow keys, Enter to select, Escape to close
- Type-ahead: items are filtered as user types, with debounced matching
- In multiple mode, Backspace in empty input removes the last selected chip
