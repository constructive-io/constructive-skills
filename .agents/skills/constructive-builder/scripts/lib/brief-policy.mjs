/**
 * scripts/lib/brief-policy.mjs — the POLICY KERNEL: the intent → blueprint knowledge
 * maps the scaffolders share, plus brief validation and the module closure.
 *
 * Extracted VERBATIM from brief.mjs (§2–§7). GENERIC BY CONSTRUCTION — nothing here
 * hard-codes an app's `todos`/`email-password` as a value; the brief drives everything.
 *
 *   2. validateBrief(brief)  — legible, fail-fast validation of the brief shape.
 *   3. POLICY_INTENTS        — policy-intent  → { nodes[], policies[] } emitters.
 *   4. RESTRICT_MODIFIERS    — restrict tag    → extra fields + a restrictive policy.
 *   5. FEATURE_NODES         — feature tag     → a data-behavior node (+ field/fts).
 *   6. NODE_MODULE_DEPS      — node $type      → module deps it pulls into the closure.
 *   7. presetBaseModules / flowModules / computeModuleClosure — the module union.
 *
 * The maps below are the generator's CORE KNOWLEDGE. They emit the COMMON CASE as
 * explicit literal arrays; the long tail is reached via the brief's `nodes_raw` /
 * `policies_raw` escape hatches (passed through verbatim) and `// TODO: advanced`
 * seams the emitter writes. See:
 *   - constructive-blueprints/references/blueprint-definition-format.md (every key)
 *   - constructive-security/references/authz-types.md (the 20 Authz* shapes)
 *
 * ALL_CRUD and JUNCTION_POLICY_SHORTHAND live here (the policy kernel) and are
 * re-used by the blueprint-assembly module — keeping them here avoids a cycle
 * (blueprint depends on policy; the module closure also reads the shorthand).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════════════════════════════════
// 2. VALIDATION (legible, fail-fast)
// ════════════════════════════════════════════════════════════════════════════

const KNOWN_POLICIES = new Set([
  'owner',
  'org-membership',
  'member-owner',
  'org-hierarchy',
  'related-membership',
  'public-read+owner-write',
  'public-lookup',
]);
// Parent-derived / hierarchical access intents that are RECOGNIZED by name (so we can
// give actionable guidance) but are NOT yet mapped to a generated policy. A table that
// asks for one of these ABORTS with a pointer at the raw escape hatch — we deliberately
// do NOT infer hierarchy from FKs (that would false-positive on legit FLAT patterns like
// CRM contacts belongs-to companies). The author must opt in explicitly via policies_raw.
// (org-hierarchy and related-membership are NO LONGER here: both are now first-class
// intents — see POLICY_INTENTS — because the author opts in EXPLICITLY via the `policy`
// name + a required `policy_params` sub-map, so there is no FK-inference false-positive
// risk; the closure-table / parent-derived access is REQUESTED, not guessed. This set is
// kept as the seam for the NEXT hierarchical intent that arrives before it is mapped.)
const ABORT_POLICY_INTENTS = new Set([]);
const KNOWN_RESTRICTS = new Set(['temporal', 'read-only']);
const KNOWN_FEATURES = new Set([
  'soft-delete', 'slug', 'tags', 'jsonb', 'fts', 'publishable',
]);
const KNOWN_PRESETS = new Set([
  'auth:email', 'auth:email+magic', 'auth:sso', 'auth:passkey',
  'b2b', 'b2b:storage', 'full', 'minimal',
]);

class BriefError extends Error {}

function req(obj, keyPath, where) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || !(p in cur)) {
      throw new BriefError(`${where}: missing required key \`${keyPath}\``);
    }
    cur = cur[p];
  }
  return cur;
}

/** Validate the parsed brief, throwing a BriefError with a legible message. */
export function validateBrief(brief, where = 'brief') {
  if (!brief || typeof brief !== 'object') {
    throw new BriefError(`${where}: brief did not parse to a mapping`);
  }
  req(brief, 'app.id', where);
  req(brief, 'naming.db_name', where);
  const db = brief.naming.db_name;
  if (!/^[a-z][a-z0-9]*$/.test(db)) {
    throw new BriefError(`${where}: naming.db_name must be plain lowercase (no hyphens/underscores); got "${db}"`);
  }
  // modules.preset
  const preset = brief.modules?.preset;
  if (!preset) throw new BriefError(`${where}: missing required key \`modules.preset\` (e.g. auth:email | b2b | full | minimal)`);
  if (!KNOWN_PRESETS.has(preset)) {
    throw new BriefError(`${where}: unknown modules.preset "${preset}". Known: ${[...KNOWN_PRESETS].join(', ')}`);
  }
  // flows
  const flows = brief.flows ?? [];
  if (!Array.isArray(flows)) throw new BriefError(`${where}: \`flows\` must be a list`);
  // data_model.tables
  const tables = brief.data_model?.tables ?? [];
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new BriefError(`${where}: \`data_model.tables\` must be a non-empty list`);
  }
  const tableNames = new Set();
  for (const t of tables) {
    if (!t || typeof t !== 'object' || !t.name) {
      throw new BriefError(`${where}: every data_model.tables entry needs a \`name\``);
    }
    if (tableNames.has(t.name)) throw new BriefError(`${where}: duplicate table name "${t.name}"`);
    tableNames.add(t.name);
    const hasRaw = t.nodes_raw || t.policies_raw;
    if (!t.policy && !hasRaw) {
      throw new BriefError(`${where}: table "${t.name}" needs a \`policy\` intent (owner | org-membership | member-owner | public-read+owner-write | public-lookup) or a nodes_raw/policies_raw escape hatch`);
    }
    if (t.policy && ABORT_POLICY_INTENTS.has(t.policy)) {
      throw new BriefError(
        `${where}: table "${t.name}" uses policy "${t.policy}" — hierarchical / parent-derived access is not a mapped intent yet. ` +
        `Use policies_raw with AuthzRelatedEntityMembership or AuthzOrgHierarchy ` +
        `(see constructive-security/references/authz-types.md). ` +
        `Note: the org-membership intent gives FLAT own-entity access, NOT parent-derived.`
      );
    }
    if (t.policy && !KNOWN_POLICIES.has(t.policy)) {
      throw new BriefError(`${where}: table "${t.name}" has unknown policy "${t.policy}". Known: ${[...KNOWN_POLICIES].join(', ')} (or use nodes_raw/policies_raw)`);
    }
    // org-hierarchy REQUIRES a `policy_params` sub-map the emitter reads: a direction
    // (∈ up|down) and the user/anchor column the hierarchy closure joins on. Validate
    // here (fail-fast, legible) so a malformed brief never reaches the emitter — where a
    // missing direction/anchor would otherwise produce an AuthzOrgHierarchy missing its
    // required params and abort constructBlueprint deep in provision.
    if (t.policy === 'org-hierarchy') {
      const pp = t.policy_params;
      if (!pp || typeof pp !== 'object') {
        throw new BriefError(`${where}: table "${t.name}" uses policy "org-hierarchy" but is missing the required \`policy_params\` sub-map (e.g. policy_params: { direction: down, anchor_field: owner_id }).`);
      }
      if (pp.direction !== 'up' && pp.direction !== 'down') {
        throw new BriefError(`${where}: table "${t.name}" org-hierarchy policy_params.direction must be 'up' or 'down' (down=managers see subordinates' rows; up=subordinates see managers'); got ${JSON.stringify(pp.direction)}.`);
      }
      if (!pp.anchor_field || typeof pp.anchor_field !== 'string') {
        throw new BriefError(`${where}: table "${t.name}" org-hierarchy policy_params.anchor_field is required — the user column the closure table joins on (e.g. owner_id).`);
      }
      if (pp.max_depth != null && !Number.isInteger(pp.max_depth)) {
        throw new BriefError(`${where}: table "${t.name}" org-hierarchy policy_params.max_depth must be an integer when set; got ${JSON.stringify(pp.max_depth)}.`);
      }
    }
    // related-membership REQUIRES a `policy_params` sub-map the emitter reads: the FK column
    // ON THIS (child) table that joins up to a parent (entity_field), the parent/join table
    // NAME (join_table), and the entity/org column ON THE PARENT the SPRT matches against
    // (join_entity_field). All three are REQUIRED — parse.sql's AuthzRelatedEntityMembership
    // raises 'BAD_RLS_EXPRESSION entity_field' / 'obj_field' if entity_field / obj_field are
    // absent, so we fail fast + legibly here before the emitter. membership_type / join_schema
    // are OPTIONAL (the emitter defaults membership_type→2; obj_schema is supplied as the
    // logical 'app_public' sentinel and rewritten to the physical domain schema by the
    // blueprint engine, UNLESS join_schema pins an already-physical schema — see the
    // POLICY_INTENTS['related-membership'] emitter).
    if (t.policy === 'related-membership') {
      const pp = t.policy_params;
      if (!pp || typeof pp !== 'object') {
        throw new BriefError(`${where}: table "${t.name}" uses policy "related-membership" but is missing the required \`policy_params\` sub-map (e.g. policy_params: { entity_field: board_id, join_table: boards, join_entity_field: entity_id }).`);
      }
      if (!pp.entity_field || typeof pp.entity_field !== 'string') {
        throw new BriefError(`${where}: table "${t.name}" related-membership policy_params.entity_field is required — the FK column ON THIS table that joins up to the parent/join table (e.g. board_id).`);
      }
      if (!pp.join_table || typeof pp.join_table !== 'string') {
        throw new BriefError(`${where}: table "${t.name}" related-membership policy_params.join_table is required — the parent/join table NAME this row's FK points at (e.g. boards).`);
      }
      if (!pp.join_entity_field || typeof pp.join_entity_field !== 'string') {
        throw new BriefError(`${where}: table "${t.name}" related-membership policy_params.join_entity_field is required — the entity/org column ON THE PARENT the membership SPRT matches against (e.g. entity_id). parse.sql REQUIRES this (raises 'BAD_RLS_EXPRESSION obj_field' otherwise).`);
      }
      if (pp.join_schema != null && typeof pp.join_schema !== 'string') {
        throw new BriefError(`${where}: table "${t.name}" related-membership policy_params.join_schema must be a string when set (the ALREADY-PHYSICAL schema the join_table lives in; OMIT it for the common case — the emitter then supplies the 'app_public' sentinel, rewritten to the physical domain schema by the blueprint engine before construct).`);
      }
      if (pp.membership_type != null && !Number.isInteger(pp.membership_type)) {
        throw new BriefError(`${where}: table "${t.name}" related-membership policy_params.membership_type must be an integer when set (default 2 = org); got ${JSON.stringify(pp.membership_type)}.`);
      }
    }
    for (const r of t.restrict ?? []) {
      if (!KNOWN_RESTRICTS.has(r)) throw new BriefError(`${where}: table "${t.name}" has unknown restrict "${r}". Known: ${[...KNOWN_RESTRICTS].join(', ')}`);
    }
    for (const f of t.features ?? []) {
      if (!KNOWN_FEATURES.has(f)) throw new BriefError(`${where}: table "${t.name}" has unknown feature "${f}". Known: ${[...KNOWN_FEATURES].join(', ')}`);
    }
    for (const fld of t.fields ?? []) {
      if (!fld || typeof fld !== 'object' || !fld.name) throw new BriefError(`${where}: table "${t.name}" has a field with no \`name\``);
      if (fld.type !== undefined && (typeof fld.type !== 'object' || !fld.type.name)) {
        throw new BriefError(`${where}: table "${t.name}" field "${fld.name}" — \`type\` must be an OBJECT { name: … } (FIELD-TYPE-001), not a bare string`);
      }
    }
  }
  // org policies require b2b. org-hierarchy additionally needs the hierarchy_module
  // (folded into the closure below); the hierarchy closure table the policy reads is
  // part of the b2b/full surface, so the same b2b gate applies. related-membership
  // resolves through the memberships_module SPRT (a JOIN up to the parent's entity), so
  // it carries the SAME b2b gate as the FLAT org-membership intent.
  const needsB2b = tables.some((t) => ['org-membership', 'member-owner', 'org-hierarchy', 'related-membership'].includes(t.policy)) ||
    tables.some((t) => (t.restrict ?? []).includes('read-only'));
  const b2bPresets = new Set(['b2b', 'b2b:storage', 'full']);
  if (needsB2b && !b2bPresets.has(preset)) {
    throw new BriefError(`${where}: a table uses an org-scoped policy (org-membership / member-owner / org-hierarchy / related-membership / restrict: read-only) but modules.preset is "${preset}". Org policies REQUIRE a b2b preset (b2b | b2b:storage | full) — the memberships/hierarchy modules back them.`);
  }
  return brief;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. POLICY INTENTS → { nodes, policies }
