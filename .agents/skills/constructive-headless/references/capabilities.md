# What to load for each task

Use the devnet profile to establish connectivity and scope. Load the domain skill for the requested task. The [Constructive feature catalog](../../constructive-features/SKILL.md) has the broader product and Blocks map.

| Task | Where to start | Capability to verify |
| --- | --- | --- |
| Read or change records in an existing app | [Constructive ORM](../../constructive-orm/SKILL.md) for data operations and pagination. Use the tenant data endpoint. | A scoped query or authorized mutation against the live schema |
| Provision a database, add tables, or change relationships | [Data Modeling](../../constructive-data-modeling/SKILL.md) and [Blueprints](../../constructive-blueprints/SKILL.md). For the terminal CLI, follow [the private-table walkthrough](harness.md#build-a-first-private-table). | A database ID with explicit endpoints. For schema changes, verify the resulting tenant GraphQL schema before using it. |
| Give an agent access or configure app sign-in | [Principals](../../constructive-principals/SKILL.md) for delegated credentials, [Auth](../../constructive-auth/SKILL.md) for sign-in, and [Security](../../constructive-security/SKILL.md) for RLS. | The intended realm, who can read and write, and whether the operation needs step-up |
| Build a frontend or generate an SDK | [Constructive Builder](../../constructive-builder/SKILL.md) and [Blocks](../../constructive-blocks/SKILL.md) for an already-provisioned tenant. Use [Codegen](../../constructive-codegen/SKILL.md) for a stable typed client. | The tenant descriptor, runtime session, and a working app flow with a scoped user |
| Upload files or publish a static site | [Storage](../../constructive-storage/SKILL.md) for upload sessions and confirmations. [Sites](../../constructive-sites/SKILL.md) for release manifests, previews, and rollback. | A reconciled bucket and a readable deployed URL. Check `manage_sites` if using the platform Sites surface. |
| Add a customer function or background job | [Functions](../../constructive-functions/SKILL.md) for database functions and triggers, [Jobs](../../constructive-jobs/SKILL.md) for background jobs, and [Platform](../../constructive-platform/SKILL.md) for cloud functions. | The installed capability and a successful invocation or recorded job outcome |
| Inspect hosted agent work or build an agent feature | [Agents](../../constructive-agents/SKILL.md) for agent definitions and modules. Use the `agent` endpoint for hosted data and the [harness guide](harness.md) for execution. | The authorized thread or run, its placement, and the operations its endpoint exposes |

For a new app, choose the backend preset and provision first, preserve the returned endpoints, model tables and RLS, and then build and verify the frontend against that tenant. A feature described in a skill also needs a deployed API, enabled modules, and permissions in the current environment.
