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
 * THE FOUR LIST STATES (taste-skill's highest-value app rule — emitted for EVERY entity):
 *   • LOADING — a skeleton that MIRRORS the real list layout (a bordered surface with
 *     divided rows, each a label-line skeleton + two affordance-sized blocks), so the
 *     first paint has the same shape the data will fill (no layout jump). Each skeleton
 *     carries data-slot="skeleton" so the boilerplate's prefers-reduced-motion rule
 *     stills its pulse. Wrapped in data-testid="__entity__-loading".
 *   • ERROR — a quiet, non-card panel (a left-accent divider, weight+color hierarchy)
 *     with the query message + a Retry that re-runs the query. data-testid="__entity__-error".
 *     NOTE the testid does NOT end in "-empty": the live-QA driver detects the empty
 *     state via [data-testid$="-empty"], so the error state is kept distinct.
 *   • EMPTY — a calm dashed panel inviting the first create (data-testid="__ENTITIES_EMPTY_TESTID__",
 *     the kebab PLURAL + "-empty").
 *   • DATA — the rows, in ONE bordered surface with dividers between rows (cards are
 *     reserved for the add surface, where elevation earns its keep; a flat list reads
 *     better with dividers than N stacked cards). Faded in via data-slot="content-fade-in"
 *     (also reduced-motion-honored upstream).
 *
 * DENSITY (generic, dial-driven). Spacing/padding/rhythm are SUBSTITUTED at scaffold
 * time from brief.design.dials.density (1–10) via the generator's density scale — the
 * __D_*__ tokens below resolve to concrete Tailwind classes. When the brief carries no
 * design block they resolve to the COZY default (the historical values), so a design-less
 * build is byte-identical. No data-attribute / no globals.css coupling — it is baked into
 * the emitted className strings, so it never depends on another agent's CSS.
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
 *                        todo-edit / todo-delete / todo-loading / todo-error)
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
import { Skeleton } from '@/components/ui/skeleton';
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
 *   __entity__-edit · __entity__-delete   (plus __entity__-loading / __entity__-error
 *   for the loading + error states, kept distinct from the "-empty" empty-state id).
 */
export default function __Entities__Page() {
  const stack = useCardStack();

  __OWNER_CONST__

  const [quickTitle, setQuickTitle] = useState('');__PARENT_FK_HOOK__

  const { data, isLoading, isError, error, refetch } = use__Entities__Query({
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

  // PRESENTATION SEAM: restructure this return(...) block freely per the design.md — swap the
  // card+divided-list wholesale to a data-table / gallery / split-pane / editorial / board layout,
  // re-arrange the shell, change the width clamp (see references/art-direction.md). PRESERVE the
  // functional contract: the <entity>-* testids (title-input / create-submit / details / row [must
  // contain the row title] / edit / delete / loading / error[role=alert, not -empty] / retry) and
  // <entities>-empty; row-scoping (edit/delete inside the row); the hooks + selection.fields +
  // refetch + the three useCardStack pushes (openEdit/openDetailedCreate/openDelete); and the policy
  // scoping const(s) (ownerId / activeOrgId / validFrom) spread into the create. Restyle, don't hide.
  return (
    <div data-testid="authed-shell" className="mx-auto max-w-2xl __D_PAGE__">
      <header className="__D_HEAD_MB__">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">__ENTITY_LABEL__</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create, edit, and manage your __ENTITY_LABEL_LOWER__.
        </p>
      </header>

      <Card className="__D_SECTION_MB__">
        <CardHeader>
          <CardTitle className="text-base font-medium">Add __ENTITY_LABEL__</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleQuickCreate} className="flex __D_FORM_GAP__">
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
        // LOADING — skeleton that mirrors the real list shape (a bordered surface with
        // divided rows), so the first paint has no layout jump. data-slot="skeleton" lets
        // the boilerplate's prefers-reduced-motion rule still the pulse.
        <div data-testid="__entity__-loading" className="divide-y divide-border rounded-lg border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center __D_ROW_GAP__ __D_ROW_PAD__">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-8 w-14 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          ))}
        </div>
      ) : isError ? (
        // ERROR — a quiet, non-card panel (left-accent divider; weight+color hierarchy, not a
        // shouty box) with the query message + Retry. The testid is __entity__-error (NOT a
        // "-empty" suffix, which the live-QA driver reserves for the empty state).
        <div
          data-testid="__entity__-error"
          role="alert"
          className="border-l-2 border-destructive py-3 pl-4"
        >
          <p className="text-sm font-medium text-foreground">Couldn’t load __ENTITY_LABEL_LOWER__.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="__entity__-retry"
            className="mt-3"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        // EMPTY — a calm dashed panel inviting the first create. data-slot="content-fade-in"
        // gives a subtle, reduced-motion-honored fade.
        <div
          data-testid="__ENTITIES_EMPTY_TESTID__"
          data-slot="content-fade-in"
          className="rounded-lg border border-dashed __D_EMPTY_PAD__ text-center"
        >
          <p className="text-sm font-medium text-foreground">No __ENTITY_LABEL_LOWER__ yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your first one with the form above.
          </p>
        </div>
      ) : (
        // DATA — one bordered surface, rows separated by dividers (cards are reserved for the
        // add surface above, where elevation earns its keep).
        <ul data-slot="content-fade-in" className="divide-y divide-border rounded-lg border">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid="__entity__-row"
              className="flex items-center __D_ROW_GAP__ __D_ROW_PAD__"
            >
              <span className="flex-1 text-sm text-foreground">{row.__TITLE_FIELD__ ?? row.id}</span>
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
