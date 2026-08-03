# Adapt compact App Kit recipes

Read this when a brief resembles a common app shape but does not need Event
Studio. Use the [canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for current capabilities, then query the validated catalog instead of copying
root names from these prompts.

| Recipe | Extract from the brief | Challenge before selecting views |
| --- | --- | --- |
| Service desk | Customers, tickets, notes, search, assignment, lifecycle movement | Is the lifecycle an explicit move intent, or only a status field? |
| Intake and approval | Requests, evidence, reviewers, decisions, guided input | Does the user need a queue/board, or only records plus semantic decisions? |
| Directory and search | People, teams, locations, memberships, high-cardinality search | Are relation candidates searched on the server and linked rather than created inline? |
| Planning | Programs, milestones, owners, dates, stage movement, publishing | Which board and temporal geometries are independently required? |
| Reporting and configuration | Approved metrics, series, settings records, explicit execution | Are aggregates backed by dedicated loaders rather than one collection page? |

For each recipe:

1. Rewrite the department-flavored brief as data shapes, user intents, and
   workflow needs.
2. Query `--list-registry --family app-kit`, match returned metadata, and
   inspect dependency closure.
3. Compare the result with the corresponding deterministic fixture.
4. Add optional platform-capability packs in a separate pass.
5. Continue with resource validation, view-specific checks, and the full
   verification loop.

Do not infer Sheets, Console Kit, a board, dashboard, or review queue from a
domain label. Compose ordinary React when the validated catalog has no suitable
view family.
