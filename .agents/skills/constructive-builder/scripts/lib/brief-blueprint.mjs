/**
 * scripts/lib/brief-blueprint.mjs — BLUEPRINT ASSEMBLY (§8).
 *
 * Extracted VERBATIM from brief.mjs. Assembles the BlueprintDefinition (tables +
 * relations) from a parsed brief, driving the policy-kernel knowledge maps:
 *   - buildTableDefinition  — one BlueprintTable (nodes/fields/policies/grants/fts)
 *   - buildRelation         — one relation entry (M:N nested→flat security lift)
 *   - buildBlueprintDefinition — the whole { tables, relations, full_text_searches? }
 *
 * Depends on the policy kernel (brief-policy.mjs) for the intent emitters
 * (POLICY_INTENTS / RESTRICT_MODIFIERS / FEATURE_NODES), the shared ALL_CRUD /
 * JUNCTION_POLICY_SHORTHAND, and BriefError. DataId is prepended + DataTimestamps
 * appended HERE (not in the emitters).
 */

import {
  POLICY_INTENTS,
  RESTRICT_MODIFIERS,
  FEATURE_NODES,
  ALL_CRUD,
  JUNCTION_POLICY_SHORTHAND,
  BriefError,
} from './brief-policy.mjs';

const DEFAULT_GRANTS = [{
  roles: ['authenticated'],
  privileges: [['select', '*'], ['insert', '*'], ['update', '*'], ['delete', '*']],
}];

/**
 * Build ONE BlueprintTable from a brief table spec.
 *
 *   nodes  = DataId  +  policy-intent nodes  +  restrict nodes  +  feature nodes
 *            +  { $type:'DataTimestamps', data:{ include_id:false } }   (always last)
 *   fields = brief fields (object-form type/default)  +  feature/restrict fields
 *   policies = policy-intent policies  +  restrict policies  (restrictive ANDed)
 *   grants = object-form full-CRUD for authenticated  (or a feature override)
 *
 * Returns { table, fts } where fts (or null) is a top-level full_text_search entry.
 * `nodes_raw` / `policies_raw` from the brief are spliced in verbatim (escape hatch).
 */
/** Discriminator for a node entry (string shorthand or { $type } object). */
function nodeType(n) {
  return typeof n === 'string' ? n : n?.$type;
}

