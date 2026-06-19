/**
 * entity-page.tsx — parameterized per-entity CRUD page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped per CRUD route by scripts/scaffold-frontend.mjs to
 * <app>/src/app/<entity>/page.tsx (one file per `ui.routes[].kind: crud` entry).
 *
 * Two complementary CRUD paths:
 *   • QUICK-ADD + list — the typed, codegen'd SDK hooks (use__Entities__Query /
 *     use__Create_Entity__Mutation). A single-submit create + a typed list. This is
 *     the path the live-QA driver exercises (fill __entity__-title-input → click
 *     __entity__-create-submit → assert the new __entity__-row persisted on reload),
 *     and it mirrors the working golden-app /todos page exactly.
 *   • EDIT (and detailed create) — the runtime-generic DynamicFormCard pushed on the
 *     CRUD Stack (the reuse — schema-driven via `_meta`, no bespoke per-table form).
 *     On an ORG-SCOPED table the detailed-create push passes the ACTIVE org as a
 *     `defaultValues` context entry (entity_id is a SYSTEM field the form hides, so the
 *     card supplies it) and gates the "Details…" button on a resolved active org — the
 *     same active-org scope the quick-add spreads. Owner/public pass neither.
 *
 * `entity=todo` makes the canary's `todo-*` testids + single-submit create fall out
 * with zero special-casing.
 *
 * Placeholders the generator substitutes (derived from the brief table + its policy):
 *   __Entities__       ← PascalCase PLURAL  → list hook `use__Entities__Query`
 *                        (e.g. Todos / Contacts)
 *   __entities__       ← camelCase  PLURAL  → `data.__entities__` accessor + list key
 *                        (e.g. todos / contacts)
 *   __Create_Entity__  ← PascalCase SINGULAR for the create-mutation hook
 *                        `use__Create_Entity__Mutation` (e.g. CreateTodo / CreateContact)
 *   __Entity__         ← PascalCase SINGULAR → DynamicFormCard `tableName` (the `_meta`
 *                        table type) + card titles (e.g. Todo / Contact)
 *   __entity__         ← lower/kebab SINGULAR → the data-testid prefix
 *                        (e.g. todo → todo-title-input / todo-create-submit / todo-row /
 *                        todo-edit / todo-delete)
 *   __ENTITY_LABEL__   ← human-readable heading (e.g. "Todos", "Contacts")
 *   __TITLE_FIELD__    ← the field shown as each row's label + bound to the quick-add
 *                        input (generator picks the first required text field; default
 *                        'title')
 *   the list selection.fields ← `id`, the label field, and the table's brief fields
 *                        (camelCase), each `: true`. codegen 4.45.1+ MANDATES a non-empty
 *                        selection.fields (HookStrictSelect); the generator derives it from
 *                        the brief's data_model.tables[].fields. The create-mutation
 *                        selection is the minimal `id` + label field the refetch needs.
 *   __LIST_WHERE__     ← the list-query `where` filter line. EMPTY for ordinary tables.
 *                        For a SOFT-DELETE table (features: [soft-delete] → DataSoftDelete,
 *                        which materializes the inflected `isDeleted` flag column) the
 *                        generator emits `where: { isDeleted: { equalTo: false } },` so
 *                        soft-deleted rows (Delete sets is_deleted=true, the row PERSISTS in
 *                        the DB) drop out of the active list. The codegen-correct filter is
 *                        the typed list `where` (ListSelectionConfig → <Table>Filter →
 *                        isDeleted: BooleanFilter), NOT a top-level `condition`.
 *   the scoping-id const ← the generator emits, per the table's policy intent, either an
 *                        `ownerId` (admin token -> DataDirectOwner.owner_id) or an
 *                        `activeOrgId` (from useActiveOrg() -> AuthzEntityMembership.entity_id)
 *                        const — with the matching scoping import — then spreads the key:
 *                          owner            -> `ownerId`    (DataDirectOwner needs owner_id)
 *                          org-membership   -> `entityId: activeOrgId`  (the ACTIVE org from
 *                                              the org-context — defaulted to the actor's owned
 *                                              org, updated by the OrgSwitcher; multi-org safe,
 *                                              not a token-userId guess. The create also gates
 *                                              on the active org being resolved before submit.)
 *                          public-lookup    -> (no key — no ownership column)
 *                        PLUS, for a `restrict: [temporal]` table, a `validFrom:
 *                        new Date().toISOString()` key (the current instant from the
 *                        runtime clock at submit time) so the row PASSES the RESTRICTIVE
 *                        AuthzTemporal INSERT WITH-CHECK and lands IN-window (valid_from
 *                        <= now; valid_until omitted = NULL = open-ended) — else every
 *                        generated create is rejected. The policy + temporal fragments
 *                        compose (a table can be both owner-scoped AND temporal).
 *                        SEAM: edit the mutation body if your create needs other non-null
 *                        FKs the quick-add can't infer. This create key is emitted ONLY in
 *                        the mutation body (a real expression context), NEVER in this JSDoc
 *                        (an injected `/* … *​/` would prematurely close the doc-comment).
 *
 * Richer shapes (multi-column tables, detail panes, custom layouts) are a
 * `kind: custom` route → a stub page with a `// TODO: custom UI` seam, NOT this template.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import { useState } from 'react';

import {
  use__Entities__Query,
  use__Create_Entity__Mutation,
} from '@sdk/app';__PARENT_HOOK_IMPORT__
import { useCardStack } from '@/components/ui/stack';
import { DynamicFormCard } from '@/components/crud/dynamic-form-card';
__SCOPING_IMPORT__
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';__RELATION_MANAGER_IMPORT__

/**
 * /__entities__ — typed quick-add + list (SDK hooks); edit/detailed-create via
 * DynamicFormCard on the CRUD Stack.
 *
 * Emits the APP-controlled testids the live-QA driver asserts:
 *   authed-shell · __entity__-title-input · __entity__-create-submit · __entity__-row
 *   __entity__-edit · __entity__-delete
 */
