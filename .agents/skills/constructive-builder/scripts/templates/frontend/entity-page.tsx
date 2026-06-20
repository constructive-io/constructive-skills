/**
 * entity-page.tsx — parameterized per-entity CRUD page (a WORKING SKELETON to AUTHOR FROM).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped per CRUD route by scripts/scaffold-frontend.mjs to
 * <app>/src/app/<entity>/page.tsx (one file per `ui.routes[].kind: crud` entry).
 *
 * WHAT THIS IS — and IS NOT. This is the FUNCTIONAL SKELETON: the data wiring, the
 * testids, the four list states, the row-scoping, and the RLS scoping the app needs to
 * WORK and to compose with Blocks. It is NOT the finished UI. The default presentation
 * below (a card + a divided list, neutral shadcn surfaces) is a sane, replaceable
 * starting point — NOT a prescription. The frontend phase is "scaffold this skeleton,
 * THEN AUTHOR the presentation faithfully from the app's design.md" (customize/replace
 * the stock components, set the type/scale/weights, compose the layout, add intentional
 * hierarchy/spacing/ornament). AUTHOR everything below the PRESENTATION SEAM; the ONLY
 * hard rails are (1) the FUNCTIONAL contract (the testids/hooks/states/scoping/mounts
 * called out at the seam) and (2) the shadcn-token contract (Blocks read tokens by
 * name). See references/art-direction.md for the authoring playbook + the preserve list.
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
 * THE FOUR LIST STATES (a FUNCTIONAL invariant — emit all four for EVERY entity; their
 * LOOK is the design.md's call — author each one, don't ship the stock shape as final):
 *   • LOADING — a skeleton wrapped in data-testid="__entity__-loading". Author it to
 *     MIRROR your authored list shape so the first paint has no layout jump. Each skeleton
 *     carries data-slot="skeleton" so the boilerplate's prefers-reduced-motion rule stills
 *     its pulse (keep that when you restyle).
 *   • ERROR — data-testid="__entity__-error", role="alert", with the query message + a
 *     Retry (data-testid="__entity__-retry") that re-runs the query. The testid MUST NOT
 *     end in "-empty" (the live-QA driver reserves [data-testid$="-empty"] for the empty
 *     state) — that constraint is functional; the panel's design is yours.
 *   • EMPTY — data-testid="__ENTITIES_EMPTY_TESTID__" (the kebab PLURAL + "-empty"),
 *     inviting the first create. Author the invitation; keep the testid.
 *   • DATA — the rows. Each repeating record carries data-testid="__entity__-row", CONTAINS
 *     the row's title text, and scopes its own edit/delete inside it. Compose the list as
 *     the design.md dictates (rows / table / cards / board / split-pane — see
 *     art-direction.md). data-slot="content-fade-in" gives a reduced-motion-honored fade.
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

  // ╔══════════════════════════════════════════════════════════════════════════════════╗
  // ║ PRESENTATION SEAM — AUTHOR THE UI FROM HERE.                                        ║
  // ╚══════════════════════════════════════════════════════════════════════════════════╝
  // Everything ABOVE this line is the FUNCTIONAL skeleton (data hooks + handlers) — keep it.
  // Everything in the return(...) BELOW is a neutral DEFAULT, not the final design: AUTHOR it
  // faithfully from the app's design.md — customize/replace the stock shadcn components, set the
  // type (the design.md's fonts/scale/weights), compose the layout (rows → data-table / gallery /
  // split-pane / editorial / board), establish real hierarchy + spacing rhythm + intentional
  // ornament, add subtle motion (honor prefers-reduced-motion). Blocks compose as INGREDIENTS.
  // See references/art-direction.md for the authoring playbook.
  //
  // The ONLY things you may NOT remove/rename/hide while authoring (RAIL 1 — the functional
  // contract; the gates + live-QA assert these by testid/role only, never by look):
  //   • the <entity>-* testids: title-input · create-submit · details · row (MUST contain the
  //     row's title text) · edit · delete · loading · error (role="alert", NOT "-empty") · retry;
  //     and <entities>-empty;
  //   • row-scoping: each row's edit/delete live INSIDE its <entity>-row;
  //   • the data wiring: the hooks + selection.fields + refetch + the three useCardStack pushes
  //     (openEdit / openDetailedCreate / openDelete);
  //   • the policy scoping const(s) (ownerId / activeOrgId / validFrom) spread into the create.
  // And RAIL 2 — the shadcn-token contract: components read tokens by NAME (bg-primary,
  // text-muted-foreground, border-border, …). Restyle them, add your own; don't break the names.
  // Restyle and re-compose freely — just never HIDE a contract control (display:none / 0×0 fails).
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
        // LOADING (default to author) — a skeleton that mirrors the list shape so the first
        // paint has no layout jump. Re-author it to match your authored list. KEEP the
        // data-testid="__entity__-loading" wrapper + data-slot="skeleton" (reduced-motion).
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
        // ERROR (default to author) — the query message + a Retry. KEEP data-testid="__entity__-error"
        // (role="alert", and NOT a "-empty" suffix, which the live-QA driver reserves for the empty
        // state) + the __entity__-retry control. Design the panel however the design.md dictates.
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
        // EMPTY (default to author) — invite the first create. KEEP the kebab-PLURAL "-empty"
        // testid (the driver's empty-state sentinel). data-slot="content-fade-in" = reduced-motion fade.
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
        // DATA (default to author) — the rows. Compose this however the design.md dictates
        // (list / data-table / cards / board / split-pane). KEEP each repeating record as an
        // <entity>-row that CONTAINS its title text and scopes its own edit/delete inside it.
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
