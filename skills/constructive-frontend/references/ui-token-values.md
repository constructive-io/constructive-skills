# Token Values Reference

Complete light and dark OKLCH token values for @constructive-io/ui.

## Core Surface Tokens

| Token | Light | Dark |
|---|---|---|
| `--background` | `oklch(1 0 0)` | `oklch(0.21 0.006 285.885)` |
| `--foreground` | `oklch(0.3211 0 0)` | `oklch(0.985 0 0)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.21 0.006 285.885)` |
| `--card-foreground` | `oklch(0.3211 0 0)` | `oklch(0.985 0 0)` |
| `--popover` | `oklch(1 0 0)` | `oklch(0.21 0.006 285.885)` |
| `--popover-foreground` | `oklch(0.3211 0 0)` | `oklch(0.985 0 0)` |

## Interactive Tokens

| Token | Light | Dark |
|---|---|---|
| `--primary` | `oklch(0.688 0.1754 245.6151)` | `oklch(0.688 0.1754 245.6151)` |
| `--primary-foreground` | `oklch(0.979 0.021 166.113)` | `oklch(0.979 0.021 166.113)` |
| `--secondary` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` |
| `--secondary-foreground` | `oklch(0.21 0.006 285.885)` | `oklch(0.985 0 0)` |
| `--muted` | `oklch(0.967 0.001 286.375)` | `oklch(0.244 0.006 285.97)` |
| `--muted-foreground` | `oklch(0.552 0.016 285.938)` | `oklch(0.705 0.015 286.067)` |
| `--accent` | `oklch(0.967 0.001 286.375)` | `oklch(0.244 0.006 285.97)` |
| `--accent-foreground` | `oklch(0.21 0.006 285.885)` | `oklch(0.985 0 0)` |
| `--destructive` | `oklch(0.55 0.2 25)` | `oklch(0.55 0.2 25)` |
| `--destructive-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` |

## Input and Border Tokens

| Token | Light | Dark |
|---|---|---|
| `--border` | `oklch(0.92 0.004 286.32)` | `oklch(0.29 0.009 285.83)` |
| `--input` | `oklch(0.871 0.006 286.286)` | `oklch(0.29 0.009 285.83)` |
| `--ring` | `oklch(0.871 0.006 286.286)` | `oklch(0.442 0.017 285.786)` |

## Status Tokens

| Token | Light | Dark |
|---|---|---|
| `--info` | `oklch(0.65 0.15 240)` | *(same)* |
| `--info-foreground` | `oklch(0.985 0 0)` | *(same)* |
| `--success` | `oklch(0.65 0.17 150)` | *(same)* |
| `--success-foreground` | `oklch(0.985 0 0)` | *(same)* |
| `--warning` | `oklch(0.75 0.15 75)` | *(same)* |
| `--warning-foreground` | `oklch(0.3 0 0)` | *(same)* |

Note: Status tokens (info, success, warning) are not overridden in `.dark` by default. Add dark overrides if you need different values.

## Sidebar Tokens

| Token | Light | Dark |
|---|---|---|
| `--sidebar` | `oklch(0.985 0 0)` | `oklch(0.244 0.006 285.97)` |
| `--sidebar-foreground` | `oklch(0.37 0.013 285.805)` | `oklch(0.967 0.001 286.375)` |
| `--sidebar-primary` | `oklch(0.985 0 0)` | `oklch(0.596 0.145 163.225)` |
| `--sidebar-primary-foreground` | `oklch(0.21 0.006 285.885)` | `oklch(1 0 0)` |
| `--sidebar-accent` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` |
| `--sidebar-accent-foreground` | `oklch(0.21 0.006 285.885)` | `oklch(0.967 0.001 286.375)` |
| `--sidebar-border` | `oklch(0.92 0.004 286.32)` | `oklch(0.274 0.006 286.033)` |
| `--sidebar-ring` | `oklch(0.871 0.006 286.286)` | `oklch(0.442 0.017 285.786)` |

## Chart Tokens

| Token | Light | Dark |
|---|---|---|
| `--chart-1` | `oklch(0.646 0.222 41.116)` | `oklch(0.488 0.243 264.376)` |
| `--chart-2` | `oklch(0.6 0.118 184.704)` | `oklch(0.696 0.17 162.48)` |
| `--chart-3` | `oklch(0.398 0.07 227.392)` | `oklch(0.769 0.188 70.08)` |
| `--chart-4` | `oklch(0.828 0.189 84.429)` | `oklch(0.627 0.265 303.9)` |
| `--chart-5` | `oklch(0.769 0.188 70.08)` | `oklch(0.645 0.246 16.439)` |

## Non-Color Tokens

| Token | Value |
|---|---|
| `--radius` | `0.5rem` |
| `--font-sans` | `'Open Sans', ui-sans-serif, system-ui, sans-serif` |
| `--font-serif` | `Georgia, Cambria, serif` |
| `--font-mono` | `Menlo, Monaco, monospace` |

## Z-Index Layers

| Variable | Value | Purpose |
|---|---|---|
| `--z-layer-floating` | `1000` | Popovers, tooltips, dropdowns |
| `--z-layer-modal-backdrop` | `2000` | Modal overlay backdrop |
| `--z-layer-modal-content` | `2001` | Modal content (above backdrop) |
| `--z-layer-floating-elevated` | `3000` | Floating inside modals |
| `--z-layer-toast` | `4000` | Toast notifications |
| `--z-layer-portal-root` | `9999` | Portal root container |

## Radius Scale

| Class | Variable | Computed (base = 0.5rem) |
|---|---|---|
| `rounded-xs` | `--radius-xs` | 2px |
| `rounded-sm` | `--radius-sm` | 4px |
| `rounded-md` | `--radius-md` | 8px |
| `rounded-lg` | `--radius-lg` | 10px |
| `rounded-xl` | `--radius-xl` | 14px |
| `rounded-2xl` | `--radius-2xl` | 18px |
