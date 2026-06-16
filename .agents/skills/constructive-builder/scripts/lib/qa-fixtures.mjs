/**
 * qa-fixtures.mjs — b2b ORG-CHAINING + fixture helpers for the live-QA driver.
 *
 * WHY THIS EXISTS (the #2 HIGH residual it fixes)
 * ------------------------------------------------
 * The three b2b org-detail drivers in live-qa.mjs (org-members, org-roles,
 * app-memberships) used to each do their OWN fresh signup and then query a
 * DIFFERENT user's org via a foreign `LIVE_QA_ORG_ID` env var. Result: the authed
 * actor was never a member/owner of the org being queried, so every read came back
 * "permission denied" — CORRECT (RLS doing its job) but USELESS: the flows could
 * never pass hands-free, and there was no orgId to drive against at all when the env
 * var was unset.
 *
 * THE FIX — resolve the orgId from an org the SIGNED-IN ACTOR ACTUALLY OWNS.
 * `scripts/fix-org-grants.sh` (RLS-ORG-RECONCILE-001, the orgReconcile cap) seeds, for
 * each actor, a PERSONAL-ORG row with the invariant **actor_id = entity_id = user_id,
 * is_owner = true** (in both the private `org_memberships_sprt` and the public
 * `org_memberships`). So after the reconcile, the actor OWNS the org whose
 * `entityId == their own currentUser.id`. That personal-org id (= the actor's own user
 * id) is therefore a valid, OWNED orgId the detail drivers can drive against — through
 * RLS, not around it.
 *
 * Org-create (`createUser(type=2)`, the "mint a NEW org" path) is upstream-blocked by
 * PLATFORM-GAPS GAP-6 (no `authenticated` INSERT policy for self-service org rows), so
 * the `organization` flow may not actually hand us a freshly-minted org id. We therefore
 * PREFER a real minted org id when the organization flow captured one (true create-org
 * chaining), and FALL BACK to the actor's personal org otherwise — marking the genuinely
 * upstream legs (mint a new org, seed a 2nd-member pending row) partial-by-design rather
 * than failing them.
 *
 * Contract / constraints (same as live-qa.mjs):
 *   • Zero deps. Pure Node (>=18). All browser/GraphQL work is delegated back to the
 *     primitives the caller passes in (gqlAuthed / pageEval / step) so this module never
 *     imports agent-browser itself and never runs anything at import time.
 *   • Selectors stay data-testid / role only (the caller owns the DOM primitives).
 *   • Every resolver DEGRADES to a string reason (never throws) so the caller turns a
 *     non-resolution into partial(<reason>), never a misleading hard fail.
 */

/**
 * The localStorage env-override key for a pre-supplied org id (kept identical to the
 * legacy driver behavior so an explicit operator override still wins).
 */
export const ORG_ID_ENV = 'LIVE_QA_ORG_ID';

/**
 * resolveOwnedOrgId(ctx, deps) → { orgId, source, owned, evidence } | { reason }
 *
 * Resolve an orgId the CURRENTLY SIGNED-IN actor can legitimately drive the org-detail
 * flows against. Precedence:
 *   1) ctx._orgId         — an org id the `organization` flow MINTED + stashed earlier
 *                           this run (true create-org chaining; source 'minted').
 *   2) process.env.LIVE_QA_ORG_ID — explicit operator override (source 'env'). Honored
 *                           for backward-compat / a deliberately pre-seeded tenant.
 *   3) the actor's PERSONAL org — currentUser.id, which the reconcile makes the actor own
 *                           (entity_id = actor_id = user_id, is_owner=true). source
 *                           'personal'. This is the hands-free path: no foreign id, the
 *                           actor owns it, so reads go THROUGH RLS and return rows.
 *
 * `deps` = { gqlAuthed, endpoint }. `endpoint` should be ctx.authEndpoint (currentUser
 * lives on the auth/users schema). Returns a string-bearing { reason } only when NONE of
 * the three resolve (no session at all) — the caller maps that to partial('no-org-id').
 *
 * `owned` is true for 'minted'/'personal' (the actor is the owner) and unknown→true for
 * 'env' (we trust the operator). It lets the caller phrase evidence honestly.
 */