export function buildTableDefinition(t) {
  // Composite primary keys are parsed but have no policy/data intent mapping yet — the
  // generator would otherwise SILENTLY drop the request and emit a normal surrogate
  // DataId, shipping a different key than the author asked for. ABORT loudly instead.
  if (t.use_composite_key || t.composite_key) {
    throw new BriefError(
      `table "${t.name}": composite primary keys are not a supported policy/data intent yet. ` +
      `Define the key explicitly via nodes_raw (DataCompositeField/DataId shape), ` +
      `or use a surrogate id plus a unique_constraints entry.`
    );
  }

  // Nodes are de-duplicated by $type (first occurrence wins) so a feature/restrict
  // that re-adds a node already supplied by the policy intent — e.g.
  // public-read+owner-write already brings DataPublishable, and `features:
  // [publishable]` would otherwise add it again — collapses cleanly.
  const nodes = [];
  const nodeSeen = new Set();
  const addNode = (n) => {
    const ty = nodeType(n);
    if (ty === 'DataTimestamps') return; // appended last, separately
    if (ty && nodeSeen.has(ty)) return;
    if (ty) nodeSeen.add(ty);
    nodes.push(n);
  };

  // Fields: brief-declared fields take precedence and are emitted FIRST (in brief
  // order). Feature/restrict fields are only added when the brief did not already
  // declare a field of that name (so `features:[slug]` + an explicit `slug` field
  // collapses to one).
  const fields = [];
  const fieldSeen = new Set();
  const addField = (f) => {
    if (fieldSeen.has(f.name)) return;
    fieldSeen.add(f.name);
    fields.push(f);
  };

  const policies = [];
  const featureFields = []; // feature/restrict-contributed fields, applied after brief fields
  let fts = null;

  addNode('DataId');

  // policy intent → nodes + policies. The brief TABLE is passed so a PARAMETRIC intent
  // (org-hierarchy) can read its `policy_params`; the non-parametric emitters ignore it.
  if (t.policy) {
    const { nodes: pn, policies: pp } = POLICY_INTENTS[t.policy](t);
    for (const n of pn) addNode(n);
    policies.push(...pp);
  }

  // restrict modifiers (RESTRICTIVE — ANDed). Fields deferred to featureFields.
  for (const r of t.restrict ?? []) {
    const out = RESTRICT_MODIFIERS[r]();
    for (const n of out.nodes ?? []) addNode(n);
    for (const f of out.fields ?? []) featureFields.push(f);
    if (out.policies) policies.push(...out.policies);
  }

  // feature nodes. Fields deferred to featureFields so brief fields win ordering.
  // The opts bag carries the brief's declared fields so a feature can derive a
  // per-table source column (e.g. slug → deriveSlugSource); emitters that need no
  // context simply ignore it.
  let wantsFts = false;
  for (const f of t.features ?? []) {
    const out = FEATURE_NODES[f]({ fields: t.fields ?? [] });
    if (out.node) addNode(out.node);
    if (out.field) featureFields.push(out.field);
    if (out.fts) wantsFts = true;
  }

  // DAY-2 NOT-NULL-BACKFILL FIX (generic). When a table carries a DataPublishable node
  // (from `policy: public-read+owner-write` or `features: [publishable]`), the platform's
  // data_publishable generator creates the publish-state columns as `is_published boolean
  // NOT NULL default false` + `published_at timestamptz`. Adding a NOT-NULL column to a
  // table that ALREADY holds rows ABORTS the whole (atomic) constructBlueprint with
  //   column "<is_published_field>" of relation "<t>" contains null values
  // because the platform sequences ADD COLUMN (nullable, no default) → SET NOT NULL → SET
  // DEFAULT (the default lands AFTER the NOT-NULL check, so it never backfills existing
  // rows; root cause: constructive-db after_insert_field_trigger ordering — see the
  // escalation in references/platform-gaps.md). This makes ANY day-2 "make this table
  // publishable" change impossible on a populated table, NOT just recipes.
  //
  // THE GENERIC FIX: pre-materialize the publish-state columns OURSELVES as NULLABLE
  // (with default:false on is_published) BEFORE the platform's generator runs. The
  // platform's data_publishable.sql is idempotent — it creates each field only `IF
  // existing_field_id IS NULL`, otherwise it just refreshes the description — so when the
  // field already exists it SKIPS the create_field call entirely (and with it the NOT-NULL
  // alteration). The column is then nullable, no SET-NOT-NULL runs, and the provision
  // succeeds whether the table is fresh (0 rows) or populated (day-2). NULL is the safe
  // unpublished state: AuthzPublishable's predicate is `is_published = true AND …`, which
  // is FALSE for NULL → a NULL/pre-existing row is treated as NOT published (correct
  // default). default:false keeps NEW inserts at false exactly like the NOT-NULL shape.
  //
  // The field NAMES are derived from the table's emitted AuthzPublishable policy data
  // (is_published_field / published_at_field), falling back to the platform defaults — so
  // this stays generic if the policy ever parameterizes the column names, and never
  // hard-codes 'is_published'/'published_at'. These go through featureFields, so an
  // author who explicitly declared either column in the brief still wins (addField dedups
  // by name). NB: a fresh-table contract change — the column is nullable rather than
  // NOT NULL — accepted as the only skill-side way to make day-2 publishable adds work;
  // the durable NOT-NULL-with-backfill fix is the upstream platform escalation.
  if (nodeSeen.has('DataPublishable')) {
    const pubPolicy = policies.find((p) => p && p.$type === 'AuthzPublishable');
    const pubData = (pubPolicy && pubPolicy.data && typeof pubPolicy.data === 'object') ? pubPolicy.data : {};
    const isPublishedField = pubData.is_published_field || 'is_published';
    const publishedAtField = pubData.published_at_field || 'published_at';
    featureFields.push({ name: isPublishedField, type: { name: 'boolean' }, default: { value: false } });
    featureFields.push({ name: publishedAtField, type: { name: 'timestamptz' } });
  }

  // brief-declared custom fields FIRST (object-form type/default → blueprint field)
  for (const fld of t.fields ?? []) {
    const out = { name: fld.name, type: fld.type ?? { name: 'text' } };
    if (fld.required) out.is_required = true;
    if (fld.default !== undefined) out.default = fld.default;
    if (fld.description) out.description = fld.description;
    if (fld.index) out.index = fld.index;
    addField(out);
  }
  // then any feature/restrict field the brief did not already declare
  for (const f of featureFields) addField(f);

  // nodes_raw / policies_raw escape hatches (verbatim passthrough)
  if (Array.isArray(t.nodes_raw)) for (const n of t.nodes_raw) addNode(n);
  if (Array.isArray(t.policies_raw)) policies.push(...t.policies_raw);

  // DataTimestamps is ALWAYS the last node.
  nodes.push({ $type: 'DataTimestamps', data: { include_id: false } });

  // fts realized as a top-level full_text_searches[] entry over the table's text
  // fields (skip the slug helper column). Shape is the platform's
  // BlueprintFullTextSearch: { table_name, field, sources[{ field, weight, lang }] }
  // — a tsvector column named `search` fed by the weighted source columns. The
  // engine reads `definition.full_text_searches` (plural).
  //
  // CRITICAL: the live provision_full_text_search procedure only RESOLVES an
  // existing tsvector field; it does NOT create one. So we must MATERIALIZE the
  // `search` tsvector COLUMN on the table here — otherwise constructBlueprint
  // aborts with 'tsvector field "search" not found' and the whole blueprint rolls
  // back. We add the column FIRST (deduped via addField in case the brief already
  // declared a `search` field), then derive sources from the table's text columns.
  // The sources filter (`type.name === 'text' && name !== 'slug'`) naturally
  // excludes this tsvector self-column (it is not 'text'), so it never feeds itself.
  if (wantsFts) {
    addField({ name: 'search', type: { name: 'tsvector' } });
    const sources = fields
      .filter((f) => f.type?.name === 'text' && f.name !== 'slug')
      .map((f) => ({ field: f.name, weight: 'A', lang: 'english' }));
    fts = { table_name: t.name, field: 'search', sources };
  }

  const table = {
    ref: t.name,
    table_name: t.name,
    nodes,
    fields,
    grants: t.grants ?? DEFAULT_GRANTS,
    use_rls: true,
    policies,
  };
  if (t.unique_constraints) table.unique_constraints = t.unique_constraints;

  return { table, fts };
}

