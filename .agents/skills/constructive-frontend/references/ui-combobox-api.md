# Combobox API

The Constructive Combobox wraps Base UI's Combobox and requires the root
`items` collection. Install it through the pinned Blocks local-consumption
workflow before using the source alias or package subpath.

## Single selection

Use `ComboboxInput` as the standard anchor and input. It can render the trigger
and clear controls itself, so an extra trigger wrapper is unnecessary.

```tsx
'use client';

import * as React from 'react';

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup
} from '@/components/ui/combobox';

const frameworks = ['Next.js', 'Remix', 'Astro'];

export function FrameworkPicker() {
  const [value, setValue] = React.useState<string | null>(null);

  return (
    <Combobox items={frameworks} value={value} onValueChange={setValue}>
      <ComboboxInput placeholder="Choose a framework" showClear />
      <ComboboxPopup>
        <ComboboxEmpty>No framework found.</ComboboxEmpty>
        <ComboboxList>
          {(framework: string) => (
            <ComboboxItem key={framework} value={framework}>
              {framework}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
```

`ComboboxInput` supports `showTrigger`, `showClear`, `startAddon`, and `size`.
`ComboboxPopup` and its `ComboboxContent` alias accept Base UI popup props plus
`sideOffset`, which defaults to `4`. This wrapper does not expose the
Positioner's `side` or `align` props. Put `ComboboxEmpty` and `ComboboxList`
inside the popup.

## Multiple selection

Set `multiple`, render selected values through `ComboboxValue`, and put the
input beside the chips in `ComboboxChips`. Each `ComboboxChip` includes its own
accessible remove control.

```tsx
'use client';

import * as React from 'react';

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue
} from '@/components/ui/combobox';

const roles = ['Owner', 'Admin', 'Member'];

export function RolePicker() {
  const [value, setValue] = React.useState<string[]>([]);

  return (
    <Combobox
      items={roles}
      multiple
      value={value}
      onValueChange={setValue}
    >
      <ComboboxChips>
        <ComboboxValue>
          {(selected: string[]) =>
            selected.map((role) => (
              <ComboboxChip key={role}>{role}</ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxInput placeholder="Add roles" />
      </ComboboxChips>
      <ComboboxPopup>
        <ComboboxEmpty>No role found.</ComboboxEmpty>
        <ComboboxList>
          {(role: string) => (
            <ComboboxItem key={role} value={role}>
              {role}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
```

## Grouping and advanced rendering

For grouped items, give each `ComboboxGroup` its own `items`, render a
`ComboboxGroupLabel`, and place its item render function inside
`ComboboxCollection`. Separate groups with `ComboboxSeparator`.

The remaining public exports are `ComboboxClear`, `ComboboxStatus`,
`ComboboxRow`, `ComboboxCollection`, `ComboboxGroup`, `ComboboxGroupLabel`,
`ComboboxSeparator`, `ComboboxTrigger`, `ComboboxValue`, and
`useComboboxFilter`. Use `ComboboxRow` and `ComboboxCollection` only when the
host owns an advanced or virtualized item layout; ordinary lists should use
the root collection and `ComboboxList` render function.

## State rules

- Use `value` with `onValueChange` for controlled selection, or
  `defaultValue` for local state.
- Preserve stable item identity when values are objects.
- Keep `ComboboxEmpty` mounted so filtering has an announced empty state.
- Do not render a second chip-remove control; the chip owns it.
