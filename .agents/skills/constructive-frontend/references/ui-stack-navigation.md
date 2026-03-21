# Stack Navigation Reference

iOS-style card navigation manager from `@constructive-io/ui/stack` — the primary navigation pattern in the Constructive admin app. Cards push/pop from the right side with peek interactions, gestures, and responsive layout.

> **Import**: `@constructive-io/ui/stack`
> **Admin app**: `CardStackProvider` wraps the entire app in `layout.tsx` with `side-by-side` mode

## Why Stack (Not Sheet)

Stack replaces Sheet for navigation patterns because:
- **Imperative API** — `push()`, `pop()`, `replace()` like React Navigation (no JSX nesting)
- **Route registry** — string-based navigation without passing components
- **Cross-card updates** — `updateProps(id, patch)` for reactive state between cards
- **GPU-accelerated animations** — transform-only, no layout thrash
- **Peek interactions** — hover, click, and drag gestures on visible card edges

Sheet is still used for simple side panels. Stack is for multi-level navigation workflows.

## Setup

### Root Layout (Next.js App Router)

```tsx
import { CardStackProvider } from '@constructive-io/ui/stack';

// In layout.tsx — wraps entire app
<CardStackProvider layoutMode="side-by-side" defaultPeekOffset={48}>
  {children}
  <ClientOnlyStackViewport />
</CardStackProvider>
```

### Client-Only Viewport (Hydration Safety)

The viewport uses `createPortal` which requires a client-only wrapper:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { CardStackViewport } from '@constructive-io/ui/stack';

export function ClientOnlyStackViewport() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <CardStackViewport peekDepth={3} />;
}
```

## Core Concepts

### CardSpec — What Gets Pushed

Every card on the stack is described by a `CardSpec`:

```typescript
type CardSpec<P = unknown> = {
  id: CardId;                        // Unique identifier
  title?: string;                    // Header title
  description?: string;              // Header subtitle
  headerSize?: 'sm' | 'md' | 'lg';  // Header size variant
  Component: CardComponent<P>;       // React component to render
  props?: P;                         // Props passed to Component
  width?: string | number;           // CSS width (default: 480px)
  peekOffset?: number;               // Custom peek for this card (default: 24px)
  allowCover?: boolean;              // Allow full cover by cards above (default: false)
  backdrop?: boolean | BackdropConfig; // Backdrop config for first card
  onClose?: () => void;              // Fires when card is removed (any method)
  meta?: Record<string, unknown>;    // Metadata for analytics/debugging
};
```

### CardComponent — The Component Contract

Cards receive their custom props plus injected `card` context:

```typescript
type CardComponent<P = unknown> = React.ComponentType<P & CardInjectedProps>;

type CardInjectedProps = {
  card: {
    id: CardId;
    push: <P>(card: Omit<CardSpec<P>, 'id'> & { id?: CardId }, options?: CardPushOptions) => CardId;
    close: () => void;
    setTitle: (title?: string) => void;
    setDescription: (description?: string) => void;
    setWidth: (width?: string | number) => void;
    updateProps: <P>(patch: Partial<P> | ((prev: P) => P)) => void;
  };
};
```

### Usage Example

```tsx
import type { CardComponent } from '@constructive-io/ui/stack';

type ProfileProps = { userId: string };

const ProfileCard: CardComponent<ProfileProps> = ({ userId, card }) => {
  // Push a child card (replaces cards above this one by default)
  const openEdit = () => {
    card.push({
      title: 'Edit Profile',
      Component: EditProfileCard,
      props: { userId },
      width: 520,
    });
  };

  // Push without replacing (append on top)
  const openModal = () => {
    card.push(
      { title: 'Confirm', Component: ConfirmCard },
      { append: true }
    );
  };

  return (
    <div className="p-6 space-y-4">
      <h2>{userId}</h2>
      <Button onClick={openEdit}>Edit</Button>
      <Button onClick={() => card.close()}>Close</Button>
      <Button onClick={() => card.setTitle('Updated Title')}>Rename</Button>
    </div>
  );
};
```

## CardStackApi — The Imperative API

Access via `useCardStack()` hook:

```tsx
import { useCardStack } from '@constructive-io/ui/stack';

