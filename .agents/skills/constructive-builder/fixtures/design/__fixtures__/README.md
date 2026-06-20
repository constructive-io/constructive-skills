# Compiler test fixtures — `fixtures/design/__fixtures__/`

Deterministic doubles for **P2 / Agent-A** unit tests of the design engine
(`scripts/lib/design/{oklch,design-md,invariants,compile}.mjs`). Each fixture is a
pair:

```
<name>.design.md      # the input design.md (parsed by parseDesignMd → compileDesign)
<name>.expected.json  # assertions a test runner checks against the compile/lint output
```

A shared, version-controlled contract the engine (`compile`/`invariants`) and the static
self-test assert against. **These intentionally do NOT pin every derived token value** —
the exact OKLCH math for derived vars (`--border`, `--muted-foreground`, `--chart-*`,
`.dark` inversion, elevation ΔL) is the engine's to tune, and over-pinning it would make
the tests brittle. Instead each `expected.json` pins only what the SHARED CONTRACT makes
**deterministic**: direct role→var copies (emitted **verbatim** under the faithful
compiler), the radius, the Rail-2 synthesis guarantee + custom-token pass-through, the
structural off-limits set, the marked-region sentinels, and (for lint fixtures) the exact
invariant findings.

> **POST-PIVOT contract.** The compiler is now **faithful + advisory**: an authored value
> emits **verbatim** (no contrast clamp), custom `tokens:`/`extra:` props **pass through**,
> and the taste rules (contrast / AI-purple / pure-black / accent-count) are **advisory
> warnings**, never errors. The only hard `lint` error left is structural **`missing-primary`**.
> So lint fixtures that exercise a TASTE rule assert `lint.ok:true` + a `warn`/`info` finding
> (not `ok:false`); only `lint-missing-primary` asserts `ok:false`. `overrideSurfaceOnly` now
> means "all shadcn contract names present" (tolerating extra custom vars), and `passThrough`
> asserts custom tokens emit verbatim.

## `expected.json` schema

All keys optional; a test asserts each present key. Unknown extra keys a test doesn't
understand should be ignored (forward-compatible). Color comparisons SHOULD be tolerant
of formatting (whitespace, trailing-zero) — compare by parsed OKLCH within a small
epsilon, not by string equality, since `formatOklch` rounding is Agent A's choice.

