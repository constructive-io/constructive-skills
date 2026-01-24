# Specs

Specs are accepted contracts that define reference behavior. They are the source of truth for implementation and testing.

## Characteristics

- **Authoritative**: Specs define what the system should do
- **Accurate**: Must be kept up-to-date as implementation evolves
- **Testable**: Reviewers and tests enforce spec compliance

## Two-Axis Status Tracking

Specs track two independent dimensions:

### Decision Status (contract lifecycle)

| Status | Meaning |
|--------|---------|
| Draft | Spec is being written, not yet approved |
| Accepted | Approved as the contract—implementation may proceed |
| Deprecated | No longer recommended; may still be implemented |
| Superseded | Replaced by another spec |

### Implementation Status (delivery lifecycle)

| Status | Meaning |
|--------|---------|
| Not Implemented | No implementation exists |
| In Progress | Active development underway |
| Partial | Some functionality implemented |
| Implemented | Fully implemented and verified |
| Blocked | Implementation cannot proceed |

## Future Behavior

Specs may describe not-yet-implemented behavior **only** when Decision Status = Accepted. This allows teams to document planned work before code is written, while making the implementation state explicit.

## Creating a Spec

1. Start with an accepted plan (see `docs/plan/`)
2. Copy `template.spec.md` to a new file (e.g., `my-feature.spec.md`)
3. Set Decision Status = Accepted, Implementation Status = Not Implemented
4. Update Implementation Status as work progresses
5. Keep the spec accurate as the implementation evolves
