# Wire App Kit actions and workflows

Read this when a brief includes mutations, confirmations, bulk execution, or a
multi-step interaction. Resolve `installability.appKitDocumentation.authority`
through the validated App Kit catalog query for current action definitions,
runtime hooks, surfaces, and invalidation APIs.

## Define actions from user intent

1. Name the semantic intent and identify its typed input, output, validation,
   confirmation, authority expectation, and affected views.
2. Inject an abortable executor through the host transport. Keep transport
   details and credentials outside reusable definitions. Return framework
   result envelopes only through the documented `appSuccess` and `appFailure`
   helpers; do not hand-build lookalike `{ ok, data }` or `{ ok, error }`
   objects.
3. Declare targeted invalidation for affected detail, collection, relation,
   board, dashboard, and calendar queries. Avoid whole-cache invalidation.
4. Add optimistic behavior only when rollback is deterministic inside the
   active cache partition. Use the callback's scope-bound cache facade and App
   Kit query keys; do not reach through it to a raw TanStack `QueryClient` or
   read, write, or cancel a key from another scope.
5. Choose a documented controlled surface when the host owns execution or a
   connected surface when App Kit should own validation, progress,
   cancellation, rollback, and invalidation.

## Verify failure behavior

- Suppress or replace duplicate submissions according to the documented
  concurrency policy, and pass cancellation through to the transport.
- Show field validation near its input and preserve safe partial GraphQL and
  authorization errors at the action surface.
- Restore focus after dialogs and confirmations. Confirm destructive or
  externally visible effects.
- Roll back optimistic state on denial, failure, or abort, then prove another
  scope never observes the optimistic value.
- Treat visibility and disabled rules as presentation hints; RLS denials remain
  authoritative and visible.

Use the controlled stepper only for guided UI. Persist durable workflow state
as domain records and delegate background execution to the owning platform
capability; App Kit is not a job or approval engine.
