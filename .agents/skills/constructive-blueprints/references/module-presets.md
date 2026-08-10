# Backend module presets

Constructive DB owns preset definitions and their module closure. Skills may name the supported profiles and explain when they apply, but must not duplicate the module arrays or reconstruct them from frontend features.

## Source of truth

The canonical source is `constructive-db/packages/node-type-registry/src/module-presets/`, exported through that package's preset registry. Resolve the preset at provisioning time from the installed Constructive DB version.

The supported profiles are:

| Preset | Backend intent |
|---|---|
| `minimal` | Core only — users, sessions, RLS. The integration-test baseline, not a product profile |
| `auth:hardened` | Hardened authentication and application access |
| `b2b:storage` | Hardened auth, organizations, membership governance, and storage infrastructure |
| `full` | Complete reference capability set, including billing and notifications modules |

These four are the whole lineup. Do not accept any other preset name in a brief: if a custom backend composition is required, declare it explicitly through the backend's supported module mechanism rather than inventing a preset.

## Content presets are a different thing

A **module preset** is the set of modules a database installs. A **content preset** is a document of rows seeded *into* one of those modules — same catalog idea, different axis, and the two are named independently.

Content presets are requested as options on a module entry, by slug:

```json
[
  ["events_module", { "scope": "app", "trust_ladder": "humanity" }],
  ["limits_module", { "scope": "app", "limit_defaults": "metered" }]
]
```

| Option | Kind | Shipped slugs |
|---|---|---|
| `trust_ladder` on `events_module` | `trust_ladder` | `humanity`, `metered` |
| `limit_defaults` on `limits_module` | `limit_defaults` | `metered` |

Omitting the option seeds nothing; passing an array instead of a slug supplies the caller's own document inline. As with module presets, do not reconstruct a shipped document in a skill or a brief — name the slug, or capture a tuned one as a new named preset.

`auth:hardened`, `b2b:storage` and `full` each install `events_module` carrying the `humanity` ladder, so a database provisioned from any of them can earn `level.reachable` without asking for anything extra. `minimal` installs no events module and has no ladder, deliberately. No shipped preset requests `metered` — name it explicitly, with its limit baseline, where consumption is actually rationed. See [`constructive-events` → trust-ladders.md](../../constructive-events/references/trust-ladders.md).

## Frontend mapping

A backend preset and a Blocks preset are distinct artifacts:

- Constructive DB installs database modules, schemas, roles, grants, and RLS.
- Blocks installs Console Kit core and the frontend feature modules supported by a profile.
- Console runtime discovery decides which installed modules are actually ready for the tenant's public endpoints and active identity. Standalone feature packs follow their separate host contracts.

Use [`constructive-blocks`](../../constructive-blocks/SKILL.md) for exact frontend preset roots and install plans. Do not copy the frontend dependency closure into backend provisioning input.

## Provisioning output

Preserve the stable database ID and explicit semantic public endpoints returned by provisioning. Console Kit never derives sibling hosts or sends private routing headers, and a preset name alone is not enough to construct a tenant descriptor.

Some backend modules may be installed without a public application route. In that case the corresponding frontend pack can correctly be partial or unavailable until the host supplies a compatible public endpoint; the frontend must not patch the backend or bypass RLS.