// Map a human-readable FK delete action to the single-char enum the platform
// RelationBelongsTo.parameter_schema stores in character(1). The brief speaks the
// readable form ('SET NULL'); constructBlueprint needs 'n' or it dies with
// "value too long for character(1)". Already-coded single chars pass through.
const DELETE_ACTION_ENUM = {
  'SET NULL': 'n',
  CASCADE: 'c',
  RESTRICT: 'r',
  'SET DEFAULT': 'd',
  'NO ACTION': 'a',
};
const DELETE_ACTION_CODES = new Set(['c', 'r', 'n', 'd', 'a']);

function codeDeleteAction(v) {
  if (v == null) return v;
  const s = String(v).trim();
  if (DELETE_ACTION_CODES.has(s.toLowerCase())) return s.toLowerCase();
  const mapped = DELETE_ACTION_ENUM[s.toUpperCase()];
  if (mapped) return mapped;
  throw new BriefError(
    `relation delete_action '${v}' is not a recognized action ` +
    `(expected one of SET NULL, CASCADE, RESTRICT, SET DEFAULT, NO ACTION, or a coded n/c/r/d/a)`
  );
}

// ── M:N junction default node set ────────────────────────────────────────────
// A SURROGATE-keyed junction (the common case) gets a DataId PK (the platform's
// documented "use nodes with DataId for UUID PK" path) + DataTimestamps, matching
// every other table the generator emits.
const JUNCTION_DEFAULT_NODES = [
  { $type: 'DataId', data: {} },
  { $type: 'DataTimestamps', data: { include_id: false } },
];

