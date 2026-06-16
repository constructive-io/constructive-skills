/**
 * relation-manager.tsx — a GENERIC N:M link-management surface (one per junction).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped ONCE per N:M (junction) relation by
 * scripts/scaffold-frontend.mjs into
 * <app>/src/components/crud/relations/<junction>-relation-manager.tsx, and mounted
 * as a SECTION on the OWNING entity's page (the relation's source_table). Apps with
 * NO RelationManyToMany emit NOTHING here — the file is never written, so the
 * owner/blog/childfk canaries stay byte-identical.
 *
 * WHAT IT SOLVES (the hard gap)
 * ─────────────────────────────
 * A brief with an M:N junction provisions the link TABLE + its typed SDK hooks
 * (use<Junctions>Query / useCreate<Junction>Mutation / useDelete<Junction>Mutation)
 * but generates NO UI to create/manage the links — you could not attach or detach a
 * linked record from the app (the Cleome field-guide↔observation citations had to be
 * seeded by script). This component closes that GENERICALLY: it lists the records
 * currently linked to ONE owning row and lets the user ADD (create a junction row
 * linking the two sides) and REMOVE (delete the junction row).
 *
 * SCOPE: the junction FK PAIR only (link / unlink). Junction PAYLOAD columns (extra
 * domain columns on the link row) are the deferred SG-3 grammar gap — the brief's M:N
 * `data:` block exposes no payload-column slot, so none are emitted here. When the
 * grammar grows a payload slot, extend the create mutate + a small payload form here.
 *
 * WHAT THE GENERATOR SUBSTITUTES (ALL derived from the brief's N:M relation + _meta —
 * ZERO entity/table literals). Described in prose so this header reads correctly in the
 * GENERATED file too (the substitution rewrites every token, including any in comments):
 *   • The junction identifiers (component name, the use<Junctions>Query list hook + its
 *     data accessor, and the use<Create/Delete<Junction>>Mutation hooks) come from
 *     entityIdentifiers(singular(junction_table)) — e.g. guide_citations → GuideCitation,
 *     useGuideCitationsQuery, useCreate/DeleteGuideCitationMutation.
 *   • The two junction FK columns are the platform-generated camel(singular(<table>))+'Id'
 *     pair: the OWNING-row FK (from source_table, e.g. fieldGuideId) and the LINKED-record
 *     FK (from target_table, e.g. observationId) — verified 1:1 against the codegen'd
 *     Create<Junction>Input.
 *   • The add-picker reads the LINKED (target) entity's list hook (use<Others>Query + its
 *     data accessor) and shows the target table's label field (the first required/
 *     conventional text column; falls back to the raw id when the table has no text label).
 *   • The data-testid PREFIX is the kebab singular of the junction (e.g. guide-citation),
 *     and the section heading + linked-entity label are Title-Cased forms.
 *   • ORG-SCOPING (conditional): when the junction kept its entity_id column (its nested
 *     `data.nodes` includes DataEntityMembership/DataOwnershipInEntity → AuthzEntityMembership
 *     HONORED), the manager imports useActiveOrg, reads the active org, spreads
 *     `entityId: <activeOrg>` into the link create, and gates the add button on the org
 *     being resolved — else the NOT-NULL entity_id RLS-rejects the link. A DataId-only
 *     junction (coerced to AuthzAllowAll, GAP-1d) gets NONE of that (its create input is
 *     the bare FK pair), so the org seams collapse to nothing.
 *
 * data-testid / ARIA contract (QA-able, derived from the relation name; <rel> = the kebab
 * singular junction prefix):
 *   <rel>-relation-manager  — the section shell
 *   <rel>-link-owner-select — picks the OWNING row whose links are managed
 *   <rel>-link-other-select — picks the record to link (the add-picker)
 *   <rel>-link-add          — creates the junction row linking the two sides
 *   <rel>-link-row          — one currently-linked record (a junction row)
 *   <rel>-link-remove       — deletes the junction row (unlink)
 *   <rel>-link-empty        — shown when the owning row has no links yet
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import { useState } from 'react';

import {
  use__Junctions__Query,
  use__Create_Junction__Mutation,
  use__Delete_Junction__Mutation,
  use__Others__Query,
} from '@sdk/app';
__ORG_SCOPING_IMPORT__
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Manage the __REL_LABEL__ links for ONE owning row. `ownerId` is the owning row's id
 * (the row being edited/viewed on the entity page); the section also ships its own
 * owner picker so it is usable directly from the list page (pick an owner → manage its
 * links). Pass `ownerId` to pin it to a row and hide the owner picker.
 *
 * GENERIC: every identifier (hooks, FK keys, labels, testids) is substituted by
 * scaffold-frontend.mjs from the brief's N:M relation — no entity/table is hard-coded.
 */
