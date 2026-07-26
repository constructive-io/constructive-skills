# Recovery

Record the failed typed artifact before changing code. Start a new attempt only after classifying the failure, and invalidate every passed downstream stage whose proof the correction changes.

| Failure class | Evidence check | Frontend-safe response |
| --- | --- | --- |
| Brief | Composition, tenant provenance, binding, actor, route, or expected state is ambiguous. | Correct and revalidate the brief, then initialize a new journal because frozen intent changed. |
| Blocks source | Branch-only preflight, portable plan, generated aggregate, or installed sidecar differs. | Return to `constructive-blocks`, retain checker output, and use its current local-consumption recipe. Do not hand-copy registry source. |
| Tenant routing | A primary/isolation descriptor is extra-keyed, secret-bearing, unsafe, unreachable, or points at the wrong semantic endpoint. | Request the exact host-owned descriptor/session handoff. Never derive hosts, query credentials, or operator authority. |
| Console session | Internal Auth lacks a routable auth endpoint, or host `databaseId`, CSRF, callback, or session ownership differs. | Correct the frontend handoff to the briefed discriminant; keep credentials closure-owned and outside Zustand. |
| Discovery | `_meta` contract validation and standard introspection disagree. | Re-run the attested 2026-07 sequence against the same endpoint and fail closed; never invent operation names. |
| Runtime authority | Authenticated requests are denied, RLS-empty, or leak across actors/tenants. | Verify actor/session/database identity and frontend routing. If integration is correct, retain request/UI proof and report the backend contract mismatch without patching the backend. |
| Host identity reset | Stale host-controlled state survives a database or identity change outside the known Data limitation. | Fix the host Console session/cache reset at both scopes and repeat live proof. Do not claim this repairs Data's pinned nested Sheets store. |
| Blocks state limitation | The snapshot reports a source nonconformance for the selected surface/runtime mode. | Preserve the exact record. A `blocking` limitation fails acceptance and escalates to Blocks; a `require-mitigation` limitation may pass only with retained proof for every snapshot requirement. |
| Standalone Data | `SheetsConfig`, data/Auth endpoint, tenant database ID, CSRF policy, session, execute, or custom adapter differs from the brief. | Fail closed before render. Prefer embedded host auth; never accept the source Auth-endpoint fallback, cross-tenant default database key, persistent token behavior, or a standalone Auth flow when the tenant requires CSRF. |
| Console false-ready | A module reports ready from endpoint names, split-endpoint discovery, or incomplete metadata/type evidence. | Re-run the exact alternative IDs, verification profile, adapter group, and prerequisites copied into the validation report. Report unavailable unless the required coordinates, fields, same-endpoint pairs, and executable operations all pass. |
| Domain UI | Pack surfaces work but application CRUD does not. | Fix the application-owned operation reconciliation, adapter, form, cache, or route and invalidate `domain` plus downstream stages. |
| Visual | Behavior works but hierarchy, responsive layout, focus, or feedback fails. | Correct the consumer composition or authorized Blocks source, then repeat visual and acceptance stages. |
| Journal drift | A retained artifact/input hash changes, or the workspace changes outside a running stage. | Restore the attested bytes or explicitly invalidate the earliest affected stage. A changed immutable input needs a new validation/journal. |

Do not normalize unexpected partial/unavailable behavior into success. A product decision that changes expectations changes the brief. Do not remove a lock until its recorded PID is no longer writing; the lock exists to prevent interleaved evidence history.
