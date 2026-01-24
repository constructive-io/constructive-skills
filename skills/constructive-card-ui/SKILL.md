# Constructive Card UI Patterns

Build beautiful card-based interfaces using the @constructive-io/ui Card component.

## When to Apply

Use this skill when:
- Building card-based layouts (dashboards, product grids, blog posts)
- Creating stat cards, profile cards, or product cards
- Designing interactive clickable cards
- Implementing dashboard layouts with multiple card variants

## Overview

The Card component from @constructive-io/ui provides a flexible container with multiple variants, sub-components, and styling options. Cards are perfect for grouping related content and creating visually distinct sections.

## Card Components

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from '@constructive-io/ui/card';
```

### Component Hierarchy

```
Card
├── CardHeader
│   ├── CardTitle
│   ├── CardDescription
│   └── CardAction (optional, positions in top-right)
├── CardContent
└── CardFooter
```

## Card Variants

The Card component supports 5 variants:

### Default
Subtle shadow with standard border. Best for most use cases.

```tsx
<Card variant="default">
  <CardHeader>
    <CardTitle>Default Card</CardTitle>
    <CardDescription>Subtle shadow, standard border</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-muted-foreground text-sm">Best for most use cases.</p>
  </CardContent>
</Card>
```

### Elevated
Larger shadow for prominence. Ideal for featured or important content.

```tsx
<Card variant="elevated">
  <CardHeader>
    <CardTitle>Featured Content</CardTitle>
    <CardDescription>This card demands attention</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-muted-foreground text-sm">
      Elevated cards have a more prominent shadow, ideal for hero sections.
    </p>
  </CardContent>
</Card>
```

### Flat
No shadow, border only. Minimal, clean appearance for dense layouts.

```tsx
<Card variant="flat">
  <CardHeader>
    <CardTitle>Minimal Card</CardTitle>
    <CardDescription>Clean and understated</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-muted-foreground text-sm">
      Flat cards work well in dense layouts or when you want minimal visual noise.
    </p>
  </CardContent>
</Card>
```

### Ghost
Transparent background, no border or shadow. For seamless integration.

```tsx
<Card variant="ghost">
  <CardHeader>
    <CardTitle>Ghost Card</CardTitle>
    <CardDescription>Blends into the background</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-muted-foreground text-sm">
      Ghost cards are transparent and blend seamlessly with the page.
    </p>
  </CardContent>
</Card>
```

### Interactive
Hover lift effect with enhanced shadow. Perfect for clickable cards.

```tsx
<Card variant="interactive">
  <CardHeader>
    <CardTitle>Clickable Card</CardTitle>
    <CardDescription>Hover to see the lift effect</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-muted-foreground text-sm">
      Interactive cards lift on hover, perfect for navigation items.
    </p>
  </CardContent>
  <CardFooter className="justify-between">
    <span className="text-muted-foreground text-sm">Learn more</span>
    <ArrowRight className="text-muted-foreground h-4 w-4" />
  </CardFooter>
</Card>
```

## Common Card Patterns

### Card with Action Button

Use CardAction to place a button in the header's top-right corner:

```tsx
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@constructive-io/ui/button';

<Card>
  <CardHeader>
    <CardTitle>Card with Action</CardTitle>
    <CardAction>
      <Button variant="ghost" size="icon">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </CardAction>
    <CardDescription>This card has an action button in the header.</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-sm">Content with header action.</p>
  </CardContent>
</Card>
```

### Stat Card (Dashboard Metrics)

Compact cards for displaying key metrics:

```tsx
import { TrendingUp } from 'lucide-react';

<Card className="w-[250px]">
  <CardHeader className="pb-2">
    <CardDescription>Total Revenue</CardDescription>
    <CardTitle className="text-3xl">$45,231.89</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="flex items-center gap-1 text-sm text-success">
      <TrendingUp className="h-4 w-4" />
      <span>+20.1% from last month</span>
    </div>
  </CardContent>
</Card>
```

### User Profile Card

Card with avatar and user information:

```tsx
<Card className="w-[350px]">
  <CardHeader>
    <div className="flex items-center space-x-4">
      <div className="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-full font-semibold">
        JD
      </div>
      <div>
        <CardTitle>John Doe</CardTitle>
        <CardDescription>Software Engineer</CardDescription>
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <p className="text-sm">Passionate about building great user experiences.</p>
    <div className="text-muted-foreground mt-4 flex justify-between text-sm">
      <span>Followers: 1,234</span>
      <span>Following: 567</span>
    </div>
  </CardContent>
  <CardFooter>
    <Button className="w-full">Follow</Button>
  </CardFooter>
</Card>
```

### Product Card

E-commerce style card with image placeholder, price, and actions:

```tsx
import { Heart, Star } from 'lucide-react';
import { Button } from '@constructive-io/ui/button';

<Card variant="interactive" className="w-[300px]">
  <CardHeader>
    <div className="bg-muted/50 mb-2 aspect-square rounded-lg">
      {/* Product image goes here */}
    </div>
    <CardTitle>Wireless Headphones</CardTitle>
    <CardDescription>Premium noise-cancelling headphones</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="flex items-center justify-between">
      <span className="text-2xl font-bold">$299</span>
      <div className="flex items-center gap-1">
        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
        <span className="text-muted-foreground text-sm">4.9</span>
      </div>
    </div>
  </CardContent>
  <CardFooter className="flex gap-2">
    <Button className="flex-1">Add to Cart</Button>
    <Button variant="outline" size="icon">
      <Heart className="h-4 w-4" />
    </Button>
  </CardFooter>
