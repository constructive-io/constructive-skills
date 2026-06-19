# Compiler test fixtures — `fixtures/design/__fixtures__/`

Deterministic doubles for **P2 / Agent-A** unit tests of the design engine
(`scripts/lib/design/{oklch,design-md,invariants,compile}.mjs`). Each fixture is a
pair:

```
<name>.design.md      # the input design.md (parsed by parseDesignMd → compileDesign)
<name>.expected.json  # assertions a test runner checks against the compile/lint output
```

Authored by build-agent **D** so the engine (agent A) and the static self-test (P2)
have a shared, version-controlled contract to assert against. **These intentionally do
NOT pin every derived token value** — the exact OKLCH math for derived vars
(`--border`, `--muted-foreground`, `--chart-*`, `.dark` inversion, elevation ΔL) is
Agent A's to tune, and over-pinning it would make the tests brittle and couple D's
guesses to A's implementation. Instead each `expected.json` pins only what the SHARED
CONTRACT makes **deterministic**: direct role→var copies, the radius, the
override-surface allowlist, the structural off-limits set, the marked-region sentinels,
and (for lint fixtures) the exact invariant findings.

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

  // ── override-surface guard ──
  // Every var the override block emits MUST be in this allowlist (the ONLY
  // vars compile may emit). A test asserts: emittedVars ⊆ overrideSurface.
  "overrideSurfaceOnly": true,

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

> Sentinels (must stay byte-identical with `compile.renderOverrideBlock` and
> `wire-design.mjs`):
> `/* >>> constructive-builder design overrides (generated) */`
> `/* <<< constructive-builder design overrides */`