```jsonc
{
  "describe": "human label for the test case",

  // compileDesign(design, {defaultMode}) input options:
  "compileOptions": { "defaultMode": "light" },

  // ── deterministic role→var copies the compiler MUST reproduce verbatim
  //    (direct mappings from the role map; not derived). Checked in BOTH the
  //    returned `light`/`dark` objects AND the rendered override block. ──
  "light": {
    "--background": "oklch(1 0 0)",        // <- colors.surface
    "--foreground": "oklch(0.30 0 0)",     // <- colors.on-surface
    "--primary":    "oklch(0.55 0.16 250)",// <- colors.primary
    "--ring":       "oklch(0.55 0.16 250)" // <- primary
  },
  "dark": { /* same idea for explicit-dark fixtures */ },

  // exact radius string (deterministic): design.radius || rounded.md || '0.5rem'
  "radius": "0.5rem",

  // fonts.{sans,mono} resolution (Agent A fonts.mjs allowlist)
  "fonts": { "sans": "Geist", "mono": "Geist Mono" },

  // ── RAIL-2 synthesis guarantee (POST-PIVOT semantics) ──
  // Asserts every shadcn CONTRACT NAME is present in BOTH modes (so Blocks
  // render). It NO LONGER forbids extra custom vars — under the faithful
  // compiler a design.md's `tokens:`/`extra:` custom props pass THROUGH, so
  // the emit set is a SUPERSET of the shadcn names, not an exact allowlist.
  "overrideSurfaceOnly": true,

  // ── custom-token pass-through (POST-PIVOT) ──
  // { light?:{ '--x':'v' }, dark?:{...} } — custom tokens the design.md
  // declared via `tokens:`/`extra:` that MUST be emitted VERBATIM. Shared
  // tokens apply to both modes; a `dark.tokens:`/`dark.extra:` overrides in
  // dark only. A structural-wiring name (--color-* / --font-* / --z-layer* /
  // --tw-*) is dropped with a warning (assert its absence via mustNotContain).
  "passThrough": {
    "light": { "--elevation-1": "0 1px 2px oklch(0 0 0 / 0.06)" },
    "dark":  { "--elevation-1": "0 1px 3px oklch(0 0 0 / 0.4)" }
  },

  // ── structural-safety guard ──
  // The rendered override block MUST NOT contain ANY of these substrings.
  "mustNotContain": [
    "@theme inline", "@source", "@custom-variant", "@plugin",
    "--z-layer-", "--shadow-", "--font-sans", "--font-serif", "--font-mono",
    "@layer base", "@layer utilities", "--radius-xs", "--radius-sm"
  ],

  // ── marked-region sentinels (byte-exact, shared across agents) ──
  "mustContain": [
    "/* >>> constructive-builder design overrides (generated) */",
    "/* <<< constructive-builder design overrides */",
    ":root", ".dark"
  ],

  // ── contrast contract (Agent A ensureContrast). A test parses these pairs
  //    out of the compiled `light`/`dark` token sets and asserts the WCAG
  //    ratio meets `min`. Use 3 for the hard floor, 4.5 for AA body. ──
  "contrast": [
    { "mode": "light", "fg": "--foreground",            "bg": "--background", "min": 4.5 },
    { "mode": "light", "fg": "--primary-foreground",     "bg": "--primary",    "min": 4.5 },
    { "mode": "light", "fg": "--muted-foreground",       "bg": "--background", "min": 4.5 },
    { "mode": "light", "fg": "--destructive-foreground", "bg": "--destructive","min": 4.5 },
    { "mode": "dark",  "fg": "--foreground",             "bg": "--background", "min": 4.5 }
  ],

  // ── lint fixtures only: assert invariants.lintDesign(design) findings ──
  "lint": {
    "ok": false,                                  // overall verdict
    "expectFindings": [                            // each: at least one finding matches
      { "rule": "missing-primary", "severity": "error" }
    ],
    "forbidFindings": [                            // none of these may appear
      { "rule": "ai-purple-band" }
    ]
  }
}
```

## Fixture index

| Fixture | What it proves |
|---|---|
| `direct-map.*` | Direct role→var copies (surface/on-surface/primary/ring) + radius + override-surface allowlist + structural-safety + sentinels. The "happy path" compile shape. |
| `explicit-dark.*` | An explicit `dark:` block is honored verbatim (compiler must NOT re-derive `.dark` when `design.dark` is present). |
| `radius-fallback.*` | `radius` absent → falls back to `rounded.md`; `--ring` mirrors primary; default_mode dark sets which set leads. |
| `tint-foreground.*` | success/warning `*-foreground` honor the tint contract: dark-on-tint in LIGHT, light-on-tint in DARK (contrast pairs both ways). |
| `lint-missing-primary.*` | `lintDesign` returns `ok:false` with a `missing-primary` **error**. |
| `lint-ai-purple.*` | A saturated blue-purple primary (no `allow_brand_hue`) → `ai-purple-band` **warn**; flipping `allow_brand_hue:true` would suppress it (documented, second file). |
| `lint-pure-black.*` | `on-surface: oklch(0 0 0)` → `pure-black` / min-L **warn**. |
| `lint-clean.*` | A fully invariant-satisfying design → `lintDesign` `ok:true`, **zero** error findings. |
| `passthrough.*` | POST-PIVOT: custom `tokens:`/`extra:` props pass through **verbatim** (both modes; `dark.tokens:` overrides in dark); a structural `--font-*` is **dropped**; the authored `--primary` emits verbatim (no contrast clamp); all Rail-2 names still present. |

> Sentinels (must stay byte-identical with `compile.renderOverrideBlock` and
> `wire-design.mjs`):
> `/* >>> constructive-builder design overrides (generated) */`
> `/* <<< constructive-builder design overrides */`
