# constructive-ui-data-display

Data display and feedback components from `@constructive-io/ui`.

## Table

Full hierarchy: `Table > TableHeader/TableBody/TableFooter > TableRow > TableHead/TableCell`. Optional `TableCaption`.

```tsx
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@constructive-io/ui/table';

function UsersTable({ users }: { users: User[] }) {
  return (
    <Table>
      <TableCaption>Active team members</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[200px]">Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead className="text-right">Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="font-medium">{user.name}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell className="text-right">{user.role}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### Table Styling Patterns

Table is unstyled by default. Apply your own patterns:

| Pattern | How |
|---------|-----|
| Striped rows | `even:bg-muted/50` on `TableRow` |
| Bordered | `border` on `Table`, `border-b` on `TableRow` |
| Compact | `[&_td]:py-1 [&_th]:py-1` on `Table` |
| Hover highlight | `hover:bg-muted/50` on `TableRow` |
| Fixed header | Wrap in scrollable container, `sticky top-0 bg-background` on `TableHeader` |

### Table with Footer Totals

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Item</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {items.map((item) => (
      <TableRow key={item.id}>
        <TableCell>{item.name}</TableCell>
        <TableCell className="text-right">${item.amount.toFixed(2)}</TableCell>
      </TableRow>
    ))}
  </TableBody>
  <TableFooter>
    <TableRow>
      <TableCell className="font-medium">Total</TableCell>
      <TableCell className="text-right font-medium">${total.toFixed(2)}</TableCell>
    </TableRow>
  </TableFooter>
</Table>
```

## Badge

Semantic status indicators with size variants.

```tsx
import { Badge } from '@constructive-io/ui/badge';
```

### Variants

```tsx
<Badge variant="default">Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="error">Error</Badge>
<Badge variant="warning">Warning</Badge>
<Badge variant="info">Info</Badge>
<Badge variant="success">Success</Badge>
```

### Sizes

```tsx
<Badge size="sm">Small</Badge>
<Badge size="default">Default</Badge>
<Badge size="lg">Large</Badge>
```

### Badge with Dot Indicator

```tsx
function StatusBadge({ status }: { status: 'active' | 'inactive' | 'pending' }) {
  const config = {
    active: { variant: 'success' as const, label: 'Active' },
    inactive: { variant: 'secondary' as const, label: 'Inactive' },
    pending: { variant: 'warning' as const, label: 'Pending' },
  };

  const { variant, label } = config[status];

  return (
    <Badge variant={variant} size="sm">
      <span className="mr-1 inline-block size-1.5 rounded-full bg-current" />
      {label}
    </Badge>
  );
}
```

## Alert

Banners for notices, warnings, and errors. Icon is positioned absolutely — use `pl-7` when an icon is present.

```tsx
import { Alert, AlertTitle, AlertDescription } from '@constructive-io/ui/alert';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
```

### Variants

```tsx
// Success
<Alert variant="default">
  <CheckCircle2 className="size-4" />
  <AlertTitle>Success</AlertTitle>
  <AlertDescription>Your changes have been saved.</AlertDescription>
</Alert>

// Error
<Alert variant="destructive">
  <AlertCircle className="size-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Something went wrong. Please try again.</AlertDescription>
</Alert>

// Informational
<Alert variant="default">
  <Info className="size-4" />
  <AlertTitle>Note</AlertTitle>
  <AlertDescription>This action cannot be undone.</AlertDescription>
</Alert>
```

### Alert without Title

```tsx
<Alert variant="default">
  <Info className="size-4" />
  <AlertDescription>Your session will expire in 5 minutes.</AlertDescription>
</Alert>
```

## Avatar

Image with fallback to initials.

```tsx
import { Avatar, AvatarImage, AvatarFallback } from '@constructive-io/ui/avatar';
```

### Basic Usage