// ── M:N junction COMPOSITE-keyed default node set ────────────────────────────
// use_composite_key:true is a first-class RelationManyToMany param: the trigger
// builds the PK from the junction's TWO FK columns, so the table's identity is the
// (source_fk, target_fk) pair — NO surrogate UUID. The platform contract is explicit
// that this is "mutually exclusive with nodes containing DataId" (node-type-registry
// RelationManyToMany.parameter_schema): a DataId here would add a SECOND, conflicting
// PK and abort provision ("multiple primary keys for table … are not allowed"). So a
// composite junction's default node set OMITS DataId and keeps only DataTimestamps
// (created-at/updated-at columns are orthogonal to the key). DataTimestamps already
// carries include_id:false, so it never re-introduces an id. The two FK columns
// themselves are added by the RelationManyToMany trigger, not by a node here.
const JUNCTION_COMPOSITE_KEY_NODES = [
  { $type: 'DataTimestamps', data: { include_id: false } },
];

/** Does a node set contain a DataId (the surrogate-PK node)? */
function nodesContainDataId(nodes) {
  return (nodes ?? []).some((n) => nodeType(n) === 'DataId');
}

// ── Pattern-3 materializing node set (org-scoped M:N junction) ────────────────
// THE FIX for the silent AuthzAllowAll coercion (GAP-1d, now CLOSED via Pattern 3).
// An org-scoped junction policy (AuthzEntityMembership / AuthzMemberOwner) dereferences
// an ownership COLUMN (entity_id, +owner_id) that a pure-FK DataId junction never carries.
// Pattern 3 (the platform's own constructive-db-relations-security skill) MATERIALIZES that
// column on the junction by forwarding a DATA node to secure_table_provision BEFORE the
// policy applies. The platform's RelationManyToMany.parameter_schema forwards the relation's
// top-level `nodes`/`grants`/`policies` to secure_table_provision verbatim (Wave-2 GAP-1d
// confirmation), so emitting the DATA node here is the real per-org fix — NOT a coercion.
//
// Shapes are byte-identical to Pattern 3 in constructive-db-relations-security/SKILL.md:
//   DataEntityMembership → {entity_field_name:'entity_id', include_id:false, include_user_fk:true}
//   DataOwnershipInEntity → {owner_field_name:'owner_id', entity_field_name:'entity_id',
//                            include_id:false, include_user_fk:true}
// include_id:false — the junction's two FK columns (composite-or-surrogate PK) ARE the
// identity, so the DATA node must NOT add its own UUID id (Pattern 3 uses include_id:false).
// include_user_fk:true — entity_id FKs to the users-table-shaped entity ref (Pattern 3 default).
// Keyed by the Authz* policy type the junction requested → the materializing node it needs.
const JUNCTION_MATERIALIZING_NODES = {
  AuthzEntityMembership: [
    { $type: 'DataEntityMembership', data: { entity_field_name: 'entity_id', include_id: false, include_user_fk: true } },
  ],
  AuthzMemberOwner: [
    { $type: 'DataOwnershipInEntity', data: { owner_field_name: 'owner_id', entity_field_name: 'entity_id', include_id: false, include_user_fk: true } },
  ],
};

