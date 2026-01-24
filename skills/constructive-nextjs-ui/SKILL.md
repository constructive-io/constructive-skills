# Constructive Next.js UI Kit

Build modern Next.js applications using the @constructive-io/ui component library.

## When to Apply

Use this skill when:
- Creating a new Next.js application with Constructive UI components
- Building dashboards, admin panels, or web applications
- Setting up a project with @constructive-io/ui
- Looking for component usage examples and patterns

## Overview

The @constructive-io/ui library is a modern React component library built on Base UI primitives and Tailwind CSS v4. It provides 50+ production-ready components with consistent styling, dark mode support, and full TypeScript types.

## Project Setup

### 1. Create a New Next.js Project

```bash
npx create-next-app@latest my-app --typescript --tailwind --eslint --app --src-dir
cd my-app
```

### 2. Install Dependencies

```bash
# Core package
pnpm add @constructive-io/ui

# Required peer dependencies
pnpm add @base-ui/react lucide-react

# Optional peer dependencies (install as needed)
pnpm add motion @use-gesture/react  # For Stack component and animations
pnpm add sonner                      # For Toast notifications
pnpm add vaul                        # For Drawer component
pnpm add react-hook-form             # For Form utilities
pnpm add react-aria-components @internationalized/date  # For Calendar
pnpm add react-resizable-panels      # For Resizable panels
```

### 3. Configure Tailwind CSS v4

Update your `src/app/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";

/* Required: Tell Tailwind to scan the UI package */
@source "../node_modules/@constructive-io";

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.3211 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.3211 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.3211 0 0);
  --primary: oklch(0.688 0.1754 245.6151);
  --primary-foreground: oklch(0.979 0.021 166.113);
  --secondary: oklch(0.967 0.001 286.375);
  --secondary-foreground: oklch(0.21 0.006 285.885);
  --muted: oklch(0.967 0.001 286.375);
  --muted-foreground: oklch(0.552 0.016 285.938);
  --accent: oklch(0.967 0.001 286.375);
  --accent-foreground: oklch(0.21 0.006 285.885);
  --destructive: oklch(0.55 0.2 25);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.92 0.004 286.32);
  --input: oklch(0.871 0.006 286.286);
  --ring: oklch(0.871 0.006 286.286);
  --radius: 0.5rem;
}

.dark {
  --background: oklch(0.21 0.006 285.885);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.21 0.006 285.885);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.21 0.006 285.885);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.688 0.1754 245.6151);
  --primary-foreground: oklch(0.979 0.021 166.113);
  --secondary: oklch(0.274 0.006 286.033);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.244 0.006 285.97);
  --muted-foreground: oklch(0.705 0.015 286.067);
  --accent: oklch(0.244 0.006 285.97);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.55 0.2 25);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.29 0.009 285.83);
  --input: oklch(0.29 0.009 285.83);
  --ring: oklch(0.442 0.017 285.786);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-xl: calc(var(--radius) + 6px);
}

@layer base {
  * {
    @apply border-border/60 outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    position: relative;
  }
  #__next,
  [data-nextjs-root-layout] {
    isolation: isolate;
  }
}
```

## Component Reference

### Importing Components

Import components individually for tree-shaking:

```tsx
import { Button } from '@constructive-io/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@constructive-io/ui/card';
import { Input } from '@constructive-io/ui/input';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '@constructive-io/ui/dialog';
```

### Available Components

**Layout Components**
- `Card` - Container with header, content, footer sections
- `Separator` - Visual divider
- `Tabs` - Tabbed interface
- `Collapsible` - Expandable/collapsible sections
- `ScrollArea` - Custom scrollable area
- `Resizable` - Resizable panel layouts

**Form Components**
- `Button` - Buttons with variants (default, secondary, outline, ghost, destructive)
- `Input` - Text input
- `Textarea` - Multiline text input
- `Checkbox` - Checkbox with label
- `Switch` - Toggle switch
- `Select` - Dropdown select
- `RadioGroup` - Radio button group
- `Label` - Form labels
- `Progress` - Progress bar

**Feedback Components**
- `Alert` - Alert messages
- `Badge` - Status indicators
- `Skeleton` - Loading placeholders
- `Toast` - Toast notifications (requires sonner)

**Overlay Components**
- `Dialog` - Modal dialogs
- `AlertDialog` - Confirmation dialogs
- `Sheet` - Slide-out panels
- `Drawer` - Bottom drawer (requires vaul)
- `Popover` - Floating content
- `Tooltip` - Hover tooltips
- `DropdownMenu` - Context menus

**Data Components**
- `Table` - Data tables
- `Pagination` - Page navigation
- `Avatar` - User avatars
- `Breadcrumb` - Navigation breadcrumbs

**Advanced Components**
- `Command` - Command palette
- `Combobox` - Searchable select
- `Autocomplete` - Auto-complete input
- `MultiSelect` - Multi-value select
- `Stack` - Navigation card stack (requires motion)
- `Calendar` - Date picker (requires react-aria-components)

