Build forms using @constructive-io/ui form components with three architectural layers.

## Three-Layer Architecture

Layer 1: **Field** (standalone, no form library)
- `Field` -- vertical layout: label above control, description below, error at bottom
- `FieldRow` -- horizontal layout: control beside label (for checkboxes, switches)

Layer 2: **FormControl** (standalone, layout wrapper)
- Two modes: `stacked` (label above input) and `floating` (CSS floating label)
- Uses `Slot` to inject id, aria-invalid, aria-describedby into child
- No form library dependency

Layer 3: **Form** (react-hook-form integration)
- `Form` = `FormProvider` from react-hook-form
- `FormField` wraps RHF `Controller`
- `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`
- `useFormField` hook for accessing field state

## Decision Guide

| Need | Layer | Components |
|------|-------|------------|
| Simple label + input | Field | `Field`, `FieldRow` |
| Floating labels, stacked layout | FormControl | `FormControl` |
| Form validation + submission | Form | `Form`, `FormField`, `FormItem`, `FormLabel`, `FormMessage` |
| Input addons (icons, buttons) | InputGroup | `InputGroup`, `InputGroupAddon` |

## Field Component

```tsx
import { Field, FieldRow } from '@constructive-io/ui/field';
import { Input } from '@constructive-io/ui/input';
import { Checkbox } from '@constructive-io/ui/checkbox';

// Vertical field
<Field label="Email" description="We'll never share your email" error={errors.email} required>
  <Input type="email" placeholder="name@example.com" />
</Field>

// Horizontal field row (for toggles/checkboxes)
<FieldRow label="Accept terms" description="Required to continue">
  <Checkbox />
</FieldRow>
```

Props: `label: string`, `description?: string`, `error?: string`, `required?: boolean`, `htmlFor?: string`

## InputGroup Component

```tsx
import { InputGroup, InputGroupAddon, InputGroupText, InputGroupInput } from '@constructive-io/ui/input-group';
import { Mail, Search, DollarSign } from 'lucide-react';
import { Button } from '@constructive-io/ui/button';

// Icon addon
<InputGroup>
  <InputGroupAddon position="inline-start">
    <Mail className="size-4 text-muted-foreground" />
  </InputGroupAddon>
  <InputGroupInput placeholder="Email address" />
</InputGroup>

// Text addon
<InputGroup>
  <InputGroupAddon position="inline-start">
    <InputGroupText>https://</InputGroupText>
  </InputGroupAddon>
  <InputGroupInput placeholder="example.com" />
  <InputGroupAddon position="inline-end">
    <InputGroupText>.com</InputGroupText>
  </InputGroupAddon>
</InputGroup>

// Button addon
<InputGroup>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon position="inline-end">
    <Button size="sm" variant="ghost"><Search className="size-4" /></Button>
  </InputGroupAddon>
</InputGroup>

// Block addons (above/below)
<InputGroup>
  <InputGroupAddon position="block-start">
    <span className="text-sm text-muted-foreground">Label above</span>
  </InputGroupAddon>
  <InputGroupInput placeholder="Value" />
  <InputGroupAddon position="block-end">
    <span className="text-xs text-muted-foreground">Helper text below</span>
  </InputGroupAddon>
</InputGroup>
```

Addon positions: `inline-start` (left), `inline-end` (right), `block-start` (above), `block-end` (below). Uses `:has()` CSS selectors for coordinated focus/error states.

## FormControl Component (Floating Label)

```tsx
import { FormControl } from '@constructive-io/ui/form-control';
import { Input } from '@constructive-io/ui/input';

// Stacked layout (default)
<FormControl label="Username" error="Username is required">
  <Input placeholder="Enter username" />
</FormControl>

// Floating label
<FormControl label="Email" layout="floating">
  <Input placeholder=" " />
</FormControl>
```

The floating label works by targeting `placeholder=" "` -- the label lifts when input has focus or value. Props: `label`, `description?`, `error?`, `layout?: 'stacked' | 'floating'`, `required?`.

## Form (React Hook Form Integration)

```tsx
'use client';
import { useForm } from 'react-hook-form';
import {
  Form, FormField, FormItem, FormLabel, FormControl,
  FormDescription, FormMessage,
} from '@constructive-io/ui/form';
import { Input } from '@constructive-io/ui/input';
import { Button } from '@constructive-io/ui/button';

type LoginForm = { email: string; password: string };

function LoginForm() {
  const form = useForm<LoginForm>({
    defaultValues: { email: '', password: '' },
  });

  function onSubmit(data: LoginForm) {
    console.log(data);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          rules={{ required: 'Email is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="name@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          rules={{ required: 'Password is required', minLength: { value: 8, message: 'Min 8 chars' } }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormDescription>Minimum 8 characters</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Sign in</Button>
      </form>
    </Form>
  );
}
```