// ════════════════════════════════════════════════════════════════════════════
// Each emitter returns the COMMON-CASE nodes[] and policies[] for one access
// model. The emitter receives the brief TABLE object (opts) so it can stay generic
// across any table — most emitters ignore it, but the parametric ones read it: e.g.
// org-hierarchy reads opts.policy_params (direction / anchor_field / …). DataId is
// prepended and DataTimestamps appended by the assembler (buildTableDefinition), NOT here.

export const ALL_CRUD = ['select', 'insert', 'update', 'delete'];

// The platform's reserved LOGICAL name for an app's per-tenant domain schema (the schema
// brief tables land in). The PHYSICAL schema name carries a runtime hash (e.g.
// `<db>-a1b2c3d4-app-public`) that is NOT knowable at brief-emit time — it is derived from
// (owner_id, db_name) only AT provision. So the related-membership emitter writes this stable
// logical sentinel as `obj_schema`, and the generic blueprint engine (templates/provision/
// blueprint.ts) REWRITES it to the resolved physical schema_name immediately before the
// (atomic) constructBlueprint call. Exported so the engine and any drift-check share one
// source of truth and never diverge on the literal. (An author who pins a real
// `policy_params.join_schema` bypasses the sentinel entirely; the engine leaves that verbatim.)
export const APP_DOMAIN_SCHEMA_SENTINEL = 'app_public';

