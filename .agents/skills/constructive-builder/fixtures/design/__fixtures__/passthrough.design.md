---
version: 1
name: passthrough-fixture
description: Custom tokens (tokens:/extra:) PASS THROUGH verbatim post-pivot; a structural --font-* is refused.
colors:
  primary: "oklch(0.55 0.13 250)"
  surface: "oklch(0.99 0 0)"
  on-surface: "oklch(0.27 0.01 250)"
  error: "oklch(0.55 0.2 25)"
tokens:
  --elevation-1: "0 1px 2px oklch(0 0 0 / 0.06)"
  --brand-gradient: "linear-gradient(90deg, var(--primary), var(--accent))"
  --font-display: "var(--font-display)"
extra:
  --ring-offset: "2px"
radius: "0.5rem"
default_mode: light
dark:
  tokens:
    --elevation-1: "0 1px 3px oklch(0 0 0 / 0.4)"
---

# pass-through fixture

POST-PIVOT, the faithful compiler lets a `design.md` declare its own custom CSS custom-properties via a
`tokens:` (or `extra:`) map; they are emitted **verbatim** into the override block alongside the
synthesized shadcn contract names (Rail 2 still holds — every shadcn name is present). Shared tokens apply
to both modes; a `dark.tokens:` overrides in dark only.

The ONE refusal that survives is a **structural-wiring** name (`--color-*` / `--font-*` / `--z-layer*` /
`--tw-*`): `--font-display` here is dropped with a warning (a font/serif face is swapped via the
`layout.tsx` loader, never via a token), while `--elevation-1` / `--brand-gradient` / `--ring-offset` pass
through. The authored `--primary` is emitted verbatim (no contrast clamp).