</Card>
```

### Blog Post Card

Card for article previews with tags:

```tsx
import { Badge } from '@constructive-io/ui/badge';
import { Button } from '@constructive-io/ui/button';

<Card className="w-[400px]">
  <CardHeader>
    <CardTitle>Getting Started with React</CardTitle>
    <CardDescription>Published on March 15, 2024</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-muted-foreground text-sm">
      Learn the fundamentals of React and how to build your first component.
      This tutorial covers everything you need to know to get started.
    </p>
    <div className="mt-4 flex gap-2">
      <Badge variant="secondary">React</Badge>
      <Badge variant="secondary">Tutorial</Badge>
      <Badge variant="secondary">Beginner</Badge>
    </div>
  </CardContent>
  <CardFooter>
    <Button>Read More</Button>
  </CardFooter>
</Card>
```

## Card Grid Layouts

### Simple 3-Column Grid

```tsx
<div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-3">
  <Card>
    <CardHeader>
      <CardTitle>Card 1</CardTitle>
      <CardDescription>First card in the grid.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm">Content for card 1.</p>
    </CardContent>
  </Card>
  <Card>
    <CardHeader>
      <CardTitle>Card 2</CardTitle>
      <CardDescription>Second card in the grid.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm">Content for card 2.</p>
    </CardContent>
  </Card>
  <Card>
    <CardHeader>
      <CardTitle>Card 3</CardTitle>
      <CardDescription>Third card in the grid.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm">Content for card 3.</p>
    </CardContent>
  </Card>
</div>
```

### Dashboard Layout with Stats

A complete dashboard layout with stat cards and a main content area:

```tsx
<div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-4">
  {/* Stats row - 4 small cards */}
  <Card className="col-span-1">
    <CardHeader className="pb-2">
      <CardDescription>Users</CardDescription>
      <CardTitle className="text-2xl">2,350</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground text-xs">+180 this week</p>
    </CardContent>
  </Card>
  
  <Card className="col-span-1">
    <CardHeader className="pb-2">
      <CardDescription>Revenue</CardDescription>
      <CardTitle className="text-2xl">$12.5k</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-xs text-success">+12.3%</p>
    </CardContent>
  </Card>
  
  <Card className="col-span-1">
    <CardHeader className="pb-2">
      <CardDescription>Orders</CardDescription>
      <CardTitle className="text-2xl">1,247</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground text-xs">+32 today</p>
    </CardContent>
  </Card>
  
  <Card className="col-span-1">
    <CardHeader className="pb-2">
      <CardDescription>Conversion</CardDescription>
      <CardTitle className="text-2xl">3.2%</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-xs text-success">+0.4%</p>
    </CardContent>
  </Card>

  {/* Main content - full width elevated card */}
  <Card variant="elevated" className="col-span-2 md:col-span-4">
    <CardHeader>
      <CardTitle>Recent Activity</CardTitle>
      <CardDescription>Your latest updates and notifications</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="text-muted-foreground space-y-3 text-sm">
        <p>Activity content would go here...</p>
      </div>
    </CardContent>
  </Card>
</div>
```

## Styling with data-slot

Cards use `data-slot` attributes for targeted CSS styling:

```css
/* Target specific card parts */
[data-slot="card"] {
  /* Custom card styles */
}

[data-slot="card-header"] {
  /* Custom header styles */
}

[data-slot="card-title"] {
  /* Custom title styles */
}

[data-slot="card-description"] {
  /* Custom description styles */
}

[data-slot="card-content"] {
  /* Custom content styles */
}

[data-slot="card-footer"] {
  /* Custom footer styles */
}

[data-slot="card-action"] {
  /* Custom action button area styles */
}
```

## Adding Borders to Header/Footer

Cards support conditional borders on header and footer:

```tsx
{/* Header with bottom border */}
<Card>
  <CardHeader className="border-b">
    <CardTitle>Bordered Header</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
</Card>

{/* Footer with top border */}
<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter className="border-t">
    <Button>Action</Button>
  </CardFooter>
</Card>
```

## TypeScript Types

```tsx
import type { CardProps } from '@constructive-io/ui/card';

// CardProps extends React.ComponentProps<'div'> with:
interface CardProps {
  variant?: 'default' | 'elevated' | 'flat' | 'ghost' | 'interactive';
  className?: string;
  children?: React.ReactNode;
  // ...all standard div props
}
```

## Best Practices

1. **Choose the right variant** - Use `default` for most cases, `elevated` for featured content, `interactive` for clickable cards, `flat` for dense layouts
2. **Consistent spacing** - Cards have built-in padding (px-6, py-6). Use the sub-components to maintain consistency
3. **Use CardAction for header buttons** - It automatically positions in the top-right corner
4. **Responsive grids** - Use Tailwind's responsive grid classes (md:grid-cols-3) for card layouts
5. **Semantic structure** - Always use CardHeader with CardTitle for accessibility
6. **Interactive cards** - Wrap the entire card in a link or button for clickable cards

## References

- [@constructive-io/ui Card component](https://www.npmjs.com/package/@constructive-io/ui)
- [Tailwind CSS Grid](https://tailwindcss.com/docs/grid-template-columns)
- [Lucide Icons](https://lucide.dev/) for card icons