export const POLICY_INTENTS = {
  // owner: each row belongs to one user; only the owner reads/writes it.
  owner() {
    return {
      nodes: ['DataDirectOwner'],
      policies: [{
        $type: 'AuthzDirectOwner',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: { entity_field: 'owner_id' },
      }],
    };
  },

  // org-membership: FLAT own-entity access — any member of the row's OWN owning org/team
  // can read+write it. This is NOT parent-derived: it authorizes on the entity_id ON the
  // row, never by walking an FK up to a parent's org. For "members of the parent's org can
  // see this child" (parent-derived / hierarchical) reach for policies_raw with
  // AuthzRelatedEntityMembership or AuthzOrgHierarchy instead — see ABORT_POLICY_INTENTS.
  'org-membership'() {
    return {
      nodes: ['DataEntityMembership'],
      policies: [{
        $type: 'AuthzEntityMembership',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: { entity_field: 'entity_id', membership_type: 2 },
      }],
    };
  },

  // member-owner: the row is BOTH user-owned AND org-scoped; only the author, and only within an
  // org they belong to, sees it. Maps to the platform's AuthzMemberOwner — a COMPOUND predicate
  // the SQL builder (ast_helpers.cpt_member_owner) ANDs from two halves:
  //     ( <owner_field> = current_user_id() )
  //   AND
  //     ( <entity_field> = ANY( SELECT <sprt>.<sel_field> FROM <sprt>
  //                              WHERE <sprt>.actor_id = current_user_id() ) )
  // Result: OWNER-who-is-a-MEMBER sees+writes; a NON-owner member of the same org is denied (half 1
  // false); a NON-member is denied (half 2 false). The 18-Authz catalog confirms owner_field +
  // entity_field are the REQUIRED params (AuthzMemberOwner.parameter_schema).
  //
  // DATA NODE — DataOwnershipInEntity. The compound policy dereferences BOTH owner_id AND entity_id
  // ON the row, so both columns must be materialized. DataOwnershipInEntity is the platform's
  // canonical owner_id+entity_id data module (secure-table-provision.md's Data-Modules table lists
  // it as exactly `owner_id, entity_id`), with the users FKs + indexes. A single-column node
  // (DataDirectOwner→owner_id only, or DataEntityMembership→entity_id only) would leave the other
  // column unmaterialized and abort constructBlueprint with `column "<col>" does not exist`. (The
  // assembler prepends DataId + appends DataTimestamps, so the full set is
  // [DataId, DataOwnershipInEntity, DataTimestamps].)
  //
  // NO PROJECTION FIX NEEDED (the contrast with related-membership). This is the FLAT-own-entity
  // shape: the row carries its OWN entity_id (an ORG id, materialized above), and the org-tier SPRT
  // also projects entity_id (org id), so the platform DEFAULT sel_field='entity_id' makes half 2
  // `row.entity_id = ANY(my org ids)` — correct. related-membership is the OTHER shape (the row's FK
  // is a PARENT PK, not an org id) and there the default deny-alls, which is why ONLY that intent
  // sets sel_obj:true+sel_field:'id'. member-owner must NOT carry those keys (it would mis-project).
  //
  // membership_type:2 selects the ORG sprt (get_sprt_alias maps 2 → org_sprt) — it is what scopes
  // half 2 to ORG membership; the rls_parser resolves sprt_table/sprt_schema from it at provision
  // time, so no physical literal is emitted here. b2b/full only (validateBrief gates the preset;
  // computeModuleClosure folds memberships_module — the org_sprt — into the closure).
  'member-owner'() {
    return {
      nodes: ['DataOwnershipInEntity'],
      policies: [{
        $type: 'AuthzMemberOwner',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: { owner_field: 'owner_id', entity_field: 'entity_id', membership_type: 2 },
      }],
    };
  },

  // org-hierarchy: visibility flows along the org HIERARCHY CLOSURE table. With
  // direction:down a manager sees rows owned by their subordinates; with direction:up a
  // subordinate sees rows owned by their managers. The AuthzOrgHierarchy predicate joins
  // the row's anchor (user) column ↔ the closure WITHIN the row's entity, so the row must
  // carry BOTH that user column AND entity_id — exactly what DataOwnershipInEntity
  // materializes (the platform's DataOwnershipInEntity doc explicitly names the
  // OrgHierarchy use-case: "a user owns a row (owner_id) within an entity (entity_id), and
  // managers above can see subordinate-owned records via the hierarchy closure table").
  // b2b/full only — the hierarchy_module backing the closure ships in the b2b base
  // (validateBrief gates the preset; computeModuleClosure folds hierarchy_module in).
  //
  // PARAMETRIC: reads opts.policy_params (the brief table's `policy_params` sub-map,
  // validated upstream). direction + anchor_field are required (validated); entity_field
  // defaults to the platform's own 'entity_id'; max_depth is forwarded only when set. No
  // app literal — every value is the brief's or the platform default. (opts is the brief
  // TABLE; `opts?.policy_params ?? {}` keeps it defensive if ever called without one.)
  'org-hierarchy'(opts = {}) {
    const pp = (opts && typeof opts === 'object' && opts.policy_params) ? opts.policy_params : {};
    const data = {
      direction: pp.direction,
      anchor_field: pp.anchor_field ?? 'owner_id',
      entity_field: pp.entity_field ?? 'entity_id',
    };
    if (pp.max_depth != null) data.max_depth = pp.max_depth;
    return {
      nodes: ['DataOwnershipInEntity'],
      policies: [{
        $type: 'AuthzOrgHierarchy',
        privileges: [...ALL_CRUD],
        permissive: true,
        data,
      }],
    };
  },

  // related-membership: PARENT-DERIVED access — a member of the org that owns the PARENT
  // (join) table can read+write THIS child row. The case org-membership's FLAT model
  // cannot express: instead of authorizing on an entity_id ON the row, the predicate JOINs
  // this row's FK (entity_field) UP to a parent table (obj_table) and matches the parent's
  // entity/org column (obj_field) against the actor's membership SPRT. Maps to the platform's
  // AuthzRelatedEntityMembership.
  //
  // NO DATA NODE. AuthzRelatedEntityMembership materializes nothing — it JOINs at RLS-eval
  // time. The protected table already carries its FK column (entity_field) from the brief's
  // RelationBelongsTo (and DataId+DataTimestamps from the assembler). So nodes:[] — emitting
  // a flat DataEntityMembership here would be the exact hallucination this intent avoids (a
  // child row has NO entity_id of its own; its access derives from the parent).
  //
  // PROJECTION — sel_obj:true + sel_field:'id' (THE deny-all fix). The platform compiles this
  // policy (ast_helpers.cpt_membership_by_join) to:
  //     <entity_field>  =  ANY ( SELECT <sel_obj? obj.sel_field : sprt.sel_field>
  //                                FROM <sprt> sprt JOIN <obj_schema.obj_table> obj
  //                                  ON sprt.sprt_join_field = obj.<obj_field>
  //                               WHERE sprt.actor_id = current_user )
  // For the canonical child-FK→parent-PK shape (cards.board_id → boards.id), entity_field is
  // the child FK (a PARENT PK value). The platform DEFAULT (sel_field='entity_id', sel_obj
  // unset) projects sprt.entity_id — an ORG id — so the outer compare is `board_pk = ANY(org_ids)`
  // → ALWAYS FALSE → a broken-CLOSED (deny-all) policy (confirmed live against the deployed
  // platform; see references/platform-gaps.md GAP-RELMEMBERSHIP-PROJ). The CORRECT projection
  // is the PARENT PK the FK references: sel_obj:true (project from the joined `obj` table, not
  // the SPRT) + sel_field:'id'. The JOIN itself (sprt.entity_id = obj.<obj_field>) still scopes
  // to boards owned by an org the actor belongs to, so the set is exactly "ids of boards in my
  // orgs" and `board_id = ANY(that set)` is correct. This mirrors the platform's OWN canonical
  // AuthzRelatedEntityMembership usage (services/.../policy.sql: every row carries
  // {"sel_obj":true,"sel_field":"id", …}). The platform SHOULD default this way for the
  // FK→parent-PK shape; until it does we set both params explicitly (consume-only workaround).
  //
  // obj_schema — REQUIRED, supplied as the logical APP_DOMAIN_SCHEMA_SENTINEL ('app_public').
  // OMITTING it does NOT auto-resolve: parse.sql's parse_policy_sprt_join_table only fills
  // obj_schema when an obj_table_id UUID is given; with just a bare obj_table NAME it keeps
  // obj_schema absent, the generated range_var references an unqualified relation, and
  // constructBlueprint ABORTS the whole (atomic) provision with 'relation "<parent>" does not
  // exist' (the SECOND blocker the prior run hit, beyond the projection). The parent's PHYSICAL
  // schema carries a runtime hash unknowable at emit (see APP_DOMAIN_SCHEMA_SENTINEL), so we
  // emit the brief-generic logical sentinel here and the generic blueprint engine rewrites it
  // to the resolved physical schema_name right before construct. NO app-/hash-specific literal
  // is ever hard-coded — the genericity contract holds. An author whose join table lives in a
  // DIFFERENT (already-physical) schema pins policy_params.join_schema; that value is emitted
  // verbatim and the engine leaves it untouched (it only rewrites the sentinel).
  //
  // PARAMETRIC: reads opts.policy_params (validated upstream). entity_field / join_table /
  // join_entity_field are required; membership_type defaults to the platform's org tier (2);
  // join_schema overrides the sentinel only when supplied. (opts is the brief TABLE;
  // `opts?.policy_params ?? {}` keeps it defensive if ever called without one.)
  'related-membership'(opts = {}) {
    const pp = (opts && typeof opts === 'object' && opts.policy_params) ? opts.policy_params : {};
    const data = {
      entity_field: pp.entity_field,
      obj_table: pp.join_table,
      obj_field: pp.join_entity_field,
      membership_type: pp.membership_type ?? 2,
      // PROJECT THE PARENT PK the FK references (not the SPRT's entity_id) — else deny-all.
      sel_obj: true,
      sel_field: 'id',
      // Logical sentinel → rewritten to the physical domain schema by the blueprint engine.
      // An explicit policy_params.join_schema (already-physical) wins and is left untouched.
      obj_schema: pp.join_schema != null ? pp.join_schema : APP_DOMAIN_SCHEMA_SENTINEL,
    };
    return {
      nodes: [],
      policies: [{
        $type: 'AuthzRelatedEntityMembership',
        privileges: [...ALL_CRUD],
        permissive: true,
        data,
      }],
    };
  },

  // public-read+owner-write: published rows readable by anyone authenticated;
  // only the owner can create/edit/unpublish. The two-policy stack.
  'public-read+owner-write'() {
    return {
      nodes: ['DataDirectOwner', 'DataPublishable'],
      policies: [
        {
          $type: 'AuthzDirectOwner',
          privileges: [...ALL_CRUD],
          permissive: true,
          data: { entity_field: 'owner_id' },
        },
        {
          $type: 'AuthzPublishable',
          privileges: ['select'],
          permissive: true,
          data: { is_published_field: 'is_published', published_at_field: 'published_at' },
        },
      ],
    };
  },

  // public-lookup: every authenticated user can read AND WRITE (no ownership).
  // This is authenticated read+write, NOT public-read.
  'public-lookup'() {
    return {
      nodes: [],
      policies: [{
        $type: 'AuthzAllowAll',
        privileges: [...ALL_CRUD],
        permissive: true,
        data: {},
      }],
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 4. RESTRICT MODIFIERS → extra fields + a RESTRICTIVE policy (ANDed)
// ════════════════════════════════════════════════════════════════════════════
// Each returns { fields?, nodes?, policies } to splice onto the table. The
// policy is permissive:false so PostgreSQL ANDs it with the permissive base.

export const RESTRICT_MODIFIERS = {
  temporal() {
    return {
      fields: [
        { name: 'valid_from', type: { name: 'timestamptz' } },
        { name: 'valid_until', type: { name: 'timestamptz' } },
      ],
      policies: [{
        $type: 'AuthzTemporal',
        privileges: [...ALL_CRUD],
        permissive: false,
        data: { valid_from_field: 'valid_from', valid_until_field: 'valid_until' },
      }],
    };
  },

  'read-only'() {
    return {
      policies: [{
        $type: 'AuthzNotReadOnly',
        privileges: ['insert', 'update', 'delete'],
        permissive: false,
        data: { entity_field: 'entity_id', membership_type: 2 },
      }],
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 5. FEATURE TAGS → a data-behavior node (+ implicit field / fts entry)
// ════════════════════════════════════════════════════════════════════════════
// Each returns { node?, field?, fts? }. `fts` is a top-level full_text_search[]
// entry the assembler hoists (it spans named text fields, not a node).

/**
 * Resolve the DataSlug `source_field_name` for a table — the text column the slug
 * trigger derives its value from. Hard-coding `'title'` ABORTS constructBlueprint on
 * any sluggable table without a `title` column ("source field \"title\" not found").
 * We DERIVE it deterministically, in priority order:
 *   1. a field conventionally named `title` or `name` (the common label columns),
 *   2. else the FIRST required, non-slug text field (the table's likely label),
 *   3. else the first non-slug text field,
 *   4. else fall back to `'title'` (nothing resolved — preserves the historical
 *      default so a brief that relies on a downstream/raw `title` still emits it).
 * A field is "text" when it has no explicit type (text is the assembler default) or
 * its type.name is `text`/`citext`. The `slug` helper column itself is never chosen.
 * Order #1 wins even when the title/name field is not the first text field, matching
 * the platform convention that those names ARE the label.
 */
function deriveSlugSource(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const isText = (f) => !f || !f.type || f.type.name === 'text' || f.type.name === 'citext';
  const sluggable = (f) => f && f.name && f.name !== 'slug' && isText(f);
  // 1. conventional label column (title preferred over name when both exist)
  const titled = list.find((f) => sluggable(f) && f.name === 'title');
  if (titled) return titled.name;
  const named = list.find((f) => sluggable(f) && f.name === 'name');
  if (named) return named.name;
  // 2. first required non-slug text field
  const requiredText = list.find((f) => sluggable(f) && f.required);
  if (requiredText) return requiredText.name;
  // 3. first non-slug text field
  const anyText = list.find((f) => sluggable(f));
  if (anyText) return anyText.name;
  // 4. nothing resolved — historical default
  return 'title';
}

export const FEATURE_NODES = {
  'soft-delete'() { return { node: 'DataSoftDelete' }; },
  // slug: a `slug` text field + DataSlug trigger filling it from a derived source.
  // `opts.fields` is the brief table's declared fields so the source column is
  // resolved per-table (see deriveSlugSource) instead of hard-coded to 'title'.
  slug(opts = {}) {
    return {
      node: { $type: 'DataSlug', data: { field_name: 'slug', source_field_name: deriveSlugSource(opts.fields) } },
      field: { name: 'slug', type: { name: 'text' } },
    };
  },
  tags() { return { node: { $type: 'DataTags', data: { field_name: 'tags' } } }; },
  jsonb() { return { node: { $type: 'DataJsonb', data: { field_name: 'data' } } }; },
  publishable() { return { node: 'DataPublishable' }; },
  // fts is realized as a top-level full_text_search[] entry; the assembler fills
  // field_names from the table's text fields.
  fts() { return { fts: true }; },
};

// ════════════════════════════════════════════════════════════════════════════
// 6. NODE → MODULE DEPENDENCY CLOSURE
// ════════════════════════════════════════════════════════════════════════════
// A handful of nodes require their backing module to be in the provision list.
// Each value is a list of module entries (native tuples) to fold into the union.
// Most data/owner/membership nodes are satisfied by the auth/b2b preset modules
// the flows already carry, so they are NOT listed here.

export const NODE_MODULE_DEPS = {
  DataRealtime: ['realtime_module'],
  DataI18n: ['i18n_module'],
  LimitCounter: [['limits_module', { scope: 'app' }]],
  LimitFeatureFlag: [['limits_module', { scope: 'app' }]],
  SearchVector: ['ai_module'],
  ProcessImageEmbedding: ['ai_module'],
};

// A relation may request org-scoped junction security with the table-level `policy`
// vocabulary via a first-class `junction_policy:` shorthand (mirrors the table `policy`
// intent), instead of the nested `data.policy_type`/`policy_data`. Maps the shorthand to
// the resolved { policy_type, policy_data } the lifter then drives through Pattern 3.
//
// Lives in the policy kernel (not the blueprint module) because computeModuleClosure ALSO
// reads it (to fold the b2b base in for an org-scoped M2M junction) — keeping it here lets
// both the module closure and the blueprint assembly import it without a cycle.
export const JUNCTION_POLICY_SHORTHAND = {
  'org-membership': { policy_type: 'AuthzEntityMembership', policy_data: { entity_field: 'entity_id', membership_type: 2 } },
  'member-owner': { policy_type: 'AuthzMemberOwner', policy_data: { owner_field: 'owner_id', entity_field: 'entity_id', membership_type: 2 } },
};

// ════════════════════════════════════════════════════════════════════════════
// 7. MODULE CLOSURE — union(preset base, flow modules, node deps, relation deps)
// ════════════════════════════════════════════════════════════════════════════

let _flowsCache = null;
/** Load references/flows.json (the module-union source of truth). */
export function loadFlows() {
  if (_flowsCache) return _flowsCache;
  // scripts/lib → ../../references/flows.json
  const flowsPath = process.env.FLOWS_JSON ||
    path.resolve(__dirname, '..', '..', 'references', 'flows.json');
  const data = JSON.parse(fs.readFileSync(flowsPath, 'utf8'));
  _flowsCache = Array.isArray(data) ? data : (data.flows ?? []);
  return _flowsCache;
}

/** Look up one flow's backend.modules (native tuples) by flow id. */
export function flowModules(flowId) {
  const flows = loadFlows();
  const f = flows.find((x) => (x.id || x.slug) === flowId);
  if (!f) {
    throw new BriefError(`unknown flow "${flowId}" — not in references/flows.json. Known: ${flows.map((x) => x.id).join(', ')}`);
  }
  return f.backend?.modules ?? [];
}

/**
 * Base modules for a preset, independent of flows. Because every flow already
 * embeds its preset's full module set, we derive each preset's base list from a
 * representative flow that ships under it — so the union stays correct even when
 * the chosen flows don't happen to include one carrying the full preset surface.
 * `minimal` provisions no auth modules. `extra` modules append on top.
 */
const PRESET_REPRESENTATIVE_FLOW = {
  'auth:email': 'email-password',
  'auth:email+magic': 'email-password',
  'auth:sso': 'social-oauth',
  'auth:passkey': 'connected-accounts',
  'b2b': 'organization',
  'b2b:storage': 'organization',
  'full': 'organization',
};

export function presetBaseModules(preset) {
  if (preset === 'minimal') return [];
  const rep = PRESET_REPRESENTATIVE_FLOW[preset];
  if (!rep) return [];
  try {
    return flowModules(rep);
  } catch {
    return [];
  }
}

/** Canonical string key for a module entry (string or [name, {scope}] tuple). */
function moduleKey(m) {
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) {
    const [name, opts] = m;
    const scope = opts && typeof opts === 'object' ? opts.scope : undefined;
    return scope ? `${name}:${scope}` : String(name);
  }
  return JSON.stringify(m);
}

/** Expand a brief `extra:` entry ('name' or 'name:scope') to a native module. */
function expandExtra(entry) {
  if (typeof entry !== 'string') return entry;
  const idx = entry.indexOf(':');
  if (idx === -1) return entry;
  const name = entry.slice(0, idx);
  const scope = entry.slice(idx + 1);
  return [name, { scope }];
}

/**
 * Compute the full module closure for a brief.
 *   union( presetBaseModules(preset),
 *          each chosen flow's backend.modules,
 *          node→module deps for every node across all tables,
 *          relation closure (M2M membership junction → b2b base),
 *          modules.extra )
 * De-duplicated by canonical key; FIRST occurrence wins for ordering so the
 * preset/flow order is preserved (the golden canary depends on this ordering).
 */
export function computeModuleClosure(brief, tableDefs) {
  const preset = brief.modules?.preset ?? 'auth:email';
  const ordered = [];
  const seen = new Set();
  const add = (m) => {
    const k = moduleKey(m);
    if (!seen.has(k)) { seen.add(k); ordered.push(m); }
  };

  // (a) preset base
  for (const m of presetBaseModules(preset)) add(m);
  // (b) each chosen flow
  for (const fid of brief.flows ?? []) {
    for (const m of flowModules(fid)) add(m);
  }
  // (c) node → module deps across every table
  for (const t of tableDefs ?? []) {
    for (const node of t.nodes ?? []) {
      const type = typeof node === 'string' ? node : node?.$type;
      for (const dep of NODE_MODULE_DEPS[type] ?? []) add(dep);
    }
  }
  // (d) relation closure — an org-scoped M2M junction pulls the b2b base in.
  // The junction's policy intent may live nested (data.policy_type — the brief grammar),
  // as the `junction_policy:` shorthand, OR flat (policies[].$type — the SDK shape
  // liftManyToManySecurity emits, which an advanced author can also write by hand). Read
  // ALL THREE so the closure stays correct regardless of which form the brief used.
  const b2bBase = presetBaseModules('b2b');
  const isOrgJunctionPolicy = (t) => t === 'AuthzEntityMembership' || t === 'AuthzMemberOwner';
  for (const r of brief.data_model?.relations ?? []) {
    if (r?.$type !== 'RelationManyToMany') continue;
    const nested = r.data?.policy_type;
    const short = (typeof r.junction_policy === 'string')
      ? JUNCTION_POLICY_SHORTHAND[r.junction_policy]?.policy_type
      : undefined;
    const flat = Array.isArray(r.policies) ? r.policies.map((p) => p?.$type) : [];
    if (isOrgJunctionPolicy(nested) || isOrgJunctionPolicy(short) || flat.some(isOrgJunctionPolicy)) {
      for (const m of b2bBase) add(m);
    }
  }
  // (d2) policy closure — a table with `policy: org-hierarchy` needs the hierarchy
  // closure table the AuthzOrgHierarchy predicate reads. parse.sql's
  // parse_policy_hierarchy raises 'NOT_FOUND (hierarchy_module …)' if the module is
  // absent, so we fold it in EXPLICITLY here. The b2b/full preset base already carries
  // hierarchy_module — but as a SCOPED tuple (`['hierarchy_module', { scope: 'org' }]`,
  // key `hierarchy_module:org`), so a bare `add('hierarchy_module')` would NOT de-dup
  // against it (different key) and would emit a spurious second, unscoped entry. Guard by
  // module NAME instead: only fold in the bare module when NO hierarchy_module entry (under
  // ANY scope) is already present. So this is a true no-op in the common b2b case, yet still
  // defends the edge where a preset base ever ships WITHOUT any hierarchy_module — where the
  // table would otherwise abort at provision. Derived from the brief's own policy intent (no
  // app literal) — the genericity contract holds.
  const wantsHierarchy = (brief.data_model?.tables ?? []).some((t) => t?.policy === 'org-hierarchy');
  const hasHierarchyModule = ordered.some((m) => (Array.isArray(m) ? m[0] : m) === 'hierarchy_module');
  if (wantsHierarchy && !hasHierarchyModule) {
    add('hierarchy_module');
  }
  // (e) explicit extras
  for (const e of brief.modules?.extra ?? []) add(expandExtra(e));

  return ordered;
}

export { BriefError };