function SomeComponent() {
  const stack = useCardStack();

  // Push directly
  stack.push({
    id: 'my-card',
    title: 'My Card',
    Component: MyCard,
    props: { foo: 'bar' },
    width: 600,
  });

  // Push by route (recommended)
  stack.pushRoute('profile', { userId: '123' });

  // Navigation
  stack.pop();              // Pop top card
  stack.pop(3);             // Pop 3 cards
  stack.popTo('card-id');   // Pop until card-id is on top
  stack.replaceTop(card);   // Replace top card
  stack.reset([card1]);     // Reset entire stack
  stack.clear();            // Remove all cards

  // Read operations
  stack.top();              // Get top card spec (or null)
  stack.currentId();        // Get top card ID (or null)
  stack.canPop();           // Has cards to pop?
  stack.size();             // Total card count
  stack.get('id');          // Get card by ID
  stack.getAll();           // All cards (bottom to top)
  stack.has('id');          // Check if card exists

  // Card updates (cross-card communication)
  stack.updateProps('card-id', { count: 5 });
  stack.updateProps('card-id', (prev) => ({ ...prev, count: prev.count + 1 }));
  stack.setTitle('card-id', 'New Title');
  stack.setDescription('card-id', 'Updated');
  stack.setWidth('card-id', 700);

  // Advanced
  stack.dismiss('card-id');                     // Cascade: removes card + all above
  stack.dismiss('card-id', { cascade: false }); // Remove only this card
  stack.insertAt(0, card);                      // Insert at specific index
}
```

## Route Registry

Define routes once, navigate by string key:

```typescript
import { CardStackProvider } from '@constructive-io/ui/stack';
import type { CardRouteMap } from '@constructive-io/ui/stack';

const routes: CardRouteMap = {
  'file-browser': {
    Component: FileBrowser,
    defaultTitle: 'Files',
    defaultWidth: 480,
  },
  'profile': {
    Component: ProfileCard,
    getId: (props) => `profile:${props.userId}`,  // Unique ID per user
    defaultTitle: 'Profile',
    defaultWidth: 520,
  },
};

<CardStackProvider routes={routes}>
  {children}
  <CardStackViewport />
</CardStackProvider>

// Then push by route key:
stack.pushRoute('profile', { userId: '123' });
stack.pushRoute('profile', { userId: '123' }, { title: 'Custom Title', width: 600 });
```

## Layout Modes

### Cascade (Default)

Cards peek behind each other with fixed offset:

```
┌────────────────────────────────────────────────────┐
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │                                              │  │
│  │  ┌──────────────────────────────────────────┐│  │
│  │  │ Card 3 (Top)                        [>]  ││  │
│  │  │ Content                                  ││  │
│  │  └──────────────────────────────────────────┘│  │
│  │ Card 2 (peek: 24px)                    [>]   │  │
│  └──────────────────────────────────────────────┘  │
│ Card 1 (peek: 48px)                          [>]   │
└────────────────────────────────────────────────────┘
```

### Side-by-Side

Second-to-top card pushed fully left, creating master-detail:

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│  ┌──────────────────┐ ┌────────────────────────────┐   │
│  │ Card 1 (Left)    │ │ Card 2 (Top)          [>]  │   │
│  │ Full content     │ │ Full content               │   │
│  │            [>]   │ │                            │   │
│  └──────────────────┘ └────────────────────────────┘   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

```tsx
<CardStackProvider layoutMode="side-by-side">
```

## useCardReady — Deferred Data Loading

Defer heavy queries until after the slide-in animation completes:

```tsx
import { useCardReady } from '@constructive-io/ui/stack';

