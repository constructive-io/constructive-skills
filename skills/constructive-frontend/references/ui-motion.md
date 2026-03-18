# constructive-ui-motion

Animation system for `@constructive-io/ui` interfaces built on `motion/react`.

## Package

Import from `motion/react` (NOT `framer-motion`):

```tsx
import { motion, AnimatePresence } from 'motion/react';
```

Install:

```bash
pnpm add motion
```

## Motion Config Presets

Import from `@constructive-io/ui/lib/motion/motion-config`. These are the canonical animation values — use them instead of defining inline transitions.

### Easings

`BezierDefinition` arrays for CSS-style easing curves:

```ts
export const easings = {
  easeOut: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  snappy: [0.2, 0, 0, 1],
  bounce: [0.34, 1.56, 0.64, 1],
  emphasized: [0.4, 0, 0.2, 1],
  physicalExit: [0.4, 0, 0.6, 1],
} as const;
```

### Durations

Values in seconds:

```ts
export const durations = {
  instant: 0.1,
  fast: 0.15,
  normal: 0.2,
  slow: 0.3,
  deliberate: 0.4,
} as const;
```

### Springs

Spring physics configs (stiffness, damping, mass):

```ts
export const springs = {
  snappy: { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 },
  bouncy: { type: 'spring', stiffness: 300, damping: 20, mass: 0.6 },
  gentle: { type: 'spring', stiffness: 150, damping: 25, mass: 1 },
  stiff: { type: 'spring', stiffness: 500, damping: 35, mass: 0.5 },
  panel: { type: 'spring', stiffness: 150, damping: 25 },
} as const;
```

### Transitions

Pre-built `Transition` objects combining easings, durations, and springs:

```ts
export const transitions = {
  fade: { duration: durations.normal, ease: easings.easeOut },
  enterExit: { duration: durations.normal, ease: easings.snappy },
  snappy: { type: 'spring', ...springs.snappy },
  panel: { type: 'spring', ...springs.panel },
  exit: { duration: durations.fast, ease: easings.physicalExit },
  layout: { type: 'spring', ...springs.snappy },
} as const;
```

### Variants

Pre-built `AnimatePresence` variant sets with `initial`, `animate`, and `exit` states:

```ts
export const variants = {
  fadeScale: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1, transition: transitions.enterExit },
    exit: { opacity: 0, scale: 0.96, transition: transitions.exit },
  },
  fadeSlideUp: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: transitions.enterExit },
    exit: { opacity: 0, y: 8, transition: transitions.exit },
  },
  fadeSlideDown: {
    initial: { opacity: 0, y: -8 },
    animate: { opacity: 1, y: 0, transition: transitions.enterExit },
    exit: { opacity: 0, y: -8, transition: transitions.exit },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: transitions.fade },
    exit: { opacity: 0, transition: transitions.exit },
  },
  floatUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0, transition: transitions.snappy },
    exit: { opacity: 0, y: 10, transition: transitions.exit },
  },
} as const;
```

## Using Presets in Components

```tsx
'use client';

import { motion, AnimatePresence } from 'motion/react';
import { variants, transitions, springs } from '@constructive-io/ui/lib/motion/motion-config';

function FadePanel({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          key="panel"
          variants={variants.fadeScale}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

## AnimatePresence Patterns

### Mode Options

- `mode="wait"` — Wait for exit animation to finish before entering next element. Best for route/tab transitions.
- `mode="sync"` — Enter and exit simultaneously. Good for crossfade effects.
- `mode="popLayout"` — Remove exiting elements from layout flow immediately. Prevents layout jumps.

### Tab/Route Transition

```tsx
'use client';

import { motion, AnimatePresence } from 'motion/react';
import { transitions } from '@constructive-io/ui/lib/motion/motion-config';

function TabContent({ activeTab, content }: { activeTab: string; content: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={transitions.enterExit}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  );
}
```

### Conditional Render with Exit

```tsx
'use client';

import { motion, AnimatePresence } from 'motion/react';
import { variants } from '@constructive-io/ui/lib/motion/motion-config';

