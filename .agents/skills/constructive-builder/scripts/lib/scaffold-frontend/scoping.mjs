/**
 * scripts/lib/scaffold-frontend/scoping.mjs — the per-policy create-scope seams + the scoping
 * constant strings the entity page (and the M:N relation-manager, for org-scoped junctions)
 * splice in.
 *
 * The entity-page template's three scoping seams (__SCOPING_IMPORT__ / __OWNER_CONST__ /
 * __ORG_SUBMIT_GUARD__) are filled by scopingSeams() off the table's POLICY INTENT (never its
 * name): owner/public → the TokenManager ownerId const; org-membership → useActiveOrg(); and
 * member-owner → BOTH. The same ORG_SCOPING_IMPORT / ORG_OWNER_CONST strings feed an org-scoped
 * junction's relation-manager (relations-m2m.mjs), so they live here as the shared source.
 *
 * GENERIC: composed from independent ORG and OWNER fragments off `table.policy` /
 * `table.policies_raw`, so each tier reproduces the prior template EXACTLY where it always did.
 */

import { policiesRawOwnerFields } from './fields.mjs';

/** True when the table's policy intent is org-membership (AuthzEntityMembership). */
export function isOrgScopedTable(table) {
  const policy = table?.policy;
  return policy === 'org-membership' || policy === 'member-owner';
}

/**
 * True when the create needs the `ownerId` admin-token const. Owner / public-read+owner-write
 * always do; MEMBER-OWNER does too (SG-C — it needs owner_id AND entity_id); and any table with
 * policies_raw owner entity_fields does (SG-2). Drives whether scopingSeams emits the TokenManager
 * ownerId const alongside (for member-owner) the useActiveOrg() org const.
 */
export function needsOwnerId(table) {
  const policy = table?.policy;
  return (
    policy === 'owner' ||
    policy === 'public-read+owner-write' ||
    policy === 'member-owner' ||
    policiesRawOwnerFields(table).length > 0
  );
}

/**
 * The per-policy SCOPING seams the quick-add reads, derived from the table's policy intent
 * (NOT its name). Three coupled seams fill the entity-page template:
 *   • scopingImport  → the __SCOPING_IMPORT__ seam (the lone scoping dependency import):
 *       org-membership/member-owner → `useActiveOrg` from the org-context (the active-org
 *         SINGLE SOURCE OF TRUTH — defaulted to the actor's owned org, updated by the
 *         OrgSwitcher). This is the fix for the b2b silent create: entity_id is the ACTIVE
 *         org (multi-org safe), not a token-userId guess.
 *       everything else → `TokenManager` (the admin-token owner-id source for DataDirectOwner).
 *   • ownerConst     → the __OWNER_CONST__ seam (the scoping-id const(s) the create reads):
 *       org-membership      → `const { orgId: activeOrgId } = useActiveOrg();`
 *       member-owner (SG-C) → BOTH the activeOrg const AND the `ownerId` admin-token const (it
 *                             needs owner_id AND entity_id).
 *       owner/public/raw    → the `ownerId` admin-token const (UNCHANGED — byte-identical canary).
 *   • orgSubmitGuard → the __ORG_SUBMIT_GUARD__ seam (`|| !activeOrgId`), appended to BOTH the
 *       create handler's early-return AND the submit button's `disabled`, so an org-scoped
 *       create WAITS for a resolved active org (entity_id is NON-NULL) — empty string for any
 *       non-org table (so owner/public stay byte-identical).
 *   • detailedCreateDefaults → the __DETAILED_CREATE_DEFAULTS__ seam (a `defaultValues:` prop on
 *       the DETAILED-create DynamicFormCard push): `entityId: activeOrgId` for an org-scoped table,
 *       '' for any non-org table. This is the b2b detailed-create-FORM fix: DynamicFormCard hides
 *       `entity_id` (a SYSTEM field) so the schema-driven form can NEVER render/collect it, and the
 *       quick-add's `entityId: activeOrgId` spread lives only in the page's inline mutate — so the
 *       full-form "detailed create" sent NO entity_id and the AuthzEntityMembership WITH-CHECK
 *       NOT-NULL/RLS-rejected it (only quick-add worked). Passing the active org as a context
 *       defaultValue lets the card supply the non-null entity_id generically (the card merges any
 *       context default the create INPUT type accepts — see dynamic-form-card.tsx), with NO field
 *       hard-coding. Empty for owner/public so they stay byte-identical.
 *   • detailsGuard / detailsDisabled → the __DETAILS_GUARD__ + __DETAILS_DISABLED__ seams: for an
 *       org-scoped table an `if (!activeOrgId) return;` early-return inside openDetailedCreate AND a
 *       ` disabled={!activeOrgId}` on the "Details…" button, so the detailed create — like the
 *       quick-add — WAITS for a resolved active org (else the card opens with no entity_id to
 *       supply). BOTH collapse to '' for any non-org table (owner/public byte-identical: no guard
 *       line, no `disabled` attr on the Details button).
 * The const's leading line carries the template's own 2-space indent; continuation lines embed
 * it. GENERIC: composed from independent ORG and OWNER fragments off the table's policy intent,
 * so each tier reproduces the prior template EXACTLY where it always did (owner/public → owner
 * const only; org-membership → org const only) and ONLY member-owner gains the second const.
 */