## Usage Examples

### Basic Card with Button

```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@constructive-io/ui/card';
import { Button } from '@constructive-io/ui/button';

export function MyCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome</CardTitle>
      </CardHeader>
      <CardContent>
        <p>This is a card with some content.</p>
      </CardContent>
      <CardFooter>
        <Button>Get Started</Button>
      </CardFooter>
    </Card>
  );
}
```

### Form with Input and Button

```tsx
import { Input } from '@constructive-io/ui/input';
import { Button } from '@constructive-io/ui/button';
import { Label } from '@constructive-io/ui/label';

export function LoginForm() {
  return (
    <form className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="you@example.com" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" />
      </div>
      <Button type="submit" className="w-full">Sign In</Button>
    </form>
  );
}
```

### Dialog Modal

```tsx
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@constructive-io/ui/dialog';
import { Button } from '@constructive-io/ui/button';

export function ConfirmDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Tabs Interface

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@constructive-io/ui/tabs';

export function SettingsTabs() {
  return (
    <Tabs defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="general">
        <p>General settings content</p>
      </TabsContent>
      <TabsContent value="security">
        <p>Security settings content</p>
      </TabsContent>
      <TabsContent value="notifications">
        <p>Notification settings content</p>
      </TabsContent>
    </Tabs>
  );
}
```

### Select Dropdown

```tsx
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@constructive-io/ui/select';

export function StatusSelect() {
  return (
    <Select>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Select status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="inactive">Inactive</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

### Data Table

```tsx
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@constructive-io/ui/table';
import { Badge } from '@constructive-io/ui/badge';

const users = [
  { id: 1, name: 'Alice', email: 'alice@example.com', status: 'active' },
  { id: 2, name: 'Bob', email: 'bob@example.com', status: 'pending' },
];

export function UsersTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>{user.name}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell>
              <Badge variant={user.status === 'active' ? 'default' : 'secondary'}>
                {user.status}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Alert Messages

```tsx
import { Alert, AlertTitle, AlertDescription } from '@constructive-io/ui/alert';
import { AlertCircle, CheckCircle } from 'lucide-react';

export function Alerts() {
  return (
    <div className="space-y-4">
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>
          You can add components to your app using the cli.
        </AlertDescription>
      </Alert>
      
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Something went wrong. Please try again.
        </AlertDescription>
      </Alert>
    </div>
  );
}
```

## Button Variants

```tsx
<Button variant="default">Default</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>
<Button size="icon"><PlusIcon /></Button>
```

## Card Variants

```tsx
<Card variant="default">Default shadow</Card>
<Card variant="elevated">Prominent shadow</Card>
<Card variant="flat">No shadow</Card>
<Card variant="interactive">Hover lift effect</Card>
<Card variant="ghost">Transparent background</Card>
```

## Dark Mode

Add the `dark` class to enable dark mode:

```tsx
// In your layout or root component
<html className="dark">
  {/* Components automatically use dark theme */}
</html>
```

Or toggle dynamically:

```tsx
function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);
  
  return (
    <Button onClick={() => setIsDark(!isDark)}>
      Toggle Theme
    </Button>
  );
}
```

## Styling with data-slot

Components use `data-slot` attributes for styling hooks:

```css
/* Target specific component parts */
[data-slot="card-header"] {
  /* custom styles */
}

[data-slot="button"] {
  /* custom styles */
}
```

## TypeScript Support

Full TypeScript support with exported types:

```tsx
import type { ButtonProps } from '@constructive-io/ui/button';
import type { CardProps } from '@constructive-io/ui/card';

const MyButton = (props: ButtonProps) => <Button {...props} />;
```

## Tailwind CSS v4 Notes

Remember these Tailwind v4 changes:
- `shadow-sm` is now `shadow-xs`, `shadow` is now `shadow-sm`
- `rounded-sm` is now `rounded-xs`, `rounded` is now `rounded-sm`
- `outline-none` is now `outline-hidden`
- Use `bg-black/50` instead of `bg-opacity-*`
- CSS variables: use `bg-(--brand)` not `bg-[--brand]`

## Best Practices

1. **Import individually** - Always import components from their specific paths for tree-shaking
2. **Use semantic variants** - Choose button/card variants that match the action's importance
3. **Consistent spacing** - Use Tailwind's spacing utilities (space-y-4, gap-4, etc.)
4. **Accessible labels** - Always provide labels for form inputs
5. **Loading states** - Use Skeleton components for loading placeholders
6. **Error handling** - Use Alert components for error messages
7. **Responsive design** - Components are mobile-friendly by default

## References

- [@constructive-io/ui on npm](https://www.npmjs.com/package/@constructive-io/ui)
- [Base UI Documentation](https://base-ui.com/)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [Lucide Icons](https://lucide.dev/)
