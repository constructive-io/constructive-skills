Design token system and Tailwind CSS v4 configuration for @constructive-io/ui.

## Why OKLCH

The token system uses `oklch(L C H)` color format:
- **Perceptually uniform** -- equal numeric steps produce equal visual steps
- **Consistent lightness** -- colors at the same L value look equally bright across hues
- **CSS-native** -- supported in all modern browsers, no build-time conversion needed
- **Wide gamut** -- access colors outside sRGB on supported displays

```css
/* OKLCH format: oklch(Lightness Chroma Hue) */
--primary: oklch(0.688 0.1754 245.6151);
/*               ^L      ^C       ^H         */
/* L: 0-1 (dark to light)                     */
/* C: 0-0.4 (gray to vivid)                   */
/* H: 0-360 (hue angle)                       */
```

## Complete globals.css Setup

This is the full recommended configuration. Copy this into `src/app/globals.css`:

```css
@import 'tailwindcss';
@source '../../packages/ui/src/components';
@source '../../packages/ui/src/styles';

@custom-variant dark (&:is(.dark *));

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.3211 0 0);
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
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.3211 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.3211 0 0);
  --radius: 0.5rem;
  --font-sans: 'Open Sans', ui-sans-serif, system-ui, sans-serif;
  --font-serif: Georgia, Cambria, serif;
  --font-mono: Menlo, Monaco, monospace;
  --info: oklch(0.65 0.15 240);
  --info-foreground: oklch(0.985 0 0);
  --success: oklch(0.65 0.17 150);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.75 0.15 75);
  --warning-foreground: oklch(0.3 0 0);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.37 0.013 285.805);
  --sidebar-primary: oklch(0.985 0 0);
  --sidebar-primary-foreground: oklch(0.21 0.006 285.885);
  --sidebar-accent: oklch(0.967 0.001 286.375);
  --sidebar-accent-foreground: oklch(0.21 0.006 285.885);
  --sidebar-border: oklch(0.92 0.004 286.32);
  --sidebar-ring: oklch(0.871 0.006 286.286);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
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
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.244 0.006 285.97);
  --sidebar-foreground: oklch(0.967 0.001 286.375);
  --sidebar-primary: oklch(0.596 0.145 163.225);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.274 0.006 286.033);
  --sidebar-accent-foreground: oklch(0.967 0.001 286.375);
  --sidebar-border: oklch(0.274 0.006 286.033);
  --sidebar-ring: oklch(0.442 0.017 285.786);
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
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-xs: calc(var(--radius) - 6px);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-xl: calc(var(--radius) + 6px);
  --radius-2xl: calc(var(--radius) + 10px);
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

## Semantic Token Reference

### Core Surface Tokens

| Token | Purpose | Usage |
|---|---|---|
| `background` / `foreground` | Page background and default text | `bg-background text-foreground` |
| `card` / `card-foreground` | Card surfaces | `bg-card text-card-foreground` |
| `popover` / `popover-foreground` | Floating panels, dropdowns | `bg-popover text-popover-foreground` |

### Interactive Tokens

| Token | Purpose | Usage |
|---|---|---|
| `primary` / `primary-foreground` | Primary actions, active states | `bg-primary text-primary-foreground` |
| `secondary` / `secondary-foreground` | Secondary actions, less emphasis | `bg-secondary text-secondary-foreground` |
| `accent` / `accent-foreground` | Hover backgrounds, subtle highlights | `bg-accent text-accent-foreground` |
| `muted` / `muted-foreground` | Disabled states, subtle text | `bg-muted text-muted-foreground` |
| `destructive` / `destructive-foreground` | Delete actions, errors | `bg-destructive text-destructive-foreground` |

### Status Tokens

| Token | Purpose | Usage |
|---|---|---|
| `info` / `info-foreground` | Informational messages | `bg-info text-info-foreground` |
| `success` / `success-foreground` | Success states, confirmations | `bg-success text-success-foreground` |
| `warning` / `warning-foreground` | Warning messages, caution | `bg-warning text-warning-foreground` |

### Input and Border Tokens

| Token | Purpose | Usage |
|---|---|---|
| `border` | Default border color (applied globally via base layer) | `border-border` |
| `input` | Input field borders | `border-input` |
| `ring` | Focus ring color | `ring-ring` |

### Sidebar Tokens

Dedicated tokens for sidebar navigation: `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-primary-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring`.

### Chart Tokens

Five chart colors (`chart-1` through `chart-5`) optimized for data visualization contrast in both light and dark modes.

## Radius Scale

Base radius is `--radius: 0.5rem` (8px). The scale is computed from it:

| Tailwind class | CSS variable | Computed value |
|---|---|---|
| `rounded-xs` | `--radius-xs` | `calc(0.5rem - 6px)` = 2px |
| `rounded-sm` | `--radius-sm` | `calc(0.5rem - 4px)` = 4px |
| `rounded-md` | `--radius-md` | `0.5rem` = 8px |
| `rounded-lg` | `--radius-lg` | `calc(0.5rem + 2px)` = 10px |
| `rounded-xl` | `--radius-xl` | `calc(0.5rem + 6px)` = 14px |
| `rounded-2xl` | `--radius-2xl` | `calc(0.5rem + 10px)` = 18px |

Change `--radius` to scale the entire system proportionally.

## Shadow Utilities

Custom shadow utilities defined in `@layer utilities`:

```css
@layer utilities {
  .shadow-card {
    box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06);
  }
  .shadow-card-lg {
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
  }
}
```

Usage:

```tsx
<div className="shadow-card rounded-lg bg-card p-4">Standard card</div>
<div className="shadow-card-lg rounded-lg bg-card p-6">Elevated card</div>
```

## Z-Index Layer System

Predefined z-index layers prevent stacking context conflicts:

```css
:root {
  --z-layer-portal-root: 9999;
  --z-layer-floating: 1000;
  --z-layer-modal-backdrop: 2000;
  --z-layer-modal-content: 2001;
  --z-layer-floating-elevated: 3000;
  --z-layer-toast: 4000;
}
```

Usage in Tailwind:

```tsx
// Floating elements (popovers, tooltips, dropdowns)
<div className="z-[var(--z-layer-floating)]">...</div>