## Complete Settings Form Example

```tsx
'use client';
import { useForm } from 'react-hook-form';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@constructive-io/ui/form';
import { Input } from '@constructive-io/ui/input';
import { Textarea } from '@constructive-io/ui/textarea';
import { Switch } from '@constructive-io/ui/switch';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@constructive-io/ui/select';
import { Button } from '@constructive-io/ui/button';

type SettingsForm = {
  displayName: string;
  bio: string;
  notifications: boolean;
  theme: string;
};

function SettingsForm() {
  const form = useForm<SettingsForm>({
    defaultValues: { displayName: '', bio: '', notifications: true, theme: 'system' },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(console.log)} className="space-y-6">
        <FormField control={form.control} name="displayName" render={({ field }) => (
          <FormItem>
            <FormLabel>Display Name</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="bio" render={({ field }) => (
          <FormItem>
            <FormLabel>Bio</FormLabel>
            <FormControl><Textarea {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="notifications" render={({ field }) => (
          <FormItem className="flex items-center justify-between">
            <FormLabel>Email Notifications</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )} />

        <FormField control={form.control} name="theme" render={({ field }) => (
          <FormItem>
            <FormLabel>Theme</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger><SelectValue /></SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit">Save settings</Button>
      </form>
    </Form>
  );
}
```

## Field + InputGroup Composition

```tsx
<Field label="Website URL" error={errors.url} required>
  <InputGroup>
    <InputGroupAddon position="inline-start">
      <InputGroupText>https://</InputGroupText>
    </InputGroupAddon>
    <InputGroupInput placeholder="example.com" />
  </InputGroup>
</Field>
```

## Multi-Field Form Layout

```tsx
<div className="grid grid-cols-2 gap-4">
  <Field label="First Name" required>
    <Input placeholder="Jane" />
  </Field>
  <Field label="Last Name" required>
    <Input placeholder="Doe" />
  </Field>
</div>

<Field label="Email" required>
  <InputGroup>
    <InputGroupAddon position="inline-start">
      <Mail className="size-4 text-muted-foreground" />
    </InputGroupAddon>
    <InputGroupInput type="email" placeholder="jane@example.com" />
  </InputGroup>
</Field>

<FieldRow label="Subscribe to newsletter">
  <Checkbox />
</FieldRow>
```

## Zod Validation with React Hook Form

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from '@constructive-io/ui/form';
import { Input } from '@constructive-io/ui/input';
import { Button } from '@constructive-io/ui/button';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  age: z.coerce.number().min(18, 'Must be 18 or older'),
});

type FormData = z.infer<typeof schema>;

function ValidatedForm() {
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', age: undefined },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(console.log)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="age" render={({ field }) => (
          <FormItem>
            <FormLabel>Age</FormLabel>
            <FormControl><Input type="number" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
```

## Error Display Patterns

```tsx
// Field-level error
<Field label="Email" error="This email is already taken">
  <Input type="email" aria-invalid />
</Field>

// FormMessage auto-displays from react-hook-form state
<FormField control={form.control} name="email" render={({ field }) => (
  <FormItem>
    <FormLabel>Email</FormLabel>
    <FormControl><Input {...field} /></FormControl>
    <FormMessage /> {/* Renders error string from RHF field state */}
  </FormItem>
)} />

// FormControl stacked with error
<FormControl label="Username" error="Username is taken">
  <Input aria-invalid />
</FormControl>
```

Error styling: `aria-invalid` on the input triggers red border via CSS. `FormMessage` / `error` prop renders red text below the field.

## Best Practices

- Use `Field` for simple forms without validation libraries
- Use `Form` + `FormField` when you need validation (react-hook-form)
- `FormControl` floating label requires `placeholder=" "` on the input
- InputGroup coordinates focus/error states across all children via CSS `:has()`
- Combine Field with InputGroup for labeled inputs with addons
- Use `FieldRow` for boolean controls (checkbox, switch) that sit beside their label
- Always set `defaultValues` in `useForm` to avoid uncontrolled-to-controlled warnings
- Use `zodResolver` for schema-based validation over inline `rules`
- Keep form state at the page/feature level, not in global stores
- Use `'use client'` directive on any component that calls `useForm`