function Notification({ show, message }: { show: boolean; message: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="notification"
          variants={variants.fadeSlideDown}
          initial="initial"
          animate="animate"
          exit="exit"
          className="rounded-sm border bg-card p-4 shadow-sm"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

## List Stagger Pattern

```tsx
'use client';

import { motion } from 'motion/react';
import { variants } from '@constructive-io/ui/lib/motion/motion-config';

const container = {
  animate: { transition: { staggerChildren: 0.05 } },
};

function StaggerList({ items }: { items: string[] }) {
  return (
    <motion.ul variants={container} initial="initial" animate="animate">
      {items.map((item) => (
        <motion.li key={item} variants={variants.fadeSlideUp}>
          {item}
        </motion.li>
      ))}
    </motion.ul>
  );
}
```

## Spring-Based Interactions

```tsx
'use client';

import { motion } from 'motion/react';
import { springs } from '@constructive-io/ui/lib/motion/motion-config';

function InteractiveCard({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={springs.snappy}
      className="cursor-pointer rounded-sm border bg-card p-4 shadow-sm"
    >
      {children}
    </motion.div>
  );
}
```

## Reduced Motion Support

Always respect `prefers-reduced-motion`:

```tsx
'use client';

import { motion, useReducedMotion } from 'motion/react';
import { transitions } from '@constructive-io/ui/lib/motion/motion-config';

function AnimatedComponent() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      animate={{ x: 100 }}
      transition={shouldReduceMotion ? { duration: 0 } : transitions.snappy}
    />
  );
}
```

## How Built-in Components Use Motion

Understanding how existing `@constructive-io/ui` components implement animation helps maintain consistency:

| Component | Technique | Details |
|-----------|-----------|---------|
| **Sheet** | `motion.div` + GPU transforms | `springs.panel`, x-axis slide with configurable side |
| **Dialog** | CSS transitions via Base UI | Uses `data-*` attributes, not `motion/react` |
| **Stack** | `motion.div` + gestures | `@use-gesture/react` for card navigation with spring physics |
| **Dock** | Spring animations | Magnification effect on hover with spring configs |

When extending or wrapping these components, match their animation approach rather than mixing techniques.

## Performance Rules

1. **Prefer `transform` and `opacity`** — GPU-accelerated, no layout recalculation
2. **Use `willChange: 'transform'`** for heavy or persistent animations
3. **Avoid animating `width`, `height`, `top`, `left`** — use `scale` and `translate` instead
4. **Use `layout` prop sparingly** — only when elements genuinely move in the DOM
5. **Keep stagger delays short** (0.03-0.08s) to avoid sluggish UIs
6. **Remove `AnimatePresence`** when exit animations are not needed — unnecessary wrapping adds overhead

## Common Patterns Quick Reference

| Pattern | Preset | Notes |
|---------|--------|-------|
| Modal/dialog enter | `variants.fadeScale` | Centered overlay |
| Toast/notification slide | `variants.fadeSlideDown` | Top-down entry |
| List item enter | `variants.fadeSlideUp` | Bottom-up with stagger |
| Panel/drawer slide | `transitions.panel` | Spring-based side panel |
| Button press | `springs.snappy` + `whileTap` | Scale 0.98 on press |
| Content swap | `transitions.enterExit` + `mode="wait"` | Tab/route changes |
| Subtle fade | `variants.fade` | Minimal presence change |
| Hero entrance | `variants.floatUp` | Larger y offset, spring |

## Best Practices

- Use presets from `motion-config` instead of defining inline transition values
- Always wrap conditional renders in `AnimatePresence` when exit animations are needed
- Use `mode="wait"` for route/tab transitions to prevent content overlap
- Test with `prefers-reduced-motion` enabled in browser dev tools
- `'use client'` is required for all components using `motion/react`
- Keep animation values consistent across the app by referencing the same preset names
- Avoid nesting multiple `AnimatePresence` components — flatten where possible
- Use `key` prop on `motion.*` elements inside `AnimatePresence` to trigger re-animation
