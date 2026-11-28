# Node Type Registry

The registry (`node-type-registry`) defines every node a blueprint can name. Two pages are generated from it, so they list every node with its current parameters; do not edit them by hand:

- [node-reference.md](./node-reference.md): every node except the Authz nodes, where a blueprint names it, whether a table can name it as a string, and its parameters.
- [authz-node-reference.md](../../constructive-security/references/authz-node-reference.md): the Authz nodes, who each policy lets in, and when to use it.

Where a node goes in a blueprint:

- A table names its nodes in `nodes`. A node that needs no data can be a string (`"DataId"`); any other node is `{ "$type": "<node>", "data": { ... } }` with its required parameters.
- A table's `policies` hold Authz nodes, each with its `privileges`, and its `data` when the node has required parameters.
- `relations` hold the Relation nodes, with their parameters at the top level of the entry.
- No key of a blueprint takes a View node.

## Families

| Family | What its nodes do | Read next |
|---|---|---|
| Data | Add columns, triggers and behaviors to a table: ids, timestamps, ownership, slugs, tags, locks, translations, realtime | `constructive-data-modeling` |
| Check | Add constraints: comparisons, allowed values, and the same-owner guard for typed pointers | `constructive-data-modeling` |
| Search | Full-text, BM25, trigram, vector and spatial search on a table | `constructive-search` |
| Process | File and text processing: chunks, extraction, embeddings, image versions | `constructive-agents`, `constructive-storage` |
| Job | Triggers that enqueue background jobs | `constructive-jobs` |
| Event | Event tracking and referrals | `constructive-events` |
| Guard | Step-up checks before a write | `constructive-security` |
| Limit | Usage limits, usage tracking and warnings | `constructive-billing` |
| Relation | Foreign keys, one-to-one, many-to-many and spatial relations between tables | `constructive-data-modeling` |
| Authz | Row-level security policies | `constructive-security` |

## Module Presets

Preconfigured backend module bundles — see [module-presets.md](./module-presets.md) for the current source-of-truth boundary and supported profiles.
