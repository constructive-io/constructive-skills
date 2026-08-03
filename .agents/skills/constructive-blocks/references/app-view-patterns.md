# Select and compose App Kit views

Read this after resources are validated and the brief needs a collection,
board, dashboard, or temporal surface. Use the
[canonical Blocks App Kit docs](https://constructive-io.github.io/blocks/blocks/app-kit/)
for current controlled and connected component APIs.

## Select by geometry

1. Query `--list-registry --family app-kit` and inspect the returned metadata.
   Use `--capability` only after discovering the catalog vocabulary.
2. Match collections to scan/compare tasks, boards to explicit semantic stage
   movement, dashboards to approved analytical questions, and calendars to
   visible-range temporal work. Compose ordinary React when no family fits.
3. Choose the controlled layer when the host owns data and callbacks. Choose
   the connected layer when App Kit definitions should own remote execution.
4. Keep record opening host-controlled and preserve URL restoration when the
   brief requires shareable filters, selection, view, or range state.

## Apply view-specific checks

- Keep collection paging and relation search server-driven. Distinguish
  loading, empty, denied, and error states.
- Enable board movement only when a semantic move action exists. Provide a
  keyboard alternative and verify rollback plus focus restoration.
- Back every KPI or series with an explicit analytical loader. Never calculate
  authoritative metrics from one paginated page, and expose only catalogued
  widgets to runtime layout editing.
- Query calendars by visible range with explicit locale and timezone. Do not
  imply recurrence, resource scheduling, or drag-rescheduling in V1.

Use semantic theme tokens, select density and surface variants from context,
and keep primary data/actions usable on mobile. A dense board or layout canvas
may optimize for desktop only when its mobile fallback remains readable.