// Authz policy types whose RLS predicate dereferences an OWNERSHIP COLUMN on the
// table they protect: AuthzEntityMembership/AuthzNotReadOnly read `entity_id`,
// AuthzMemberOwner reads `owner_id`+`entity_id`, AuthzDirectOwner reads `owner_id`.
// On a parent table those columns are materialized by the policy-paired DATA node
// (DataEntityMembership→entity_id, DataOwnershipInEntity→owner_id+entity_id,
// DataDirectOwner→owner_id). A pure-FK junction carries only DataId (its two FK
// columns + a PK), so NONE of these columns exist on it — applying such a policy
// makes constructBlueprint abort the WHOLE provision with `column "<col>" does not
// exist` (it never even creates the parent tables). The columns each type needs:
const POLICY_OWNERSHIP_COLUMNS = {
  AuthzEntityMembership: ['entity_id'],
  AuthzNotReadOnly: ['entity_id'],
  AuthzMemberOwner: ['owner_id', 'entity_id'],
  AuthzDirectOwner: ['owner_id'],
};

// The DATA nodes that materialize each ownership column on a junction (so a junction
// that DOES carry one — an advanced author may add DataEntityMembership to its nodes —
// keeps the parent-matching policy instead of being coerced).
const NODE_PROVIDED_COLUMNS = {
  DataDirectOwner: ['owner_id'],
  DataEntityMembership: ['entity_id'],
  DataOwnershipInEntity: ['owner_id', 'entity_id'],
};

/** Columns the junction's node set actually materializes (union over its DATA nodes).
 *  (nodeType — the string|object node discriminator — is defined once above.) */
function columnsFromNodes(nodes) {
  const cols = new Set();
  for (const n of nodes ?? []) {
    for (const c of NODE_PROVIDED_COLUMNS[nodeType(n)] ?? []) cols.add(c);
  }
  return cols;
}

// A junction that secures to its parents' access model uses the SAME Authz* policy
// the parent tables use. We re-key the brief's `policy_type` + `policy_data` into a
// single permissive all-CRUD policy. This is the junction counterpart to
// POLICY_INTENTS — but a junction is one FK row, so a single policy suffices.
//
// 🚨 PROVISION-SAFETY COERCION (LOUD): if the requested policy dereferences an ownership
// column the junction's NODES do not materialize (the common case: an org-scoped
// `AuthzEntityMembership` on a DataId-only junction → needs `entity_id`, which no
// junction node provides), the policy can't be honored — emitting it verbatim aborts
// the ENTIRE constructBlueprint with `column "entity_id" does not exist` (proven on
// the desk2 fixture: 0 tables created). A pure-FK junction's rows are reachable ONLY
// via FKs into the org-secured parents, so authenticated read+write on the junction
// is transitively org-scoped already. We therefore coerce to `AuthzAllowAll` (no
// column dependency) so the junction is GRANTed + SECURED for `authenticated` and the
// app provisions. This is the M:N analog of GAP-1d's "secure the junction" intent,
// done in a column-safe shape — but it is NOT silent: per-row/org-scoped junction
// security is NOT forwarded by the platform (GAP-1d), so the result is
// security-INCOMPLETE. We emit a prominent warning AND record a structured entry in
// `warnings[]` so the build output surfaces it (stderr here, and the provision step
// re-prints brief.warnings[] — scaffold-provision.mjs). (To keep the parent-matching
// policy, give the junction the matching DATA node in the brief — e.g.
// nodes: [DataEntityMembership] — so the column exists; then this coercion is a no-op
// and no warning is recorded.)
function junctionPolicy(policyType, policyData, junctionNodes, junctionName = 'junction', warnings) {
  const needed = POLICY_OWNERSHIP_COLUMNS[policyType] ?? [];
  const have = columnsFromNodes(junctionNodes);
  const missing = needed.filter((c) => !have.has(c));
  if (missing.length > 0) {
    // Column-safe coercion (see the function header). Emit a CLEAN AuthzAllowAll —
    // no extra keys, since this literal is forwarded to constructBlueprint verbatim.
    const keepNode = missing.includes('owner_id') ? 'DataOwnershipInEntity' : 'DataEntityMembership';
    const message =
      `M:N junction ${junctionName}: per-row/org-scoped security is not forwarded by the platform (GAP-1d). ` +
      `This junction is AuthzAllowAll (any authenticated user) — security-incomplete pending the upstream fix. ` +
      `(${policyType} would need column(s) ${missing.join('+')}; to keep it, add nodes:[${keepNode}] to the relation.)`;
    // (a) prominent, immediate signal on the build output.
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write(`[brief] WARNING — ${message}\n`);
    }
    // (b) structured record on brief.warnings[] so the build output can re-surface it
    // (the provision step prints brief.warnings[] — scaffold-provision.mjs).
    if (Array.isArray(warnings)) {
      warnings.push({
        code: 'M2N_JUNCTION_ALLOW_ALL',
        gap: 'GAP-1d',
        junction: junctionName,
        requested_policy: policyType,
        applied_policy: 'AuthzAllowAll',
        missing_columns: missing,
        severity: 'security-incomplete',
        message,
      });
    }
    return {
      $type: 'AuthzAllowAll',
      privileges: [...ALL_CRUD],
      permissive: true,
      data: {},
    };
  }
  return {
    $type: policyType,
    privileges: [...ALL_CRUD],
    permissive: true,
    data: policyData ?? {},
  };
}