function DataCard() {
  const { isReady } = useCardReady();

  const { data, isLoading } = useQuery({
    queryKey: ['myData'],
    queryFn: fetchData,
    enabled: isReady,  // Don't fetch until animation done
  });

  return (
    <Select disabled={isLoading || !isReady}>
      {data?.map(item => <SelectItem key={item.id}>{item.name}</SelectItem>)}
    </Select>
  );
}
```

## Additional Hooks

```typescript
import {
  useCardStack,          // Main API hook
  useStackContext,       // Full context (state + api + config)
  useStackLayoutMode,    // Current layout mode ('cascade' | 'side-by-side')
  useStackCards,         // Current cards array (triggers re-render on change)
  useIsTopCard,          // Check if a card is on top
  useCardIndex,          // Get card's index in stack
  useCardInjectedProps,  // Build injected props for a card ID
  useCardReady,          // Deferred loading after animation
  useIsMobile,           // Mobile breakpoint detection
} from '@constructive-io/ui/stack';
```

## Peek Zone Interactions

Cards that are partially hidden have interactive peek zones on their visible left edge:

| Interaction | Behavior | Animation |
|-------------|----------|-----------|
| **Hover** | Card expands left 48px | Spring (500 stiffness, 25 damping) |
| **Click** | Pops all cards above | Standard exit animation |
| **Drag Right** | Cards above slide together; dismiss on threshold | Spring (600 stiffness, 35 damping) |

Peek zones are coordinated at the viewport level — only one card can be hovered at a time.

## Mobile Behavior

On mobile viewports (< 768px by default):
- Cards take 100% width and height
- Swipe-right gesture pops the top card
- No peek offset (only top card visible)
- Threshold: 35% viewport width or 600px/s velocity

## Viewport Configuration

```tsx
<CardStackViewport
  peekDepth={3}              // Render 3 previous cards for peek (default: 2)
  backdrop={true}            // Show backdrop behind stack
  animation={{ duration: 0.2 }}
  mobile={{ breakpoint: 768, fullScreen: true }}
  peekGestures={{
    enabled: true,
    dragToDismiss: true,
    hoverExpansion: 48,
    dragThreshold: 80,
  }}
  renderEmpty={() => <EmptyState />}
  renderHeader={(card, api) => <CustomHeader card={card} onClose={() => api.dismiss(card.id)} />}
/>
```

## Provider Configuration

```tsx
<CardStackProvider
  routes={routes}              // Route registry
  initial={[]}                 // Initial stack state
  onChange={(stack) => log(stack)} // Stack change callback
  zIndexBase={100}             // Z-index base (default: 100)
  layoutMode="side-by-side"    // 'cascade' | 'side-by-side'
  defaultPeekOffset={48}       // Default peek in px (default: 24)
  defaultWidth={480}           // Default card width (default: 480)
>
```

## Responsive Offset Compression

As viewport shrinks, Stack automatically compresses card offsets:
1. **Full space** — cards at ideal offsets
2. **Compression** — offsets reduce proportionally
3. **Collapse** — when minimum peek can't fit, switches to mobile full-screen mode

## Keyboard Navigation

- **Escape** — pops top card (single keypress, handled globally by provider)
- Works with the command palette's keyboard shortcuts without conflicts

## Best Practices

1. **Use `side-by-side` for admin apps** — master-detail pattern works well for CRUD workflows
2. **Use route registry** — define routes once, navigate by string key
3. **Defer heavy queries** with `useCardReady()` — prevents jank during slide animation
4. **Use `onClose` callbacks** for cleanup (refetch parent data, clear selections)
5. **Set per-card `width`** — different content needs different widths (forms: 420-520px, tables: 600-700px)
6. **Use `card.push()` from inside cards** — it auto-replaces cards above the current one
7. **Use `{ append: true }` sparingly** — only for modal-like cards that don't replace navigation context
8. **Use `ClientOnlyStackViewport`** in Next.js — prevents hydration mismatch from `createPortal`
