# Direct API access

Send an HTTPS `POST` to the selected endpoint with `Content-Type: application/json` and `Authorization: Bearer <credential>`. The request body takes `query` and optional `variables`. GraphQL errors can arrive with HTTP 200. Check the response `errors` array before interpreting `data`.

| Purpose | Endpoint from the profile | GraphQL query |
| --- | --- | --- |
| Check reachability | Any public endpoint | `query { __typename }` |
| Bootstrap a platform token | `CONSTRUCTIVE_DEVNET_AUTH_ENDPOINT` | `signIn` (human session), then `createApiKey` or `mintAccessToken` |
| Verify a platform credential | `CONSTRUCTIVE_DEVNET_AUTH_ENDPOINT` | `query { currentUserId }` |
| Discover visible databases | `CONSTRUCTIVE_DEVNET_API_ENDPOINT` | `query { databases(first: 5) { nodes { id name } pageInfo { hasNextPage endCursor } } }` |
| Find hosted run or thread fields | `CONSTRUCTIVE_DEVNET_AGENT_ENDPOINT` | Inspect the live schema for `agentRuns` and `agentThreads` |

The discovery query returns database IDs and names. Obtain public tenant routes from the provisioning result or a trusted tenant descriptor before passing credentials to them. For an existing tenant, inspect the data endpoint's live GraphQL schema or use its generated schema if introspection is disabled. For runtime metadata or a generated client, use the [ORM guidance](../../constructive-orm/SKILL.md) and its `_meta` reference. Use the tenant credential on that realm. Check auth and RLS before interpreting an empty collection. Use variables for inputs, paginate collections, and read back changes made within the user's scope.

The [CNC CLI guide](../../constructive-platform/references/cnc-cli.md) covers persistent CLI contexts. Use a dedicated context per endpoint and realm. [Tenant descriptor example](../../constructive-builder/fixtures/tenant-database.template.json)