/**
 * Lift a RelationManyToMany's NESTED `data.{nodes, policy_type, policy_data, grants,
 * policies}` block into the FLAT top-level `nodes` / `grants` / `policies` keys that
 * construct_blueprint actually reads off each relation object (verified against the
 * deployed metaschema_modules_public.construct_blueprint procedure: it reads
 * v_relation_entry->'nodes' / ->'grants' / ->'policies' at the TOP level and forwards
 * them to provision_relation → provision_table; a nested `data` block is IGNORED).
 *
 * THIS IS THE FIX for the deny-all junction (0 grants / 0 policies): the documented
 * brief grammar nests security under `data:`, but the platform never unwraps it. We
 * translate the intent (policy_type/policy_data) into the SDK's flat security shape
 * (RelationManyToManyParams: top-level nodes[], grants[], policies[]) so the junction
 * is GRANTed + SECURED for `authenticated` exactly like its parent tables.
 *
 * Precedence: an explicit flat key on the relation wins (advanced authors may already
 * speak the SDK shape); otherwise we derive it from the nested `data` block. A junction
 * with neither flat keys nor a `data` block is left bare (the author opted out) — but
 * we WARN nowhere here; the scaffolder seam header surfaces it.
 *
 * PATTERN 3 (the GAP-1d fix). When the requested junction policy is ORG-SCOPED
 * (AuthzEntityMembership / AuthzMemberOwner) AND the author supplied NO explicit `nodes`,
 * we PREPEND the materializing DATA node (JUNCTION_MATERIALIZING_NODES) so the ownership
 * column (entity_id, +owner_id) exists on the junction BEFORE the policy applies. Then
 * junctionPolicy finds the column present → emits the REAL per-org policy and records NO
 * warning. This is the platform's own "Pattern 3" (constructive-db-relations-security):
 * RelationManyToMany forwards the relation's top-level nodes/policies/grants to
 * secure_table_provision verbatim, so the DATA node is the durable per-org fix — not a
 * coercion. The AuthzAllowAll coercion in junctionPolicy STAYS as a safety net ONLY for
 * the case an author hand-writes an org policy onto an explicit DataId-only `nodes` (then
 * the loud GAP-1d warning fires); the DEFAULT org path now hits Pattern 3 and never warns.
 *
 * The org intent may be requested two ways (both resolved here):
 *   • nested `data: { policy_type: AuthzEntityMembership, policy_data: {…} }` (as today), or
 *   • `junction_policy: org-membership` — a first-class shorthand on the relation that
 *     mirrors the table-level `policy` vocabulary (JUNCTION_POLICY_SHORTHAND).
 *
 * `warnings` (optional) is the brief-level sink junctionPolicy records its loud
 * AuthzAllowAll coercion into (GAP-1d). Threaded from buildBlueprintDefinition.
 */