export default function __Entities__Page() {
  const stack = useCardStack();

  __OWNER_CONST__

  const [quickTitle, setQuickTitle] = useState('');__PARENT_FK_HOOK__

  const { data, isLoading, refetch } = use__Entities__Query({
    selection: {
      fields: {
        __SELECTION_FIELDS__
      },__LIST_WHERE__
      orderBy: ['ID_ASC'],
      first: 100,
    },
  });

  const create__Entity__ = use__Create_Entity__Mutation({
    selection: {
      fields: {
        __CREATE_SELECTION__
      },
    },
    onSuccess: () => {
      setQuickTitle('');
      refetch();
    },
  });

  const rows = data?.__entities__?.nodes ?? [];

  function handleQuickCreate(e: React.FormEvent) {
    e.preventDefault();
    const t = quickTitle.trim();
    if (!t__ORG_SUBMIT_GUARD__) return;
    create__Entity__.mutate({ __TITLE_FIELD__: t__CREATE_EXTRA____CREATE_FK_EXTRA__ });
  }

  // Detailed create — the full schema-driven form (every field) on the Stack.
  function openDetailedCreate() {__DETAILS_GUARD__
    stack.push({
      id: 'create-__entity__',
      title: 'New __ENTITY_LABEL__',
      Component: DynamicFormCard,
      props: {
        tableName: '__Entity__',__DETAILED_CREATE_DEFAULTS__
        onSuccess: () => refetch(),
      },
      width: 480,
    });
  }

  function openEdit(id: string) {
    stack.push({
      id: `edit-__entity__-${id}`,
      title: 'Edit __ENTITY_LABEL__',
      Component: DynamicFormCard,
      props: {
        tableName: '__Entity__',
        recordId: id,
        onSuccess: () => refetch(),
      },
      width: 480,
    });
  }

  // DELETE the row via the DynamicFormCard delete-confirm path. The list Delete used to call
  // openEdit (which just reopens the EDIT form — a no-op as a delete). Instead we push the
  // schema-driven card in record mode, which renders its footer `record-delete` control; that
  // opens the `record-delete-confirm` confirmation card, and confirming runs the actual delete
  // mutation. Routing through DynamicFormCard (rather than calling a delete mutation inline)
  // reuses its single source of truth for delete SEMANTICS — it is soft-delete-aware: a table
  // provisioned with the `soft-delete` feature is flagged (recoverable) via an UPDATE, while a
  // plain table is hard-deleted via the root delete mutation. The card also owns the per-DB
  // app endpoint + auth bridge, so no endpoint constant is needed in this page (and so this
  // stays generic for ANY entity — no entity/table is hard-coded here). The delete REQUIRES a
  // confirm (record-delete -> record-delete-confirm). data-testid / role only.
  function openDelete(id: string) {
    stack.push({
      id: `delete-__entity__-${id}`,
      title: 'Delete __ENTITY_LABEL__',
      Component: DynamicFormCard,
      props: {
        tableName: '__Entity__',
        recordId: id,
        onSuccess: () => refetch(),
      },
      width: 480,
    });
  }

  return (
    <div data-testid="authed-shell" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">__ENTITY_LABEL__</h1>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Add __ENTITY_LABEL__</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleQuickCreate} className="flex gap-3">
            <Input
              data-testid="__entity__-title-input"
              placeholder="Name…"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
            />
            <Button
              type="submit"
              data-testid="__entity__-create-submit"
              disabled={create__Entity__.isPending || !quickTitle.trim()__SUBMIT_GUARD____ORG_SUBMIT_GUARD__}
            >
              {create__Entity__.isPending ? 'Adding…' : 'Add'}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="__entity__-details"
              onClick={openDetailedCreate}__DETAILS_DISABLED__
            >
              Details…
            </Button>__FK_SELECT_JSX__
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p data-testid="__ENTITIES_EMPTY_TESTID__" className="text-muted-foreground text-sm">
          Nothing yet — add your first one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="__entity__-row"
              className="flex items-center gap-3 rounded-md border px-4 py-3"
            >
              <span className="flex-1">{row.__TITLE_FIELD__ ?? row.id}</span>
              <Button
                size="sm"
                variant="outline"
                data-testid="__entity__-edit"
                onClick={() => row.id && openEdit(row.id)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="destructive"
                data-testid="__entity__-delete"
                onClick={() => row.id && openDelete(row.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}__RELATION_MANAGER_JSX__
    </div>
  );
}
