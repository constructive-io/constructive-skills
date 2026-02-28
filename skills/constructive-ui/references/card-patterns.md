# Card Patterns Reference

Usage patterns for the `Card` component from `@constructive-io/ui/card` — variants, layout compositions, and common dashboard patterns.

## Card Variants

The Card component uses `cva` with 5 variants:

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@constructive-io/ui/card';

// Default — standard bordered card with subtle shadow
<Card>...</Card>

// Elevated — more prominent shadow for featured content
<Card variant="elevated">...</Card>

// Flat — no shadow, stronger border for dense layouts
<Card variant="flat">...</Card>

// Ghost — transparent background, no border/shadow for inline grouping
<Card variant="ghost">...</Card>

// Interactive — hover effects (lift + shadow + border) for clickable cards
<Card variant="interactive">...</Card>
```

### Variant Details

| Variant | Styles | Use When |
|---------|--------|----------|
| `default` | `border-border/50 shadow-card` | Standard content containers |
| `elevated` | `border-border/40 shadow-card-lg` | Featured or highlighted content |
| `flat` | `border-border/60 shadow-none` | Dense layouts, sidebars, tables |
| `ghost` | `border-transparent bg-transparent shadow-none` | Semantic grouping without visual weight |
| `interactive` | `hover:shadow-card-lg hover:-translate-y-0.5 cursor-pointer` | Clickable cards, links, selections |

## Card Sub-Components

```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description text</CardDescription>
    <CardAction>
      <Button variant="outline" size="sm">Action</Button>
    </CardAction>
  </CardHeader>
  <CardContent>
    {/* Main content */}
  </CardContent>
  <CardFooter>
    {/* Footer actions */}
  </CardFooter>
</Card>
```

### data-slot Selectors

```css
[data-slot="card"]             { /* root container */ }
[data-slot="card-header"]      { /* header area */ }
[data-slot="card-title"]       { /* title text */ }
[data-slot="card-description"] { /* description text */ }
[data-slot="card-action"]      { /* action area (top-right) */ }
[data-slot="card-content"]     { /* main content area */ }
[data-slot="card-footer"]      { /* footer area */ }
```

## Common Patterns

### Stat Card (Dashboard Metrics)

```tsx
<Card>
  <CardHeader>
    <CardDescription>Total Revenue</CardDescription>
    <CardTitle className="text-2xl font-semibold tabular-nums">
      $45,231.89
    </CardTitle>
    <CardAction>
      <Badge variant="outline">+20.1%</Badge>
    </CardAction>
  </CardHeader>
  <CardContent>
    <div className="text-xs text-muted-foreground">
      +$2,100 from last month
    </div>
  </CardContent>
</Card>
```

### Profile Card

```tsx
<Card>
  <CardHeader>
    <div className="flex items-center gap-4">
      <Avatar>
        <AvatarImage src={user.avatar} alt={user.name} />
        <AvatarFallback>{user.initials}</AvatarFallback>
      </Avatar>
      <div>
        <CardTitle>{user.name}</CardTitle>
        <CardDescription>{user.role}</CardDescription>
      </div>
    </div>
    <CardAction>
      <Button variant="outline" size="sm">Edit</Button>
    </CardAction>
  </CardHeader>
  <CardContent>
    <div className="grid gap-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Email</span>
        <span>{user.email}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Department</span>
        <span>{user.department}</span>
      </div>
    </div>
  </CardContent>
</Card>
```

### Product Card (Interactive)

```tsx
<Card variant="interactive" className="overflow-hidden">
  <div className="aspect-video bg-muted" />
  <CardHeader>
    <CardTitle>{product.name}</CardTitle>
    <CardDescription>${product.price}</CardDescription>
    <CardAction>
      <Badge variant={product.inStock ? 'secondary' : 'destructive'}>
        {product.inStock ? 'In Stock' : 'Out of Stock'}
      </Badge>
    </CardAction>
  </CardHeader>
  <CardContent>
    <p className="text-sm text-muted-foreground line-clamp-2">
      {product.description}
    </p>
  </CardContent>
  <CardFooter>
    <Button className="w-full">Add to Cart</Button>
  </CardFooter>
</Card>
```

### Blog Post Card

```tsx
<Card variant="interactive">
  <CardHeader>
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{post.category}</span>
      <span>&middot;</span>
      <span>{post.readTime} min read</span>
    </div>
    <CardTitle className="text-lg">{post.title}</CardTitle>
    <CardDescription>{post.excerpt}</CardDescription>
  </CardHeader>
  <CardFooter className="flex items-center gap-3">
    <Avatar className="h-8 w-8">
      <AvatarImage src={post.author.avatar} />
      <AvatarFallback>{post.author.initials}</AvatarFallback>
    </Avatar>
    <div className="text-sm">
      <p className="font-medium">{post.author.name}</p>
      <p className="text-muted-foreground">{post.date}</p>
    </div>
  </CardFooter>
</Card>
```

## Grid Layouts

### 3-Column Stats Grid

```tsx
<div className="grid gap-4 md:grid-cols-3">
  <Card>
    <CardHeader>
      <CardDescription>Total Users</CardDescription>
      <CardTitle className="text-2xl tabular-nums">2,350</CardTitle>
    </CardHeader>
  </Card>
  <Card>
    <CardHeader>
      <CardDescription>Active Sessions</CardDescription>
      <CardTitle className="text-2xl tabular-nums">1,247</CardTitle>
    </CardHeader>
  </Card>
  <Card>
    <CardHeader>
      <CardDescription>Revenue</CardDescription>
      <CardTitle className="text-2xl tabular-nums">$45,231</CardTitle>
    </CardHeader>
  </Card>
</div>
```

### Dashboard Layout (Mixed Widths)

```tsx
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {/* Span 2 columns for featured card */}
  <Card className="md:col-span-2">
    <CardHeader>
      <CardTitle>Overview</CardTitle>
    </CardHeader>
    <CardContent>{/* Chart or main content */}</CardContent>
  </Card>
  <Card>
    <CardHeader>
      <CardTitle>Recent Activity</CardTitle>
    </CardHeader>
    <CardContent>{/* Activity list */}</CardContent>
  </Card>
</div>
```

## Header/Footer Border Pattern

Add visual separation with Tailwind border utilities:

```tsx
<Card>
  <CardHeader className="border-b">
    <CardTitle>Settings</CardTitle>
  </CardHeader>
  <CardContent className="pt-6">
    {/* Form fields */}
  </CardContent>
  <CardFooter className="border-t pt-6">
    <Button>Save Changes</Button>
  </CardFooter>
</Card>
```

## TypeScript

```typescript
import type { CardProps } from '@constructive-io/ui/card';

// CardProps extends React.ComponentProps<'div'> & VariantProps<typeof cardVariants>
// Available variants: 'default' | 'elevated' | 'flat' | 'ghost' | 'interactive'
```
