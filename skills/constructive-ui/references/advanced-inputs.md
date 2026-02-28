# constructive-ui-advanced-inputs

Advanced input components from `@constructive-io/ui` for building rich selection, search, and editing interfaces beyond basic text inputs.

## Autocomplete

```tsx
'use client';
import {
  Autocomplete, AutocompleteInput, AutocompletePopup,
  AutocompleteItem, AutocompleteList, AutocompleteEmpty,
  AutocompleteGroup, AutocompleteGroupLabel,
} from '@constructive-io/ui/autocomplete';

const fruits = ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry'];

function FruitPicker() {
  return (
    <Autocomplete>
      <AutocompleteInput placeholder="Search fruits..." showClear />
      <AutocompletePopup>
        <AutocompleteList>
          <AutocompleteEmpty>No results found</AutocompleteEmpty>
          {fruits.map((fruit) => (
            <AutocompleteItem key={fruit} value={fruit}>
              {fruit}
            </AutocompleteItem>
          ))}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}
```

Built on `@base-ui/react/autocomplete`. Single-value only. Props on `AutocompleteInput`: `startAddon`, `showTrigger`, `showClear`.

Additional exports: `AutocompleteTrigger`, `AutocompleteSeparator`, `AutocompleteValue`, `AutocompleteClear`, `AutocompleteStatus`, `AutocompleteRow`, `AutocompleteCollection`.

## Combobox

```tsx
'use client';
import {
  Combobox, ComboboxInput, ComboboxTrigger, ComboboxContent,
  ComboboxItem, ComboboxList, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel,
} from '@constructive-io/ui/combobox';

const frameworks = [
  { value: 'next', label: 'Next.js' },
  { value: 'remix', label: 'Remix' },
  { value: 'astro', label: 'Astro' },
];

function FrameworkSelect() {
  const [value, setValue] = useState('');

  return (
    <Combobox value={value} onValueChange={setValue}>
      <ComboboxTrigger>
        <ComboboxInput placeholder="Select framework..." />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>No frameworks found</ComboboxEmpty>
          {frameworks.map((fw) => (
            <ComboboxItem key={fw.value} value={fw.value}>
              {fw.label}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
```

**Multiple mode (chips):**

```tsx
import { ComboboxChips, ComboboxChip, ComboboxChipRemove } from '@constructive-io/ui/combobox';

<Combobox multiple value={selected} onValueChange={setSelected}>
  <ComboboxTrigger>
    <ComboboxChips>
      {selected.map((val) => (
        <ComboboxChip key={val} value={val}>
          {val}
          <ComboboxChipRemove />
        </ComboboxChip>
      ))}
    </ComboboxChips>
    <ComboboxInput placeholder="Add tags..." />
  </ComboboxTrigger>
  <ComboboxContent>
    <ComboboxList>
      {options.map((opt) => (
        <ComboboxItem key={opt} value={opt}>{opt}</ComboboxItem>
      ))}
    </ComboboxList>
  </ComboboxContent>
</Combobox>
```

Also exports: `useComboboxFilter` hook for client-side filtering, `ComboboxSeparator`, `ComboboxValue`, `ComboboxClear`, `ComboboxStatus`, `ComboboxRow`, `ComboboxCollection`, `ComboboxPopup`.

See `references/combobox-api.md` for full type definitions.

## MultiSelect

```tsx
'use client';
import { MultiSelect, type MultiSelectOption } from '@constructive-io/ui/multi-select';

const options: MultiSelectOption[] = [
  { value: 'react', label: 'React' },
  { value: 'vue', label: 'Vue' },
  { value: 'angular', label: 'Angular' },
  { value: 'svelte', label: 'Svelte' },
];

function SkillsPicker() {
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <MultiSelect
      options={options}
      value={selected}
      onValueChange={setSelected}
      placeholder="Select skills..."
      maxCount={3}
    />
  );
}
```

Props: `options`, `value`, `onValueChange`, `placeholder`, `maxCount` (max badges before "+N"), `singleLine` (badges in one line), `variant` (badge variant), `animation` (badge entry animation).

Supports grouped options via `MultiSelectGroup`. Custom badge colors/gradients. Responsive `maxCount` (`{ mobile: 1, tablet: 2, desktop: 3 }`).

Imperative ref: `reset()`, `getSelectedValues()`, `setSelectedValues()`, `clear()`, `focus()`.

## Tags