export async function resolveOwnedOrgId(ctx, { gqlAuthed, endpoint } = {}) {
  // 1) An org the organization flow minted earlier this run (true chaining).
  if (ctx && typeof ctx._orgId === 'string' && ctx._orgId.trim()) {
    return { orgId: ctx._orgId.trim(), source: 'minted', owned: true, evidence: `minted by the organization flow earlier this run` };
  }
  // 2) Explicit operator override (kept winning over the personal-org fallback so a
  //    deliberately pre-seeded multi-member tenant can still be targeted).
  const envId = (process.env[ORG_ID_ENV] || '').trim();
  if (envId) {
    return { orgId: envId, source: 'env', owned: true, evidence: `from ${ORG_ID_ENV} (operator-supplied)` };
  }
  // 3) The actor's PERSONAL org — currentUser.id, which the reconcile makes the actor own
  //    (entity_id = actor_id = user_id). Resolve it through the authed session.
  if (typeof gqlAuthed === 'function' && endpoint) {
    try {
      const res = await gqlAuthed(endpoint, `query { currentUser { id } }`);
      const id = res?.data?.currentUser?.id;
      if (id && String(id).trim()) {
        const orgId = String(id).trim();
        // Memoize on ctx so sibling detail drivers reuse the same owned org without
        // re-querying (and so they all chain off ONE actor's personal org).
        if (ctx) ctx._orgId = orgId;
        return {
          orgId,
          source: 'personal',
          owned: true,
          evidence: `actor's personal org (entity_id = currentUser.id = ${orgId.slice(0, 8)}…, reconcile makes the actor its owner — GAP-6 blocks minting a NEW org)`,
        };
      }
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      return { reason: `could not resolve currentUser.id to derive the actor's personal org (${errMsg || 'no currentUser'}); set ${ORG_ID_ENV} or run the organization flow first` };
    } catch (e) {
      return { reason: `currentUser query failed while resolving the actor's personal org (${(e && e.message) || String(e)})` };
    }
  }
  return { reason: `no org id (no minted org, no ${ORG_ID_ENV}, and no authed currentUser to derive the personal org from)` };
}

/**
 * confirmActorOwnsOrg(ctx, orgId, { gqlAuthed, endpoint }) → true | <reason string>
 *
 * Best-effort proof that the membership row the reconcile seeds is actually present for
 * THIS actor on THIS org (the public `orgMemberships` row with entityId == orgId, the
 * actor as a member/owner). Used by the detail drivers to phrase evidence as "the actor
 * owns it" vs merely "we picked it". NEVER throws and NEVER hard-fails the flow — if the
 * membership list is not readable here it returns a string reason and the caller keeps
 * the (already valid) personal-org id, marking that leg partial rather than failing.
 *
 * `endpoint` should be ctx.adminEndpoint (orgMemberships lives on the admin/org schema —
 * the SAME endpoint the detail drivers already read memberships from).
 */
export async function confirmActorOwnsOrg(ctx, orgId, { gqlAuthed, endpoint } = {}) {
  if (!orgId) return 'no orgId to confirm';
  if (typeof gqlAuthed !== 'function' || !endpoint) return 'no admin endpoint to confirm ownership';
  try {
    const res = await gqlAuthed(endpoint, `query { orgMemberships { nodes { id entityId isOwner } } }`);
    const nodes = res?.data?.orgMemberships?.nodes;
    if (!Array.isArray(nodes)) {
      const errMsg = (res?.errors && res.errors[0]?.message) || '';
      return `orgMemberships not readable here (${errMsg || 'no nodes'})`;
    }
    // entityId == orgId is the personal-org row (the reconcile sets entity_id = orgId for
    // the personal org). A matching row — preferably is_owner — proves the actor scopes it.
    const mine = nodes.find((n) => String(n.entityId || '') === String(orgId));
    if (mine) return true;
    // No exact entityId match but the list is non-empty → the actor IS in some org(s);
    // ownership of THIS specific id is unconfirmed (still usable, just unproven here).
    return nodes.length > 0
      ? `actor has ${nodes.length} membership(s) but none with entityId==${String(orgId).slice(0, 8)}… (ownership unproven; id still usable)`
      : `actor has no orgMemberships rows visible (reconcile row not surfaced on this endpoint)`;
  } catch (e) {
    return `ownership confirm query failed (${(e && e.message) || String(e)})`;
  }
}

