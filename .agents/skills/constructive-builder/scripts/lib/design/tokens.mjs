/**
 * tokens.mjs — the shadcn-token CONTRACT (RAIL 2), as a tiny zero-dep module.
 *
 * `OVERRIDE_SURFACE` is the set of token NAMES a generated app's globals.css MUST
 * carry so Blocks render: every name here is asserted present in BOTH the `:root`
 * (light) and `.dark` blocks by the Blocks-contract validator (check-design.mjs).
 * `radius` is a scalar (drives the `--radius-*` derivations) and is required in
 * `:root` only.
 *
 * This is the single source of the contract: it replaces the constant that used to
 * live in the (now-removed) design compiler. GENERIC BY CONSTRUCTION — these are
 * color ROLE names + one scalar, never an app/entity/flow/domain literal.
 *
 * Zero dependencies. Pure Node (>=18).
 */

/* The 40 canonical shadcn token names (39 color roles + the `radius` scalar). */
export const OVERRIDE_SURFACE = new Set([
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'radius',
]);

/* Back-compat alias: consumers that referred to the contract as CONTRACT_NAMES. */
export const CONTRACT_NAMES = OVERRIDE_SURFACE;
