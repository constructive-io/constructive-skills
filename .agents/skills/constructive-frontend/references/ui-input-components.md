# Input Components Reference

Detailed API reference for each input primitive in @constructive-io/ui.

## Input

`@constructive-io/ui/input`

Styled text input with wrapper span for visual consistency.

**Props:** extends `React.ComponentProps<'input'>`, adds:
- `size?: 'sm' | 'default' | 'lg' | number` -- controls height and font size
- `unstyled?: boolean` -- strips the wrapper styles for use inside InputGroup

**Structure:** Wrapped in a `<span data-slot="input">` that carries visual styles (border, shadow, focus ring, error state via `aria-invalid`).

**Floating label support:** Use `placeholder=" "` with FormControl `layout="floating"` -- the label lifts when input has focus or value.

```tsx
import { Input } from '@constructive-io/ui/input';

<Input type="text" placeholder="Enter value" />
<Input size="sm" />
<Input size="lg" />
<Input unstyled /> {/* For InputGroup usage */}
```

**Error state:** Set `aria-invalid` on the input to trigger red border styling.

```tsx
<Input aria-invalid placeholder="Invalid input" />
```

## Textarea

`@constructive-io/ui/textarea`

Auto-growing text area input.

**Props:** extends `React.ComponentProps<'textarea'>`, adds:
- `unstyled?: boolean` -- strips wrapper styles

**Auto-grow:** Uses `field-sizing-content` CSS for automatic height based on content. Same visual wrapper pattern as Input.

```tsx
import { Textarea } from '@constructive-io/ui/textarea';

<Textarea placeholder="Write something..." />
<Textarea rows={4} /> {/* Minimum rows hint */}
```

## Checkbox

`@constructive-io/ui/checkbox`

Built on `@base-ui/react/checkbox`.

**Props:**
- `checked?: boolean` -- controlled checked state
- `defaultChecked?: boolean` -- uncontrolled initial state
- `onCheckedChange?: (checked: boolean) => void` -- change handler
- `indeterminate?: boolean` -- shows dash instead of check
- `disabled?: boolean`

```tsx
import { Checkbox } from '@constructive-io/ui/checkbox';

<Checkbox />
<Checkbox checked={isChecked} onCheckedChange={setIsChecked} />
<Checkbox indeterminate />
<Checkbox disabled />
```

Renders check mark SVG when checked; indeterminate renders a dash mark.

## CheckboxGroup

`@constructive-io/ui/checkbox-group`

Wraps multiple Checkbox items with coordinated state.

**Props:**
- `allValues: string[]` -- all possible values in the group
- `value?: string[]` -- controlled selected values
- `onValueChange?: (value: string[]) => void` -- change handler

```tsx
import { CheckboxGroup, CheckboxGroupItem } from '@constructive-io/ui/checkbox-group';

<CheckboxGroup
  allValues={['a', 'b', 'c']}
  value={selected}
  onValueChange={setSelected}
>
  <CheckboxGroupItem value="a" label="Option A" />
  <CheckboxGroupItem value="b" label="Option B" />
  <CheckboxGroupItem value="c" label="Option C" />
</CheckboxGroup>
```

## RadioGroup

`@constructive-io/ui/radio-group`

Built on `@base-ui/react/radio-group`.

**RadioGroup props:**
- `value?: string` -- controlled selected value
- `defaultValue?: string` -- uncontrolled initial value
- `onValueChange?: (value: string) => void` -- change handler
- `orientation?: 'horizontal' | 'vertical'` -- layout direction

**Radio / RadioGroupItem props:**
- `value: string` -- the value this option represents
- `disabled?: boolean`

```tsx
import { RadioGroup, RadioGroupItem } from '@constructive-io/ui/radio-group';

<RadioGroup value={value} onValueChange={setValue}>
  <RadioGroupItem value="light" label="Light" />
  <RadioGroupItem value="dark" label="Dark" />
  <RadioGroupItem value="system" label="System" />
</RadioGroup>

<RadioGroup orientation="horizontal">
  <RadioGroupItem value="sm" label="Small" />
  <RadioGroupItem value="md" label="Medium" />
  <RadioGroupItem value="lg" label="Large" />
</RadioGroup>
```

## Switch

`@constructive-io/ui/switch`

Built on `@base-ui/react/switch`.

**Props:**
- `checked?: boolean` -- controlled state
- `defaultChecked?: boolean` -- uncontrolled initial state
- `onCheckedChange?: (checked: boolean) => void` -- change handler
- `disabled?: boolean`

```tsx
import { Switch } from '@constructive-io/ui/switch';

<Switch />
<Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
<Switch disabled />
```

## Select

`@constructive-io/ui/select`

Built on `@base-ui/react/select`. Compound component with multiple sub-components.

**Select (root) props:**
- `value?: string` -- controlled value
- `defaultValue?: string` -- uncontrolled initial value
- `onValueChange?: (value: string) => void` -- change handler

**Sub-components:**
- `SelectTrigger` -- the button that opens the dropdown
- `SelectValue` -- displays selected value text
- `SelectPopup` / `SelectContent` -- the dropdown panel
- `SelectItem` -- standard option (`value: string`, `disabled?: boolean`)
- `SelectRichItem` -- option with icon + description (`value: string`, `icon?: React.ReactNode`, `description?: string`)
- `SelectFieldItem` -- option showing name + type (`value: string`)
- `SelectSeparator` -- visual divider between groups
- `SelectGroup` -- groups related items
- `SelectGroupLabel` / `SelectLabel` -- non-interactive group label

Has scroll arrows for long lists.

```tsx
import {
  Select, SelectTrigger, SelectValue,
  SelectContent, SelectItem, SelectSeparator,
  SelectGroup, SelectLabel, SelectRichItem,
} from '@constructive-io/ui/select';

// Basic
<Select value={value} onValueChange={setValue}>
  <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
  <SelectContent>
    <SelectItem value="one">One</SelectItem>
    <SelectItem value="two">Two</SelectItem>
    <SelectItem value="three">Three</SelectItem>
  </SelectContent>
</Select>

// Grouped with labels
<Select>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Vegetables</SelectLabel>
      <SelectItem value="carrot">Carrot</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>

// Rich items with icons
<Select>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectRichItem value="email" icon={<Mail />} description="Send via email" />
    <SelectRichItem value="sms" icon={<Phone />} description="Send via SMS" />
  </SelectContent>
</Select>
```

## Progress

`@constructive-io/ui/progress`

Built on `@base-ui/react/progress`.

**Props:**
- `value?: number` -- current progress (0 to max)
- `max?: number` -- maximum value (default 100)

Omit `value` for indeterminate (animated) state.

```tsx
import { Progress } from '@constructive-io/ui/progress';

<Progress value={45} />           {/* 45% complete */}
<Progress value={75} max={200} /> {/* 75 of 200 */}
<Progress />                      {/* Indeterminate */}
```