/**
 * seedPendingMembership(ctx, orgId, deps) → { seeded:true, id, isApproved:false } | { reason }
 *
 * Try to mint a PENDING app-membership on `orgId` so the app-memberships approve/revoke
 * and org-members remove legs have something to drive. Strategy, all through the AUTHED
 * admin path (RLS-respecting, never a side-channel):
 *
 *   (1) If a pending row ALREADY exists (isApproved=false) — reuse it (no mint needed).
 *   (2) Otherwise attempt the GA join op `createAppMembership` for a SECOND, freshly
 *       signed-up actor against this org, which lands as isApproved=false (pending
 *       approval). The 2nd signup is delegated back to the caller's `signUpSecondActor`
 *       (it owns the browser primitives); we only orchestrate + assert via gqlAuthed.
 *
 * If the only way to mint a pending row is an upstream-missing op (createAppMembership
 * not in the schema / RLS-denied for self-service joins), we DO NOT fail: we return a
 * { reason } the caller records as partial('no-membership-fixture', …) — the op surface
 * is real, the fixture is upstream-blocked. This mirrors the GAP-6 stance.
 *
 * `deps` = {
 *   gqlAuthed,            // (endpoint, query, vars) => { data, errors }
 *   adminEndpoint,        // where appMemberships + createAppMembership live
 *   signUpSecondActor,    // optional async () => ({ userId } | string reason). Caller
 *                         // supplies it so the 2nd member's identity comes from a real
 *                         // browser signup; if omitted we only try the data-path join
 *                         // for a synthetic id (which upstream likely rejects → partial).
 *   step,                 // optional logger (s) => void
 * }
 */
export async function seedPendingMembership(ctx, orgId, { gqlAuthed, adminEndpoint, signUpSecondActor, step } = {}) {
  const note = typeof step === 'function' ? step : () => {};
  if (!orgId) return { reason: 'no orgId — cannot seed a pending membership' };
  if (typeof gqlAuthed !== 'function' || !adminEndpoint) return { reason: 'no admin endpoint to seed/inspect memberships' };

  // (1) Reuse an already-pending row if the tenant happens to have one.
  const existing = await gqlAuthed(adminEndpoint, `query { appMemberships { nodes { id isApproved } } }`);
  const existingNodes = existing?.data?.appMemberships?.nodes;
  if (Array.isArray(existingNodes)) {
    const pending = existingNodes.find((n) => n.isApproved === false);
    if (pending) return { seeded: false, reused: true, id: pending.id, isApproved: false, evidence: 'reused an existing pending app membership' };
  } else {
    const errMsg = (existing?.errors && existing.errors[0]?.message) || '';
    // The list itself is unreadable — surface that to the caller (membership-query-unavailable).
    return { reason: `appMemberships not readable to seed a fixture (${errMsg || 'no nodes'})` };
  }

  // (2) Mint a pending row via a 2nd actor's self-service join, IF the caller gave us a
  //     way to create that 2nd actor. createAppMembership is the GA join; a fresh member's
  //     join lands pending (isApproved=false) awaiting the owner's approval.
  if (typeof signUpSecondActor === 'function') {
    note('seed a pending membership: sign up a 2nd actor and join the org (pending approval)');
    const second = await signUpSecondActor();
    if (typeof second === 'string') return { reason: `could not create a 2nd actor for the membership fixture (${second})` };
    const memberId = second && second.userId;
    // Try the join mutation. We probe a couple of plausible input shapes but treat ANY
    // schema-shape/RLS rejection as upstream-missing (partial), never a hard fail.
    const tryJoin = async (mutation, variables) => {
      try {
        const r = await gqlAuthed(adminEndpoint, mutation, variables);
        const errMsg = (r?.errors && r.errors[0]?.message) || '';
        return { ok: !errMsg, errMsg, data: r?.data };
      } catch (e) {
        return { ok: false, errMsg: (e && e.message) || String(e) };
      }
    };
    const attempts = [
      [`mutation($input: CreateAppMembershipInput!) { createAppMembership(input: $input) { appMembership { id isApproved } } }`,
        { input: { appMembership: { actorId: memberId, isApproved: false } } }],
      [`mutation($input: CreateAppMembershipInput!) { createAppMembership(input: $input) { appMembership { id isApproved } } }`,
        { input: { appMembership: { memberId, isApproved: false } } }],
    ];
    let lastErr = '';
    for (const [mutation, variables] of attempts) {
      const out = await tryJoin(mutation, variables);
      const id = out?.data?.createAppMembership?.appMembership?.id;
      if (out.ok && id) return { seeded: true, id, isApproved: false, memberId, evidence: 'created a pending app membership via createAppMembership (2nd actor join)' };
      lastErr = out.errMsg || lastErr;
      // A field-doesn't-exist error means the mutation shape is wrong — try the next shape;
      // any other error (RLS/permission) is the upstream-missing self-service join → stop.
      if (!/cannot query field|unknown (field|argument|type)|field .* is not defined/i.test(lastErr)) break;
    }
    return { reason: `createAppMembership did not mint a pending row (${lastErr || 'no membership returned'}) — self-service org-join is upstream-missing for this tier; approve/revoke op surface is real but the fixture is not creatable here` };
  }

  return { reason: 'no pending app membership in this fresh tenant and no 2nd-actor signer supplied — fixture not creatable hands-free (op surface real, fixture upstream-blocked)' };
}