export const ORG_SCOPING_IMPORT = "import { useActiveOrg } from '@/components/org-context';";
export const OWNER_SCOPING_IMPORT = "import { TokenManager } from '@/lib/auth/token-manager';";
export const ORG_OWNER_CONST = [
  '// Org-membership create scope. AuthzEntityMembership requires entity_id to be an org the',
  '  // signed-in user belongs to — the ACTIVE org. useActiveOrg() is the single source of truth:',
  '  // the OrgProvider defaults it to the actor\'s owned (personal) org and the OrgSwitcher updates',
  '  // it, so creates land in whatever org the user is acting in (multi-org safe), not a token guess.',
  '  const { orgId: activeOrgId } = useActiveOrg();',
].join('\n');
export const OWNER_ID_CONST = [
  '// Owner id for owner-scoped creates (DataDirectOwner). Unused keys are harmless —',
  '  // the generator only spreads what the policy needs (see the mutation body).',
  '  const ownerId =',
  "    (typeof window !== 'undefined' &&",
  "      TokenManager.getToken('admin').token?.userId) ||",
  "    '';",
].join('\n');
// The member-owner ownerId const (SG-C) — same value as OWNER_ID_CONST but a member-owner-specific
// comment; emitted AFTER the org const so the page reads activeOrg first, then ownerId.
export const MEMBER_OWNER_ID_CONST = [
  '// SG-C (member-owner create): AuthzMemberOwner needs BOTH owner_id AND entity_id; supply the',
  '  // actor id so the create passes + is author-scoped (the org const above gives entity_id).',
  '  const ownerId =',
  "    (typeof window !== 'undefined' &&",
  "      TokenManager.getToken('admin').token?.userId) ||",
  "    '';",
].join('\n');

// The DETAILED-create DynamicFormCard `defaultValues` prop fragment for an org-scoped table — the
// b2b detailed-create-FORM fix. Carries its OWN leading newline + the 8-space indent of the
// openDetailedCreate props object, so the empty (owner/public) case leaves no stray line. The card
// hides `entity_id` (SYSTEM field) from the form, so the active org is fed as a context default; the
// card merges any context default the create INPUT type accepts → the non-null entity_id lands.
export const ORG_DETAILED_CREATE_DEFAULTS = [
  '',
  '        // b2b detailed-create-FORM fix: DynamicFormCard hides entity_id (a SYSTEM field), so the',
  '        // full-form create could never collect it and AuthzEntityMembership rejected it. Feed the',
  '        // ACTIVE org as a context default — the card merges any default the create input accepts.',
  '        defaultValues: { entityId: activeOrgId },',
].join('\n');
// The openDetailedCreate early-return guard for an org-scoped table (its own leading newline +
// 4-space function-body indent). Owner/public → '' (no guard line; byte-identical).
export const ORG_DETAILS_GUARD = [
  '',
  '    // Wait for a resolved active org — the detailed-create card needs the non-null entity_id.',
  '    if (!activeOrgId) return;',
].join('\n');
// The `disabled` attr appended to the "Details…" button for an org-scoped table — gate it on the
// active org like the quick-add. Owner/public → '' (no `disabled` attr; byte-identical).
export const ORG_DETAILS_DISABLED = '\n              disabled={!activeOrgId}';

export function scopingSeams(table) {
  const wantsOrg = isOrgScopedTable(table);
  const wantsOwner = needsOwnerId(table);

  // member-owner — BOTH org + owner (SG-C). Emitted as a distinct shape so the two single-tier
  // paths below stay byte-identical to the prior template.
  if (wantsOrg && wantsOwner) {
    return {
      scopingImport: ORG_SCOPING_IMPORT + '\n' + OWNER_SCOPING_IMPORT,
      ownerConst: ORG_OWNER_CONST + '\n  ' + MEMBER_OWNER_ID_CONST,
      // member-owner needs BOTH a resolved active org (entity_id) AND the actor id (owner_id).
      orgSubmitGuard: ' || !activeOrgId || !ownerId',
      // Detailed-create supplies the active-org entity_id; owner_id is a (non-system) form field.
      detailedCreateDefaults: ORG_DETAILED_CREATE_DEFAULTS,
      detailsGuard: ORG_DETAILS_GUARD,
      detailsDisabled: ORG_DETAILS_DISABLED,
    };
  }
  // org-membership only — UNCHANGED quick-add seams; gains the detailed-create defaults/guard.
  if (wantsOrg) {
    return {
      scopingImport: ORG_SCOPING_IMPORT,
      ownerConst: ORG_OWNER_CONST,
      // entity_id is NON-NULL on AuthzEntityMembership tables — wait for a resolved active org.
      orgSubmitGuard: ' || !activeOrgId',
      detailedCreateDefaults: ORG_DETAILED_CREATE_DEFAULTS,
      detailsGuard: ORG_DETAILS_GUARD,
      detailsDisabled: ORG_DETAILS_DISABLED,
    };
  }
  // owner / public-read+owner-write / policies_raw owner — UNCHANGED (all detailed-create seams '').
  return {
    scopingImport: OWNER_SCOPING_IMPORT,
    ownerConst: OWNER_ID_CONST,
    orgSubmitGuard: '',
    detailedCreateDefaults: '',
    detailsGuard: '',
    detailsDisabled: '',
  };
}
