# Backend module presets

Constructive DB owns preset definitions and their module closure. Skills may name the supported profiles and explain when they apply, but must not duplicate the module arrays or reconstruct them from frontend features.

## Source of truth

The canonical source is `constructive-db/packages/node-type-registry/src/module-presets/`, exported through that package's preset registry. Resolve the preset at provisioning time from the installed Constructive DB version.

The supported profiles are:

| Preset | Backend intent |
|---|---|
| `auth:hardened` | Hardened authentication and application access |
| `b2b:storage` | Hardened auth, organizations, membership governance, and storage infrastructure |
| `full` | Complete reference capability set, including billing and notifications modules |

Do not accept removed preset aliases such as `minimal`, `auth:email`, `auth:sso`, `auth:passkey`, or `b2b` in a new brief. If a custom backend composition is required, declare it explicitly through the backend's supported module mechanism rather than inventing another preset name.

## Frontend mapping

A backend preset and a Blocks preset are distinct artifacts:

- Constructive DB installs database modules, schemas, roles, grants, and RLS.
- Blocks installs Console Kit core and the frontend feature modules supported by a profile.
- Console runtime discovery decides which installed modules are actually ready for the tenant's public endpoints and active identity. Standalone feature packs follow their separate host contracts.

Use [`constructive-blocks`](../../constructive-blocks/SKILL.md) for exact frontend preset roots and install plans. Do not copy the frontend dependency closure into backend provisioning input.

## Provisioning output

Preserve the stable database ID and explicit semantic public endpoints returned by provisioning. Console Kit never derives sibling hosts or sends private routing headers, and a preset name alone is not enough to construct a tenant descriptor.

Some backend modules may be installed without a public application route. In that case the corresponding frontend pack can correctly be partial or unavailable until the host supplies a compatible public endpoint; the frontend must not patch the backend or bypass RLS.