// Modal backdrop
<div className="z-[var(--z-layer-modal-backdrop)]">...</div>

// Modal content (above backdrop)
<div className="z-[var(--z-layer-modal-content)]">...</div>

// Elevated floating (select inside modal)
<div className="z-[var(--z-layer-floating-elevated)]">...</div>

// Toast notifications (always on top)
<div className="z-[var(--z-layer-toast)]">...</div>
```

Never use arbitrary z-index values. Always reference these layer variables.

## Dark Mode Setup

Dark mode is class-based using `.dark` on the `<html>` element.

### Tailwind v4 directive

```css
@custom-variant dark (&:is(.dark *));
```

This enables the `dark:` prefix in Tailwind v4 classes:

```tsx
<div className="bg-white dark:bg-gray-900">...</div>
```

### Toggle implementation

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@constructive-io/ui/button';
import { Sun, Moon } from 'lucide-react';

function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = stored === 'dark' || (!stored && prefersDark);
    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle}>
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export { ThemeToggle };
```

### Prevent flash of unstyled content

Add this script in `<head>` of your root layout:

```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      try {
        const theme = localStorage.getItem('theme');
        if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    `,
  }}
/>
```

## Tailwind v4 Migration Notes

| v3 Syntax | v4 Syntax |
|---|---|
| `shadow-sm` | `shadow-xs` |
| `shadow` | `shadow-sm` |
| `rounded-sm` | `rounded-xs` |
| `rounded` | `rounded-sm` |
| `blur-sm` | `blur-xs` |
| `blur` | `blur-sm` |
| `outline-none` | `outline-hidden` |
| `bg-opacity-*` | `bg-black/50` (opacity modifier) |
| `bg-[--brand]` | `bg-(--brand)` (parentheses, not brackets) |

Other v4 changes:
- Default border color is `currentColor` (was `gray-200` in v3). The base layer resets it to `border-border/60`.
- Configuration is CSS-first (`@theme inline`) instead of `tailwind.config.js`.
- New features: container queries (`@container`, `@sm:`, `@md:`), 3D transforms, `@utility`/`@variant` directives.

## Extending with Custom Tokens

Add new tokens in `:root` and map them in `@theme inline`:

```css
:root {
  --brand: oklch(0.7 0.2 150);
  --brand-foreground: oklch(0.985 0 0);
}

.dark {
  --brand: oklch(0.6 0.18 150);
  --brand-foreground: oklch(0.985 0 0);
}

@theme inline {
  /* ...existing mappings... */
  --color-brand: var(--brand);
  --color-brand-foreground: var(--brand-foreground);
}
```

Now use in components:

```tsx
<div className="bg-brand text-brand-foreground">Custom branded element</div>
```

## CSS Animations

Keyframes defined in the theme for use with components:

| Animation | Purpose | Usage |
|---|---|---|
| `pulse-glow` | Subtle pulsing glow effect | Loading indicators |
| `fade-scale-in` | Fade in with scale up | Modal/dialog entrance |
| `shimmer` | Left-to-right shine sweep | Skeleton loading |
| `shimmer-slide` | Sliding shimmer variant | Progress indicators |
| `bounce-soft` | Gentle bounce | Notification badges |
| `slide-up` | Slide up from below | Toast entrance |
| `fade-in` | Simple opacity fade | General transitions |
| `scale-in` | Scale from 95% to 100% | Dropdown entrance |

Usage with Tailwind:

```tsx
<div className="animate-[fade-in_0.2s_ease-out]">Fade in content</div>
<div className="animate-[slide-up_0.3s_ease-out]">Slide up content</div>
<div className="animate-[shimmer_2s_infinite]">Loading skeleton</div>
```

## Best Practices

- Always use semantic tokens (`bg-primary`) instead of raw colors (`bg-blue-500`)
- Define both light and dark values for every custom token
- Use the z-index layer system -- never hardcode z-index values
- Keep `--radius` as the single source of truth for border radius
- Use opacity modifiers (`bg-primary/10`) for transparent variants
- Test both light and dark modes when adding new components
- Use `@theme inline` for project-specific token overrides
- Reference `token-values.md` in the references directory for the full token table