function liftManyToManySecurity(r, warnings) {
  const d = (r.data && typeof r.data === 'object') ? r.data : {};
  // Human-legible junction name for the warning: the brief grammar's
  // junction_table_name, else a derived <source>_<target> label.
  const junctionName = r.junction_table_name ||
    [r.source_table, r.target_table].filter(Boolean).join('_') || 'junction';

  // Resolve the REQUESTED policy intent first (so we can decide whether the junction
  // needs a materializing node). Precedence: explicit flat `policies` already speaks the
  // SDK shape (no intent to resolve); else the `junction_policy:` shorthand; else the
  // nested `data.policy_type`/`policy_data`. The shorthand mirrors the table `policy`
  // vocabulary — `junction_policy: org-membership` → AuthzEntityMembership(entity_id).
  const shorthand = (typeof r.junction_policy === 'string')
    ? (JUNCTION_POLICY_SHORTHAND[r.junction_policy] ?? null)
    : null;
  if (typeof r.junction_policy === 'string' && !shorthand) {
    throw new BriefError(
      `relation ${junctionName}: unknown junction_policy "${r.junction_policy}". ` +
      `Known: ${Object.keys(JUNCTION_POLICY_SHORTHAND).join(', ')} ` +
      `(or nest data.policy_type / write flat policies[]).`
    );
  }
  const reqPolicyType = shorthand ? shorthand.policy_type : d.policy_type;
  const reqPolicyData = shorthand ? shorthand.policy_data : d.policy_data;

  // use_composite_key:true is a first-class RelationManyToMany param: the trigger builds
  // the PK from the junction's two FK columns, so NO surrogate DataId belongs on the
  // junction (the platform contract is explicit it is "mutually exclusive with nodes
  // containing DataId"). Read it here so the default node set drops DataId for a composite
  // junction; the value itself stays top-level on the relation (buildRelation forwards it
  // verbatim to the platform). Accept either spelling the grammar allows.
  const composite = r.use_composite_key === true || r.composite_key === true;

  // (1) nodes — explicit flat key wins; else nested data.nodes; else: if the requested
  // policy is org-scoped, the PATTERN-3 materializing node set (so entity_id/owner_id
  // exists; that node carries include_id:false, so it is composite-safe by construction);
  // else for a COMPOSITE junction the DataId-free Timestamps-only set; else the surrogate
  // DataId+Timestamps default.
  let nodes;
  if (Array.isArray(r.nodes)) nodes = r.nodes;
  else if (Array.isArray(d.nodes)) nodes = d.nodes;
  else if (JUNCTION_MATERIALIZING_NODES[reqPolicyType]) {
    nodes = JUNCTION_MATERIALIZING_NODES[reqPolicyType].map((n) => ({ $type: n.$type, data: { ...n.data } }));
  } else if (composite) nodes = [...JUNCTION_COMPOSITE_KEY_NODES];
  else nodes = [...JUNCTION_DEFAULT_NODES];

  // CONTRADICTION GUARD (loud): use_composite_key:true + a node set that STILL carries a
  // DataId is a double-PK the platform rejects — whether the DataId came from author-
  // supplied `nodes`/`data.nodes` (explicit branches above) or, defensively, any future
  // default. Fail fast + legibly here rather than let constructBlueprint abort the whole
  // (atomic) provision deep inside the trigger with "multiple primary keys … not allowed".
  if (composite && nodesContainDataId(nodes)) {
    throw new BriefError(
      `relation ${junctionName}: use_composite_key:true is mutually exclusive with a DataId node on the junction ` +
      `(the two FK columns ARE the composite primary key — a DataId would add a second, conflicting PK). ` +
      `Drop DataId from the junction's nodes, or set use_composite_key:false to use a surrogate UUID id.`
    );
  }

  // (2) grants — flat key wins; else nested data.grants; else the standard
  // object-form full-CRUD-for-authenticated (the same DEFAULT_GRANTS the tables use).
  let grants;
  if (Array.isArray(r.grants)) grants = r.grants;
  else if (Array.isArray(d.grants)) grants = d.grants;
  else grants = JSON.parse(JSON.stringify(DEFAULT_GRANTS));

  // (3) policies — flat key wins; else nested data.policies; else derive ONE policy from
  // the resolved intent (shorthand or data.policy_type). With the Pattern-3 nodes now in
  // place, junctionPolicy finds the ownership column present and emits the REAL per-org
  // policy with no warning. The AuthzAllowAll safety net only triggers if the author
  // forced a DataId-only `nodes` under an org policy (then the loud GAP-1d warning fires).
  // A junction with no policy intent at all leaves policies empty (RLS on, deny-all) — a
  // brief smell the scaffolder seam header surfaces, not our default.
  let policies;
  if (Array.isArray(r.policies)) policies = r.policies;
  else if (Array.isArray(d.policies)) policies = d.policies;
  else if (reqPolicyType) policies = [junctionPolicy(reqPolicyType, reqPolicyData, nodes, junctionName, warnings)];
  else policies = [];

  return { nodes, grants, policies };
}