export function __JUNCTION_PASCAL__RelationManager({
  ownerId: pinnedOwnerId,
  ownerOptions,
  ownerLabelOf,
}: {
  /** Pin the manager to one owning row; omit to render the owner picker. */
  ownerId?: string;
  /** The owning entity's rows (for the owner picker) — [{ id, <label> }]. */
  ownerOptions?: Array<{ id?: string | null } & Record<string, unknown>>;
  /** Render a label for an owning row (defaults to its id). */
  ownerLabelOf?: (row: { id?: string | null } & Record<string, unknown>) => string;
}) {
  __ORG_SCOPING_CONST__

  const owners = ownerOptions ?? [];
  const [pickedOwner, setPickedOwner] = useState('');
  const ownerId = pinnedOwnerId ?? pickedOwner;

  // The record to link (the add-picker's current choice).
  const [otherChoice, setOtherChoice] = useState('');

  // The LINKED-record options (the target entity's rows) — id + label field (SG-6).
  const othersQuery = use__Others__Query({
    selection: { fields: { __OTHER_LABEL_SELECT__ } },
  });
  const otherOptions = othersQuery.data?.__others__?.nodes ?? [];

  // The junction rows for THIS owning row (filtered to the owner FK). Skipped until an
  // owner is chosen (the typed list `where` keys on the owner FK column).
  const linksQuery = use__Junctions__Query({
    selection: {
      fields: { id: true, __OWN_FK_KEY__: true, __OTHER_FK_KEY__: true },
      where: ownerId ? { __OWN_FK_KEY__: { equalTo: ownerId } } : undefined,
      first: 200,
    },
  });
  const links = ownerId ? (linksQuery.data?.__junctions__?.nodes ?? []) : [];

  const createLink = use__Create_Junction__Mutation({
    selection: { fields: { id: true } },
    onSuccess: () => {
      setOtherChoice('');
      linksQuery.refetch();
    },
  });
  const deleteLink = use__Delete_Junction__Mutation({
    selection: { fields: { id: true } },
    onSuccess: () => linksQuery.refetch(),
  });

  // Resolve a linked junction row to the target record's display label (join on the
  // other FK). Falls back to the raw id when the target row isn't in the loaded page.
  function labelForLink(link: Record<string, unknown>): string {
    const otherId = link['__OTHER_FK_KEY__'] as string | undefined;
    const hit = otherOptions.find((o) => o.id === otherId);
    if (hit) return __OTHER_LABEL_EXPR_FN__;
    return otherId ?? '(unknown)';
  }

  function handleAddLink() {
    // The org guard (__ORG_ADD_GUARD__, when org-scoped) narrows activeOrgId from
    // `string | null` to `string` here, so the `entityId: activeOrgId` spread below is the
    // non-null entity_id the create requires (the SAME control-flow-narrowing the org-scoped
    // entity-page create uses). For a non-org junction this guard collapses to nothing.
    if (!ownerId || !otherChoice__ORG_ADD_GUARD__) return;
    createLink.mutate({
      __OWN_FK_KEY__: ownerId,
      __OTHER_FK_KEY__: otherChoice__ORG_CREATE_KEY__,
    });
  }

  return (
    <Card data-testid="__rel__-relation-manager" className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">__REL_LABEL__</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Owner picker — hidden when the manager is pinned to a row. */}
        {!pinnedOwnerId ? (
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Manage links for</label>
            <select
              data-testid="__rel__-link-owner-select"
              value={pickedOwner}
              onChange={(e) => setPickedOwner(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <option value="">Select a row…</option>
              {owners.map((row) => (
                <option key={row.id} value={row.id ?? ''}>
                  {ownerLabelOf ? ownerLabelOf(row) : row.id}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {/* Add a link — pick a __OTHER_LABEL__ and attach it to the owning row. */}
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-muted-foreground text-xs">Add __OTHER_LABEL__</label>
            {otherOptions.length === 0 ? (
              <select
                data-testid="__rel__-link-other-select-empty"
                disabled
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option>No __OTHER_LABEL__ yet</option>
              </select>
            ) : (
              <select
                data-testid="__rel__-link-other-select"
                value={otherChoice}
                onChange={(e) => setOtherChoice(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {otherOptions.map((opt) => (
                  <option key={opt.id} value={opt.id ?? ''}>
                    {__OTHER_LABEL_EXPR__}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button
            type="button"
            data-testid="__rel__-link-add"
            disabled={createLink.isPending || !ownerId || !otherChoice__ORG_ADD_GUARD__}
            onClick={handleAddLink}
          >
            {createLink.isPending ? 'Linking…' : 'Link'}
          </Button>
        </div>

        {/* Currently-linked records — each removable (delete the junction row). */}
        {!ownerId ? (
          <p className="text-muted-foreground text-sm">
            Select a row above to manage its __REL_LABEL__.
          </p>
        ) : links.length === 0 ? (
          <p data-testid="__rel__-link-empty" className="text-muted-foreground text-sm">
            No links yet — add one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {links.map((link) => (
              <li
                key={link.id}
                data-testid="__rel__-link-row"
                className="flex items-center gap-3 rounded-md border px-4 py-2"
              >
                <span className="flex-1">{labelForLink(link as Record<string, unknown>)}</span>
                <Button
                  size="sm"
                  variant="destructive"
                  data-testid="__rel__-link-remove"
                  disabled={deleteLink.isPending}
                  onClick={() => link.id && deleteLink.mutate({ id: link.id })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
