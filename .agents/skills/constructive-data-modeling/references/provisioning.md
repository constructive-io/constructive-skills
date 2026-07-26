# Database provisioning boundary

Constructive DB owns backend presets, module closure, provisioning, endpoint creation, roles, grants, and RLS. Application skills must not copy those preset arrays, default to an “all modules” list, or patch the backend when frontend discovery reports an unavailable capability.

## Inputs and outputs

Choose the backend preset through the current Constructive DB mechanism. Keep that choice separate from the Blocks install root: a backend preset provisions capabilities, while a Blocks preset installs the supported frontend composition.

Provisioning must return or be followed by a secret-free tenant descriptor containing:

- the stable database ID;
- an optional display name;
- explicit semantic public GraphQL endpoints such as data, auth, admin, billing, storage, or notifications when those routes exist.

Pass that descriptor to Console Kit. Do not derive `auth-*`, `app-public-*`, or any other sibling hostname from the database name. Do not pass private routing headers through application UI.

## After provisioning

1. Confirm the returned database identity and endpoint map belong to the same tenant.
2. Model custom application tables through the supported SDK/metaschema surface.
3. Apply and verify RLS through the security skill.
4. Install the desired Blocks surface through [`constructive-blocks`](../../constructive-blocks/SKILL.md).
5. Let Console Kit discover each installed capability from endpoint reachability, `_meta` where required, standard introspection, and authenticated runtime behavior.

An installed pack may correctly remain partial or unavailable when the provisioned tenant does not expose its required public route. That is frontend compatibility state, not authorization to modify Constructive DB.