```tsx
<Avatar>
  <AvatarImage src="/avatars/user.jpg" alt="Jane Doe" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

### Initials Helper

Extract 2-letter initials from a name:

```ts
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
```

### Avatar Group

```tsx
function AvatarGroup({ users }: { users: { name: string; avatar?: string }[] }) {
  const visible = users.slice(0, 4);
  const remaining = users.length - visible.length;

  return (
    <div className="flex -space-x-2">
      {visible.map((user) => (
        <Avatar key={user.name} className="size-8 border-2 border-background">
          {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
          <AvatarFallback className="text-xs">{getInitials(user.name)}</AvatarFallback>
        </Avatar>
      ))}
      {remaining > 0 && (
        <Avatar className="size-8 border-2 border-background">
          <AvatarFallback className="text-xs">+{remaining}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
```

## Skeleton

Animated loading placeholders. Match dimensions to loaded content to prevent layout shift.

```tsx
import { Skeleton } from '@constructive-io/ui/skeleton';
```

### Card Skeleton

```tsx
<div className="flex flex-col gap-3">
  <Skeleton className="h-[200px] w-full rounded-lg" />
  <Skeleton className="h-4 w-3/4" />
  <Skeleton className="h-4 w-1/2" />
</div>
```

### Table Row Skeleton

```tsx
<TableRow>
  <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
  <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
</TableRow>
```

### Form Skeleton

```tsx
<div className="space-y-4">
  <Skeleton className="h-4 w-[100px]" />
  <Skeleton className="h-10 w-full" />
  <Skeleton className="h-4 w-[120px]" />
  <Skeleton className="h-10 w-full" />
</div>
```

## Progress

Determinate (with value) and indeterminate (no value) progress bars.

```tsx
import { Progress } from '@constructive-io/ui/progress';

// Determinate
<Progress value={66} />
<Progress value={100} />

// Indeterminate (animated)
<Progress />
```

### Progress with Label

```tsx
function LabeledProgress({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{value}%</span>
      </div>
      <Progress value={value} />
    </div>
  );
}
```

## Toast / Sonner

Toast notification system using `sonner`.

### Layout Setup (Once)

Add `Toaster` to your root layout:

```tsx
import { Toaster } from '@constructive-io/ui/sonner';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

### Basic Toasts

```tsx
import { toast } from 'sonner';

toast.success('Saved successfully');
toast.error('Failed to save');
toast.warning('Disk space low');
toast.info('New update available');
```

### Styled Variants with Icons

```tsx
import {
  showErrorToast,
  showSuccessToast,
  showWarningToast,
  showInfoToast,
} from '@constructive-io/ui/toast';

showSuccessToast('Changes saved');
showErrorToast('Operation failed', 'Please try again');
showWarningToast('Approaching limit');
showInfoToast('Tip: Use keyboard shortcuts');
```

### Toast with Action

```tsx
toast('File deleted', {
  action: {
    label: 'Undo',
    onClick: () => restoreFile(fileId),
  },
});
```

### Promise Toast

```tsx
toast.promise(saveData(), {
  loading: 'Saving...',
  success: 'Data saved',
  error: 'Failed to save',
});
```

## Visual Effects

Decorative animated backgrounds and scroll effects for landing pages and feature sections.

### FlickeringGrid

```tsx
import { FlickeringGrid } from '@constructive-io/ui/flickering-grid';

<div className="relative h-[400px]">
  <FlickeringGrid className="absolute inset-0" />
  <div className="relative z-10">Content on top</div>
</div>
```

### MotionGrid

```tsx
import { MotionGrid } from '@constructive-io/ui/motion-grid';

<div className="relative overflow-hidden rounded-lg">
  <MotionGrid className="absolute inset-0 opacity-30" />
  <div className="relative z-10 p-8">Overlay content</div>
</div>
```

### ProgressiveBlur

Fade-out effect at scroll edges:

```tsx
import { ProgressiveBlur } from '@constructive-io/ui/progressive-blur';

<div className="relative">
  <div className="h-[300px] overflow-auto">
    {/* Scrollable content */}
  </div>
  <ProgressiveBlur className="pointer-events-none absolute bottom-0 h-20 w-full" />
</div>
```

### ProgressiveBlurScrollContainer

Wraps children with automatic blur at scroll edges:

```tsx
import { ProgressiveBlurScrollContainer } from '@constructive-io/ui/progressive-blur';

<ProgressiveBlurScrollContainer className="h-[400px]">
  {longContent}
</ProgressiveBlurScrollContainer>
```

### ResponsiveDiagram

Auto-scales diagram content to fit its container:

```tsx
import { ResponsiveDiagram } from '@constructive-io/ui/responsive-diagram';

<ResponsiveDiagram className="h-[300px] w-full">
  <svg viewBox="0 0 800 600">{/* Diagram content */}</svg>
</ResponsiveDiagram>
```

## Component Quick Reference

| Component | Import Path | Key Props |
|-----------|-------------|-----------|
| Table family | `@constructive-io/ui/table` | Standard HTML table semantics |
| Badge | `@constructive-io/ui/badge` | `variant`, `size` |
| Alert family | `@constructive-io/ui/alert` | `variant` (`default`, `destructive`) |
| Avatar family | `@constructive-io/ui/avatar` | `src`, `alt`, fallback children |
| Skeleton | `@constructive-io/ui/skeleton` | Dimensions via `className` |
| Progress | `@constructive-io/ui/progress` | `value` (omit for indeterminate) |
| Toaster | `@constructive-io/ui/sonner` | Layout-level setup |
| Toast helpers | `@constructive-io/ui/toast` | `showSuccessToast`, etc. |
| FlickeringGrid | `@constructive-io/ui/flickering-grid` | Decorative background |
| MotionGrid | `@constructive-io/ui/motion-grid` | Animated background |
| ProgressiveBlur | `@constructive-io/ui/progressive-blur` | Scroll fade effect |
| ResponsiveDiagram | `@constructive-io/ui/responsive-diagram` | Auto-scaling container |

## Best Practices

- Use semantic Badge variants (`success`, `error`, `warning`, `info`) over custom colors for consistent meaning
- Skeleton dimensions should match the loaded content to avoid layout shift — use fractional widths (`w-3/4`, `w-1/2`) to mimic text
- Always provide `alt` text for Avatar images; use 2-letter initials for the fallback
- Set up `Toaster` once in root layout, then call `toast` functions from anywhere in the app
- Table is unstyled by default — apply striping, borders, and hover patterns to match your design
- Prefer `showSuccessToast` / `showErrorToast` helpers over raw `toast.success` / `toast.error` for consistent styling with icons
- Use `toast.promise` for async operations to show loading/success/error states automatically
- Place visual effects (`FlickeringGrid`, `MotionGrid`) behind content with `absolute inset-0` and `z-10` on the foreground
- Keep Alert messages concise — use `AlertDescription` for details, `AlertTitle` for the headline