/** Build a relation entry from a brief relations[] spec (verbatim, $type-keyed).
 *  `warnings` (optional) is the brief-level sink the M:N junction-security coercion
 *  records into; pass it from buildBlueprintDefinition. */
export function buildRelation(r, warnings) {
  // The brief relation grammar mirrors the blueprint relation shape 1:1, except
  // delete_action is normalized from the readable form to the single-char enum.
  const out = { ...r };
  if ('delete_action' in out) out.delete_action = codeDeleteAction(out.delete_action);

  // RelationManyToMany: translate the NESTED security block into the FLAT SDK form
  // construct_blueprint reads (top-level nodes/grants/policies). Without this the
  // junction ships deny-all (0 grants / 0 policies) because the platform never
  // unwraps `data:`. We emit the flat keys AND drop the now-redundant nested `data`
  // (its non-security fields — junction_table_name, *_field_name, use_composite_key —
  // are already top-level in the brief grammar; only the security keys lived under
  // `data`, and those are now lifted). See liftManyToManySecurity for the contract.
  if (out.$type === 'RelationManyToMany') {
    const { nodes, grants, policies } = liftManyToManySecurity(out, warnings);
    out.nodes = nodes;
    out.grants = grants;
    out.policies = policies;
    // Strip the nested `data` block: construct_blueprint ignores it, and leaving it
    // in the emitted relation literal would be misleading (it looks load-bearing).
    delete out.data;
  }

  return out;
}

/** Build the whole BlueprintDefinition object from the brief.
 *  Side effect: records any soft, security-INCOMPLETE outcomes (today: M:N junction
 *  AuthzAllowAll coercion, GAP-1d) onto `brief.warnings[]` so the build output can surface
 *  them (the provision step prints brief.warnings[]; live-QA does not read it). Hard,
 *  unsupported intents (composite PK, parent-derived access) THROW from
 *  buildTableDefinition / validateBrief instead. */
export function buildBlueprintDefinition(brief) {
  // The warnings sink lives on the brief so callers that already hold the brief object
  // (scaffold-provision, check-scaffold) can read it back after generation.
  const warnings = Array.isArray(brief.warnings) ? brief.warnings : (brief.warnings = []);
  const tables = [];
  const ftsEntries = [];
  for (const t of brief.data_model?.tables ?? []) {
    const { table, fts } = buildTableDefinition(t);
    tables.push(table);
    if (fts) ftsEntries.push(fts);
  }
  // NB: an explicit arrow (NOT a bare `.map(buildRelation)`) so Array.map's index arg
  // is not mistaken for the `warnings` sink.
  const relations = (brief.data_model?.relations ?? []).map((r) => buildRelation(r, warnings));
  const def = { tables, relations };
  // PLURAL key — the blueprint engine reads `definition.full_text_searches`.
  if (ftsEntries.length) def.full_text_searches = ftsEntries;
  return def;
}