```tsx
'use client';
import {
  Tags, TagsTrigger, TagsValue, TagsContent,
  TagsInput, TagsList, TagsItem, TagsEmpty,
} from '@constructive-io/ui/tags';

const availableTags = ['TypeScript', 'JavaScript', 'Python', 'Rust', 'Go'];

function TagPicker() {
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Tags value={selected} onValueChange={setSelected}>
      <TagsTrigger>
        <TagsValue />
      </TagsTrigger>
      <TagsContent>
        <TagsInput placeholder="Search tags..." />
        <TagsList>
          <TagsEmpty>No tags found</TagsEmpty>
          {availableTags.map((tag) => (
            <TagsItem key={tag} value={tag}>{tag}</TagsItem>
          ))}
        </TagsList>
      </TagsContent>
    </Tags>
  );
}
```

Wraps `Command` + `Popover`. Create-on-enter supported. Tracks width via `ResizeObserver` for popup sizing.

Also supports `TagsGroup` for grouping.

## RecordPicker

```tsx
'use client';
import { RecordPicker } from '@constructive-io/ui/record-picker';

type User = { id: string; name: string; email: string };

function UserPicker({ users, linkedIds, onLink, onUnlink }: {
  users: User[];
  linkedIds: string[];
  onLink: (ids: string[]) => void;
  onUnlink: (ids: string[]) => void;
}) {
  return (
    <RecordPicker
      records={users}
      linkedRecordIds={linkedIds}
      getRecordId={(u) => u.id}
      getRecordLabel={(u) => u.name}
      onLink={onLink}
      onUnlink={onUnlink}
    />
  );
}
```

Uses `matchSorter` for fuzzy search (debounced 300ms). Separates linked vs available records. Uses `Checkbox` for selection. Generic via prop callbacks.

## Calendar

```tsx
'use client';
import { Calendar, RangeCalendar } from '@constructive-io/ui/calendar-rac';
import { today, getLocalTimeZone } from '@internationalized/date';

// Single date
<Calendar
  value={date}
  onChange={setDate}
  minValue={today(getLocalTimeZone())}
/>

// Date range
<RangeCalendar
  value={range}
  onChange={setRange}
/>
```

Peer dependencies: `react-aria-components ^1`, `@internationalized/date ^3`. Built on React Aria Components for full a11y, i18n, and keyboard navigation.

## JsonInput

```tsx
'use client';
import { JsonInput, JsonEditor, validateJson } from '@constructive-io/ui/json-input';

// Full input with validation UI
<JsonInput
  value={jsonString}
  onChange={setJsonString}
  height="200px"
/>

// Raw editor only (ace editor)
<JsonEditor
  value={jsonString}
  onChange={setJsonString}
/>

// Validation utility
const { valid, error } = validateJson(jsonString);
```

`JsonInput` wraps `react-ace` (lazy-loaded) with JSON mode, validation status indicator (loading -> success/error with 400ms debounce), and "Format JSON" button. Peer deps: `react-ace ^14`, `ace-builds ^1`.

## Decision Guide

| Need | Component |
|------|-----------|
| Search + select one value | **Autocomplete** (simple) or **Combobox** (richer) |
| Search + select multiple | **Combobox** (multiple mode with chips) or **MultiSelect** (badge display) |
| Tag-style multi-picker | **Tags** (create-on-enter, command palette style) |
| Link/unlink records | **RecordPicker** (fuzzy search, checkbox selection) |
| Date selection | **Calendar** / **RangeCalendar** |
| JSON editing | **JsonInput** (with validation) or **JsonEditor** (raw) |

**Autocomplete vs Combobox:** Autocomplete is simpler (single value, Base UI autocomplete). Combobox has richer features (multiple mode, chips, groups, custom rendering).

**MultiSelect vs Combobox (multiple):** MultiSelect is a single component with badge display, `maxCount`, and imperative ref. Combobox multiple mode gives you full control over chip rendering and layout via composable sub-components.

**Tags vs MultiSelect:** Tags supports create-on-enter for free-form values. MultiSelect is constrained to predefined options only.

## Best Practices

- Use Autocomplete for simple search-and-select; Combobox for complex scenarios
- MultiSelect is best when options are known and finite (like categories)
- Tags is best for free-form tagging with optional suggestions
- RecordPicker is designed for relational data -- link/unlink pattern
- Calendar requires `react-aria-components` and `@internationalized/date` peer deps
- JsonInput lazy-loads the ace editor -- use Suspense boundaries if needed
- All advanced inputs require `'use client'`
- Use deep imports: `@constructive-io/ui/combobox` not `@constructive-io/ui`
- Tailwind v4 syntax: use `bg-black/50` not `bg-opacity-*`, `shadow-xs` not `shadow-sm` (v3)
- For Combobox in modals/dialogs, the popup uses `useFloatingOverlayPortalProps()` for correct z-index stacking
- Debounce async searches in Autocomplete/Combobox -- the components only filter client-side by default
- `useComboboxFilter` is client-side only; for server-side filtering, manage the items list yourself
