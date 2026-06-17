/**
 * scripts/lib/scaffold-frontend/flow-surfaces.mjs — (f) FLOW-BLOCK MOUNTING.
 *
 * scaffold-frontend ONLY owns the domain-entity surface (steps a–e). The Blocks on-ramp
 * (scripts/wire-app.mjs + `shadcn add`) installs each flow's blocks AS COMPONENTS, but nothing
 * mounts them at a reachable, testid-carrying Next route — so a multi-flow app provisions
 * auth/account/org capability that is unreachable from the UI (the #1 harness bug). Step (f)
 * closes that gap GENERICALLY: it reads the brief's flows[] and, for each, mounts the flow's
 * blocks on a real surface, then writes build/flow-surfaces.json (the manifest the live-QA
 * driver reads).
 *
 * This module owns:
 *   FLOW_SURFACES               the flow → block-mount map (mirrors references/flows.json).
 *   emitAccountPage             the ONE aggregated /account page (account-session sections).
 *   emitDedicatedPage           one self-contained landing page (verify-email / reset / …).
 *   emitOrgPage / emitOrgStaticPages   the /org/[orgId]/<sub> admin pages + the static /org,
 *                               /org/new siblings.
 *   emitAuthFormAddon           the cross-origin / social-oauth sign-in add-ons.
 *   mountOrgContext             the OrgProvider/OrgSwitcher shell mount (org-flow apps only).
 *   emitFlowSurfaces            the single entry point main() calls after step (e).
 *   writeFlowSurfacesManifest   the build/flow-surfaces.json writer.
 *
 * Everything is GATED on the flow being in brief.flows, so the canary (flows: [email-password])
 * emits ZERO new pages. Component names / import paths / props are sourced VERBATIM from each
 * flow's howto.usage; no flow id is special-cased (adding a flow = adding a FLOW_SURFACES entry).
 */

import * as fs from 'fs';
import * as path from 'path';
import { titleCase, kebab } from '../inflect.mjs';
import { FLOWS_TEMPLATES_DIR, BUILD_DIR } from './paths.mjs';
import { readTemplate, write, skip, rel, indentBlock, assertNoUnsubstituted } from './writers.mjs';
import { routeSegments, pathWords, appendRoute, appendNavItem } from './routes-nav.mjs';
import { stepUpBlockInstalled, ensureStepUpProvider } from './step-up.mjs';

// ════════════════════════════════════════════════════════════════════════════
// FLOW SURFACES — the flow → block-mount map (step (f), the flow-block mounting).
//
// This map MIRRORS references/flows.json — keyed by flow id, grouped by the same
// `group` (the only categorization that exists). Component names, import paths and
// props are sourced VERBATIM from each flow's howto.usage (see references/flows.json
// + the verified block sources). Everything is GATED on the flow being in brief.flows
// so the canary (flows: [email-password]) emits ZERO new pages (email-password is
// handled by the existing step (e) and is intentionally absent here).
//
// `kind` drives how step (f) renders the entry:
//   aggregate-account — a SECTION on the single /account page (account-session group).
//   dedicated-route   — one self-contained page.tsx per `routes[]` (self-reading
//                       blocks mount bare; the account-deletion landing is a
//                       param-reading wrapper template).
//   org-route         — one /org/<sub> page per `routes[]` (authorization group),
//                       each with the ORG_ID_SEAM where the block needs an orgId.
//   auth-form-addon   — NOT a page: a commented // TODO seam injected into the
//                       sign-in auth-page (origin/providers are app-specific — never
//                       fabricated; emitted only as a documented seam).
//
// `needsStepUp: true` marks an account-session section whose block gates on a
// StepUpProvider — step (f) warns if such a section is chosen without the `step-up`
// flow (else wire-app won't install use-step-up and the gate has no provider).
// ════════════════════════════════════════════════════════════════════════════

export const ACCOUNT_PATH = '/account';
export const ACCOUNT_SHELL_TESTID = 'account-page';

export const FLOW_SURFACES = {
  // ── authentication group ──────────────────────────────────────────────────
  // email-password is INTENTIONALLY ABSENT — the existing step (e) emits its
  // /sign-in + /sign-up bridge pages. Adding it here would double-emit.

  'password-reset': {
    group: 'authentication',
    kind: 'dedicated-route',
    routes: [
      // sign-in-card links here via forgotPasswordHref (wired in the auth-page).
      { path: '/forgot-password', template: 'forgot-password-page.tsx' },
      { path: '/reset-password', template: 'reset-password-page.tsx' },
    ],
  },

  'email-verification': {
    group: 'authentication',
    kind: 'dedicated-route',
    routes: [
      // VerifyEmailPage self-reads ?email_id= & ?token=; the wrapper passes nav hrefs.
      { path: '/verify-email', template: 'verify-email-page.tsx', subAuthedRedirect: true },
    ],
    // Banner seam: VerifyEmailBanner({email}) belongs in the authed shell header but
    // needs currentUser.primaryEmail (app-specific) — left as a // TODO in the
    // account-page header rather than fabricated. (No standalone surface.)
  },

  'cross-origin': {
    group: 'authentication',
    kind: 'auth-form-addon',
    // Mounts INSIDE the sign-in form; origin/email/password are app-specific.
    addon: {
      import: "import { CrossOriginLink } from '@/blocks/auth/cross-origin-link/cross-origin-link';",
      // emitted commented — destinationOrigin/email/password must be supplied by the app.
      jsx: '<CrossOriginLink email={email} password={password} destinationOrigin="https://app.example.com" destinationPath="/auth/cross-origin" />',
      note: 'requestCrossOriginToken — set a real destinationOrigin + wire email/password from the sign-in form state.',
    },
  },

  'social-oauth': {
    group: 'authentication',
    kind: 'auth-form-addon',
    addon: {
      // liveMount: AuthSocialButtons is self-sufficient — it self-fetches the configured
      // identity providers (useIdentityProvidersQuery) and `mode="sign-in"` needs no
      // app-specific props (unlike cross-origin, which needs a real destinationOrigin +
      // the sign-in form's email/password). So it is MOUNTED LIVE into the sign-in page
      // (not just a commented seam): the provider grid renders the configured providers
      // (empty/disabled until auth:sso providers are provisioned upstream — render-only,
      // partial-by-design). testids: per-provider social-btn-<slug>.
      liveMount: true,
      import: "import { AuthSocialButtons } from '@/blocks/auth/social-buttons/social-buttons';",
      jsx: '<AuthSocialButtons mode="sign-in" />',
      note: 'renders the configured auth:sso providers (empty until providers are provisioned upstream).',
    },
  },

  // ── account-session group → SECTIONS on the single /account page ───────────
  profile: {
    group: 'account-session',
    kind: 'aggregate-account',
    import: "import { AccountProfileCard } from '@/blocks/auth/account-profile-card/account-profile-card';",
    // self-fetch; testids: save-profile-btn, change-photo-btn.
    section: '<AccountProfileCard onSuccess={() => {}} />',
    sectionLabel: 'Profile',
  },

  'account-emails': {
    group: 'account-session',
    kind: 'aggregate-account',
    import: "import { AccountEmailsList } from '@/blocks/auth/account-emails-list/account-emails-list';",
    // self-fetch; testids: add-email-button, email-row-*, delete-email-confirm.
    section: '<AccountEmailsList maxEmails={10} />',
    sectionLabel: 'Email addresses',
  },

  'change-password': {
    group: 'account-session',
    kind: 'aggregate-account',
    needsStepUp: true,
    import: "import { ChangePasswordForm } from '@/blocks/auth/change-password-form/change-password-form';",
    // testid: change-password-submit; gates on StepUpProvider (see needsStepUp).
    section: '<ChangePasswordForm requireStepUp showPasswordStrength onSuccess={() => {}} />',
    sectionLabel: 'Change password',
  },

  sessions: {
    group: 'account-session',
    kind: 'aggregate-account',
    needsStepUp: true,
    import: "import { AccountSessionsList } from '@/blocks/auth/account-sessions-list/account-sessions-list';",
    // NO generated list hook (GAP-2) → sessions={[]} + a // TODO to wire the data
    // source. testids: revoke-all-button, revoke-confirm-button.
    section:
      '{/* TODO: wire `sessions` from the auth `sessions` query — no generated list hook (PLATFORM-GAPS GAP-2). */}\n' +
      '<AccountSessionsList sessions={[]} onRevokeSubmit={async () => null} />',
    sectionLabel: 'Active sessions',
  },

  'api-keys': {
    group: 'account-session',
    kind: 'aggregate-account',
    needsStepUp: true,
    import: "import { AccountApiKeysList } from '@/blocks/auth/account-api-keys-list/account-api-keys-list';",
    // NO generated list hook → keys={[]} + // TODO. The create dialog is controlled
    // INSIDE the block (it owns api-key-create-dialog / created-modal). Valid
    // accessLevel is read_only | full_access (per the GAP — NOT read/write/admin).
    // testids: create-key-button, api-key-create-submit, created-api-key.
    section:
      '{/* TODO: wire `keys` from the user_api_keys source — no generated list hook (PLATFORM-GAPS GAP-3). */}\n' +
      '<AccountApiKeysList keys={[]} onKeyCreated={() => {}} onKeyRevoked={() => {}} />',
    sectionLabel: 'API keys',
  },

  'connected-accounts': {
    group: 'account-session',
    kind: 'aggregate-account',
    // The disconnect action is gated behind a step-up (tier: medium) — the block
    // calls useStepUp() at render (account-connected-accounts.tsx), so /account MUST
    // be wrapped in a <StepUpProvider> or the page throws at runtime
    // ("useStepUp() must be called inside <StepUpProvider>"). This mirrors the
    // flows.json `connected-accounts` block, which declares the StepUpProvider wire
    // and lists `step-up` as a related flow — exactly like change-password/sessions.
    needsStepUp: true,
    import: "import { AccountConnectedAccounts } from '@/blocks/auth/account-connected-accounts/account-connected-accounts';",
    // connection types not public → connectedAccounts/providers = [] + // TODO.
    section:
      '{/* TODO: pass connectedAccounts + providers (connection types not yet public). */}\n' +
      '<AccountConnectedAccounts connectedAccounts={[]} providers={[]} oauthRedirectBase="/auth/oauth" />',
    sectionLabel: 'Connected accounts',
  },

  'account-deletion': {
    group: 'account-session',
    kind: 'aggregate-account',
    needsStepUp: true,
    // A danger-zone SECTION on /account …
    import: "import { AccountDangerCard } from '@/blocks/auth/account-danger-card/account-danger-card';",
    // testid: account-danger-confirm.
    section: '<AccountDangerCard />',
    sectionLabel: 'Danger zone',
    // … PLUS a dedicated link-landing route (param-reading wrapper template).
    routes: [
      { path: '/delete-account', template: 'delete-account-page.tsx', subAuthedRedirect: true },
    ],
  },

  // step-up has NO own surface — installing use-step-up makes wire-app wrap
  // StepUpProvider. It is intentionally absent from FLOW_SURFACES (no page/section).

  // ── authorization group → /org/[orgId]/<sub> admin routes ─────────────────
  // Every org admin page lives under app/org/[orgId]/ and reads the active org id
  // from the URL param (org-page.tsx: `const { orgId } = useParams()`) — NO inline
  // mint, NO useState, NO ORG_ID_SEAM. The org is selected by the OrgSwitcher (or the
  // /org index redirect → the bootstrap personal org) and carried in the URL. The
  // /org/new create page (OrgCreateCard → route to the new org) is emitted separately
  // in emitFlowSurfaces (a static sibling of [orgId], so Next resolves it first).
  organization: {
    group: 'authorization',
    kind: 'org-route',
    // SURFACE = the org-CREATE page, NOT the settings admin page. The `organization`
    // flow IS org-create: its live-QA driver drives the create testids (org-username /
    // org-submit), which mount in OrgCreateCard at the STATIC /org/new page (emitted by
    // emitOrgStaticPages). Mapping the flow's surface to /org/new makes routeFor resolve
    // there with NO unsubstituted [orgId] token (the create page carries no org id) — so
    // the driver lands on the page where its testids actually mount instead of a 404'd
    // /org/[orgId]/settings. Org SETTINGS is a separate admin concern: the settings sub-
    // route below is still emitted as a reachable /org/[orgId]/settings page, but it is
    // NOT this flow's recorded surface. shellTestid = the create page's own app testid.
    surface: { path: '/org/new', shellTestid: 'org-new-page' },
    routes: [
      {
        sub: 'settings',
        title: 'Organization settings',
        imports: ["import { OrgSettingsForm } from '@/blocks/org/settings-form/settings-form';"],
        // testids: save-settings-submit, delete-org-button.
        body: '<OrgSettingsForm orgId={orgId} />',
      },
    ],
  },

  'org-members': {
    group: 'authorization',
    kind: 'org-route',
    routes: [
      {
        sub: 'members',
        title: 'Members',
        imports: ["import { MembersList } from '@/blocks/org/members-list/members-list';"],
        // testids: remove-${membershipId}, confirm-remove.
        body: '<MembersList orgId={orgId} />',
      },
    ],
  },

  'org-roles': {
    group: 'authorization',
    kind: 'org-route',
    routes: [
      {
        sub: 'roles',
        title: 'Roles',
        imports: ["import { OrgRolesEditor } from '@/blocks/org/roles-editor/roles-editor';"],
        // The org id comes from the URL param (no inline mint). testids: add-role-button,
        // save-role-button (live-qa also drives profile-name / profile-slug).
        body: '<OrgRolesEditor orgId={orgId} />',
      },
    ],
  },

  'org-invites': {
    group: 'authorization',
    kind: 'org-route',
    routes: [
      {
        sub: 'invites',
        title: 'Invitations',
        // FIX: the block exports `InviteDialog` (NOT `OrgInviteDialog`); props
        // OrgInviteDialogProps { orgId, open, onOpenChange }.
        imports: ["import { useState } from 'react';", "import { InviteDialog } from '@/blocks/org/invite-dialog/invite-dialog';"],
        // controlled dialog (open/onOpenChange). testid: invite-submit.
        hooks: '  const [inviteOpen, setInviteOpen] = useState(true);',
        body: '<InviteDialog orgId={orgId} open={inviteOpen} onOpenChange={setInviteOpen} />',
      },
    ],
    // PLUS the invitation-acceptance landing (self-reading) as a dedicated route.
    dedicated: [
      { path: '/invite', template: 'invite-page.tsx' },
    ],
  },

  'app-memberships': {
    group: 'authorization',
    kind: 'org-route',
    routes: [
      {
        sub: 'app-memberships',
        title: 'App memberships',
        imports: ["import { OrgAppMemberships } from '@/blocks/org/app-memberships/app-memberships';"],
        // testids: approve-button, revoke-button, revoke-confirm-button.
        body: '<OrgAppMemberships orgId={orgId} />',
      },
    ],
  },
};

/** The account-session flows that gate on a StepUpProvider (see needsStepUp). */
export function accountSessionStepUpFlows() {
  return Object.entries(FLOW_SURFACES)
    .filter(([, s]) => s.group === 'account-session' && s.needsStepUp)
    .map(([id]) => id);
}

/**
 * The ONE aggregated /account page, composed from whichever account-session sections
 * the brief installed. Imports + section JSX come VERBATIM from FLOW_SURFACES (sourced
 * from flows.json howto.usage). Idempotent: skips if the page already exists. Returns
 * the surface descriptor for flow-surfaces.json, or null when nothing was mounted.
 */
export function emitAccountPage(srcDir, accountFlows, ctx) {
  if (accountFlows.length === 0) return null;
  const dest = path.join(srcDir, 'app', 'account', 'page.tsx');
  // Record the surface for EVERY chosen account-session flow regardless of whether the
  // page is freshly written or already on disk (so flow-surfaces.json is complete).
  const surface = { path: ACCOUNT_PATH, shellTestid: ACCOUNT_SHELL_TESTID };

  if (fs.existsSync(dest)) {
    skip(dest, ctx);
  } else {
    // Collect imports (de-duped, stable order) + section fragments for the chosen flows.
    const imports = [];
    const seenImport = new Set();
    const sections = [];
    for (const fid of accountFlows) {
      const s = FLOW_SURFACES[fid];
      if (!s || s.kind !== 'aggregate-account') continue;
      if (s.import && !seenImport.has(s.import)) {
        seenImport.add(s.import);
        imports.push(s.import);
      }
      sections.push(
        `        {/* ${fid} — ${s.sectionLabel} */}\n` + indentBlock(s.section, 8),
      );
    }
    let body = readTemplate(FLOWS_TEMPLATES_DIR, 'account-page.tsx');
    body = body.split('__IMPORTS__').join(imports.join('\n'));
    body = body.split('__SECTIONS__').join(sections.join('\n'));
    assertNoUnsubstituted(dest, body);
    write(dest, body, ctx);
  }

  // The /account route + nav (protected, app). Reuses the idempotent appenders.
  // Explicit key ACCOUNT (the template declares ACCOUNT_SETTINGS, not ACCOUNT).
  const route = { path: ACCOUNT_PATH, label: 'Account', key: 'ACCOUNT' };
  appendRoute(srcDir, route, ctx, { context: 'app', access: 'protected' });
  appendNavItem(srcDir, route, 'Account', ctx);
  return surface;
}

/**
 * Emit ONE dedicated self-contained page from a flow template (verify-email /
 * forgot-password / reset-password / delete-account / invite). Self-reading blocks
 * mount bare; the account-deletion wrapper reads searchParams. The __AUTHED_REDIRECT__
 * seam (where used) is the app's primary entity surface. Idempotent — if the base
 * template (or a prior pass) already shipped this route's page, it is left untouched
 * (the template's native auth page wins; flow-surfaces.json still records the path so
 * QA can drive whichever page is mounted there). Returns { path, shellTestid }.
 */
export function emitDedicatedPage(srcDir, routeSpec, authedRedirect, ctx, { access }) {
  const dest = path.join(srcDir, 'app', ...routeSegments(routeSpec.path), 'page.tsx');
  // COLLISION RECONCILE (FLOW-QA mail2): the tiered base template STILL ships its own
  // auth screen pages for verify-email / forgot-password / reset-password (importing
  // @/components/auth/screens/* with their OWN testids, e.g. `auth-forgot-submit`).
  // If we skip-if-exists, the live-QA driver — which asserts the BLOCK contract testids
  // (`forgot-password-submit`, `verify-email-submit`, …) — navigates to the template page
  // and times out (a hard FAIL). The Blocks FLOW page is the intended driver-contract
  // surface, so it must WIN: overwrite an existing page UNLESS that page is ALREADY a
  // block-mounted one (imports @/blocks/auth — a prior pass or a hand-authored block page,
  // which we leave untouched to stay idempotent + respect deliberate customization).
  const existing = fs.existsSync(dest);
  const isBlockPage = existing && /@\/blocks\/auth\//.test(fs.readFileSync(dest, 'utf8'));
  if (existing && isBlockPage) {
    skip(dest, ctx);
  } else {
    let body = readTemplate(FLOWS_TEMPLATES_DIR, routeSpec.template);
    if (routeSpec.subAuthedRedirect) {
      body = body.split('__AUTHED_REDIRECT__').join(authedRedirect);
    }
    assertNoUnsubstituted(dest, body);
    write(dest, body, ctx); // write() overwrites — reconciles the template's own auth page
  }
  const route = { path: routeSpec.path, label: titleCase(kebab(routeSegments(routeSpec.path).join('-')) || 'page') };
  appendRoute(srcDir, route, ctx, { context: 'app', access });
  // Auth link-landings are not primary nav items (reached via email links), so no nav.
  // The shell testid is the block's own (these pages mount the block bare); QA waits on
  // the block testid. We surface the wrapper testid for the param-reading delete page.
  return { path: routeSpec.path, shellTestid: routeSpec.shellTestid ?? null };
}

/**
 * Emit ONE /org/[orgId]/<sub> admin page from the generic org-page template, filling
 * the seams (imports / hooks / body / title / shell testid) from the FLOW_SURFACES
 * route spec. The page lives under the literal `[orgId]` dynamic segment and reads the
 * active org id from the URL param (org-page.tsx: `const { orgId } = useParams()`) — so
 * there is NO orgId seam const: the org is selected by the OrgSwitcher / the /org index
 * redirect and carried in the URL. Appends the protected route entry. NO nav item — a
 * `/org/[orgId]/<sub>` href is not directly navigable; org pages are reached via the
 * OrgSwitcher + the /org redirect (mirrors how auth link-landings get no nav).
 * Idempotent. Returns { path, shellTestid } where `path` carries the literal `[orgId]`.
 */
export function emitOrgPage(srcDir, routeSpec, ctx) {
  const sub = routeSpec.sub;
  const shellTestid = `org-${sub}-page`;
  // The manifest/route path is a TEMPLATE carrying the literal `[orgId]` dynamic
  // segment (the file path Next maps as a directory). live-QA interpolates the concrete
  // org id before navigating; the guard validates it as a FILE path (never interpolates).
  const orgPath = `/org/[orgId]/${sub}`;
  // Inject the literal `[orgId]` directory between `org` and the sub-route segment.
  const dest = path.join(srcDir, 'app', 'org', '[orgId]', ...routeSegments(sub), 'page.tsx');
  if (fs.existsSync(dest)) {
    skip(dest, ctx);
  } else {
    const imports = (routeSpec.imports || []).join('\n');
    const hooks = routeSpec.hooks ? routeSpec.hooks.replace(/\s*$/, '') + '\n' : '';
    let body = readTemplate(FLOWS_TEMPLATES_DIR, 'org-page.tsx');
    body = body.split('__ORG_IMPORTS__').join(imports);
    body = body.split('__ORG_HOOKS__').join(hooks);
    body = body.split('__ORG_SHELL_TESTID__').join(shellTestid);
    body = body.split('__ORG_PAGE_TITLE__').join(routeSpec.title);
    body = body.split('__ORG_BODY__').join(indentBlock(routeSpec.body, 8));
    assertNoUnsubstituted(dest, body);
    write(dest, body, ctx);
  }
  // Explicit, collision-free key: the base template already declares ORG_MEMBERS /
  // ORG_SETTINGS / ORG_INVITES for its /orgs/[orgId]/… routes — a path-derived key
  // (/org/members → ORG_MEMBERS) would duplicate them and break the `as const` object.
  // Namespace ours under ORG_<SUB>_PAGE (collision-free across the [orgId] subs).
  const key = `ORG_${pathWords(sub).join('_').toUpperCase()}_PAGE`;
  const route = { path: orgPath, label: routeSpec.title, key };
  appendRoute(srcDir, route, ctx, { context: 'app', access: 'protected' });
  // NO appendNavItem — org pages are reached via the OrgSwitcher + the /org redirect.
  return { path: orgPath, shellTestid };
}

/**
 * PART D — the static `/org` index + `/org/new` create pages, emitted as NON-bracket
 * siblings of `app/org/[orgId]/` so Next resolves them BEFORE the dynamic segment
 * (`/org` and `/org/new` hit these, never `[orgId]` with orgId='new'). Both are gated
 * by the caller on orgRouteFlows.length>0. Idempotent.
 *
 *   • app/org/page.tsx       → a CLIENT redirect to `/org/<resolveOwnedOrgId()>/roles`
 *     (the bootstrap personal org; reads TokenManager → browser-only), else /org/new.
 *   • app/org/new/page.tsx   → OrgCreateCard; onSuccess({ org }) routes to the new org's
 *     /org/<org.id>/roles (OrgCreateResult = { org: User } → org.id is a users row id).
 */
export function emitOrgStaticPages(srcDir, ctx) {
  // D1 — the bare /org index redirect (static; beats the dynamic [orgId] sibling).
  const indexDest = path.join(srcDir, 'app', 'org', 'page.tsx');
  if (fs.existsSync(indexDest)) {
    skip(indexDest, ctx);
  } else {
    const indexBody = `'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { resolveOwnedOrgId, ORG_DEFAULT_SUB } from '@/components/org-context';

/**
 * /org — the bare org index. CLIENT redirect (resolveOwnedOrgId reads the browser
 * TokenManager) to the owned org's first MOUNTED admin sub (ORG_DEFAULT_SUB — derived from
 * the brief's org flows, never a hard-coded 'roles' that 404s when org-roles wasn't chosen),
 * or /org/new if no owned org id resolves. Static sibling of [orgId], so Next resolves /org
 * here. If NO org admin page is mounted, falls through to /org/new.
 */
export default function OrgIndexPage() {
  const router = useRouter();
  useEffect(() => {
    const id = resolveOwnedOrgId();
    const dest = id && ORG_DEFAULT_SUB ? \`/org/\${id}/\${ORG_DEFAULT_SUB}\` : '/org/new';
    router.replace(dest as never);
  }, [router]);
  return (
    <div data-testid="org-index-redirect" className="p-8">
      Loading organizations…
    </div>
  );
}
`;
    write(indexDest, indexBody, ctx);
  }
  appendRoute(srcDir, { path: '/org', label: 'Organizations', key: 'ORG_INDEX' }, ctx, {
    context: 'app',
    access: 'protected',
  });

  // D2 — the /org/new create page (static; beats [orgId] with orgId='new').
  const newDest = path.join(srcDir, 'app', 'org', 'new', 'page.tsx');
  if (fs.existsSync(newDest)) {
    skip(newDest, ctx);
  } else {
    const newBody = `'use client';
import { useRouter } from 'next/navigation';
import { OrgCreateCard } from '@/blocks/org/create-card/create-card';
import { ORG_DEFAULT_SUB } from '@/components/org-context';

/**
 * /org/new — create an organization, then route to it. OrgCreateCard.onSuccess receives
 * OrgCreateResult = { org: User } (the new org is a users row), so destructure { org }
 * for org.id. Static sibling of [orgId], so Next resolves /org/new here (never as
 * [orgId] with orgId='new'). Routes to the first MOUNTED org sub (ORG_DEFAULT_SUB — derived
 * from the brief's org flows, never a hard-coded 'roles' that may 404); if no org admin page
 * is mounted, lands on the app root. testids: org-username, org-submit.
 */
export default function NewOrgPage() {
  const router = useRouter();
  return (
    <div data-testid="org-new-page" className="mx-auto max-w-2xl px-6 py-12">
      <OrgCreateCard
        onSuccess={({ org }) =>
          router.push((ORG_DEFAULT_SUB ? \`/org/\${org.id}/\${ORG_DEFAULT_SUB}\` : '/') as never)
        }
      />
    </div>
  );
}
`;
    write(newDest, newBody, ctx);
  }
  appendRoute(srcDir, { path: '/org/new', label: 'Create organization', key: 'ORG_NEW' }, ctx, {
    context: 'app',
    access: 'protected',
  });
}

/**
 * Mount an auth-form add-on (cross-origin / social-oauth) into the sign-in auth-page.
 *
 *   • `addon.liveMount` (social-oauth): the block is SELF-SUFFICIENT (it self-fetches
 *     its data and needs no app-specific props), so we MOUNT IT LIVE — add the block
 *     import + inject the JSX inside the sign-in <main>, just below the SignInCard. The
 *     provider grid renders the configured providers (empty/disabled until auth:sso is
 *     provisioned — render-only, partial-by-design).
 *   • otherwise (cross-origin): the block needs origin/email/password the app must
 *     supply, so we emit only a COMMENTED // TODO seam — a documented mount point the
 *     app completes (never fabricated).
 *
 * Idempotent: skips if the add-on (matched by its block import) is already present, or
 * if the sign-in page is absent. The live path never half-patches — if the SignInCard
 * mount anchor moved it WARNS + falls back to the commented seam.
 */
export function emitAuthFormAddon(srcDir, fid, addon, ctx) {
  const signInPath = path.join(srcDir, 'app', 'sign-in', 'page.tsx');
  const blockName = addon.import.match(/\{ (\w+)/)?.[1] ?? 'block';
  if (!fs.existsSync(signInPath)) {
    ctx.warnings.push(
      `flow "${fid}": sign-in page not found at ${rel(signInPath)} — its add-on (${blockName}) was not mounted. ` +
        'Ensure email-password is a chosen flow (step (e) emits /sign-in) before adding auth-form add-ons.',
    );
    return;
  }
  let src = fs.readFileSync(signInPath, 'utf8');
  if (src.includes(addon.import)) {
    skip(signInPath + ` (${fid} add-on)`, ctx);
    return;
  }

  if (addon.liveMount) {
    // (1) anchor the live JSX inside <main>, right before its closing tag — the SignInCard
    // is self-closing so </main> is the stable insertion point (the add-on renders below
    // the card). Capture the indent of </main> so the injected block aligns. If the
    // sign-in page was hand-customized away from a single <main> wrapper, WARN + fall back
    // to the commented seam (never half-patch).
    const mainCloseRe = /^([ \t]*)<\/main>/m;
    const m = src.match(mainCloseRe);
    const hasSignInCard = /<SignInCard\b/.test(src);
    if (m && hasSignInCard) {
      const indent = m[1];
      const inner = indent + '  ';
      // (2) add the block import after the SignInCard import anchor (else after the first
      // import line) — the idempotency guard above already ensured it is absent.
      const cardImportRe = /^import \{ SignInCard.*\} from '@\/blocks\/auth\/sign-in-card\/sign-in-card';$/m;
      if (cardImportRe.test(src)) {
        src = src.replace(cardImportRe, (line) => `${line}\n${addon.import}`);
      } else {
        const firstImport = src.match(/^import .*$/m);
        if (firstImport) src = src.replace(firstImport[0], `${firstImport[0]}\n${addon.import}`);
      }
      // (3) inject the JSX just before </main>, indented one step inside it.
      const jsxBlock =
        `${inner}{/* FLOW ADD-ON (${fid}) — ${addon.note} */}\n` +
        `${inner}${addon.jsx}\n`;
      src = src.replace(mainCloseRe, `${jsxBlock}${indent}</main>`);
      write(signInPath, src, ctx);
      return;
    }
    ctx.warnings.push(
      `flow "${fid}": the sign-in <main>…<SignInCard/>…</main> mount anchor in ${rel(signInPath)} moved — ` +
        `${blockName} was emitted as a commented seam instead of mounted live (never half-patch). ` +
        `Mount it inside the sign-in form by hand: ${addon.jsx}`,
    );
    // fall through to the commented seam below.
  }

  // Append the seam as a trailing comment block (never altering the working JSX).
  const seam =
    `\n/*\n` +
    ` * FLOW ADD-ON (${fid}) — seam emitted by scaffold-frontend.mjs. Mount this block INSIDE the\n` +
    ` * sign-in form once its inputs are available. ${addon.note}\n` +
    ` * ${addon.import}\n` +
    ` * ${addon.jsx}\n` +
    ` */\n`;
  write(signInPath, src.replace(/\s*$/, '\n') + seam, ctx);
}

/**
 * The brief flows that carry an `org-route` FLOW_SURFACES kind (organization /
 * org-members / org-roles / org-invites / app-memberships). GENERIC — no flow id is
 * special-cased: a future org flow is just a new FLOW_SURFACES `org-route` entry. The
 * whole OrgContext (org-context.tsx, the layout OrgProvider/OrgSwitcher mount, the
 * /org index + /org/new pages) is gated on `orgRouteFlowsIn(flows).length > 0`, so a
 * non-org (owner/email) app reaches NONE of it and stays byte-identical.
 */
export function orgRouteFlowsIn(flows) {
  const orgRouteFlowIds = Object.entries(FLOW_SURFACES)
    .filter(([, s]) => s.kind === 'org-route')
    .map(([id]) => id);
  return flows.filter((f) => orgRouteFlowIds.includes(f));
}

/**
 * The ordered list of org admin sub-routes this app MOUNTS — the `routes[].sub` of every
 * chosen org-route flow, in the brief's flow order (DERIVED from FLOW_SURFACES, never a
 * hard-coded sub name). These are EXACTLY the /org/[orgId]/<sub> pages emitFlowSurfaces emits
 * (emitOrgPage iterates the same routes[]), so the first entry is a sub-route that is
 * GUARANTEED to exist — the default landing the OrgSwitcher / the /org redirect route to
 * (closing the 404'd /org/<id>/roles bug when org-roles wasn't a chosen flow). De-duped
 * (a sub can't mount twice) preserving first-seen order. Returns [] when no org-route flow is
 * chosen (e.g. an org-create-only app), in which case the switcher sets the active org without
 * navigating. The `organization` flow contributes its admin `routes[].sub` (settings) here —
 * its `surface` (/org/new, the CREATE page) is a separate static sibling, not an [orgId] sub.
 */
export function orgSubsIn(flows) {
  const subs = [];
  for (const f of flows) {
    const s = FLOW_SURFACES[f];
    if (!s || s.kind !== 'org-route') continue;
    for (const r of s.routes ?? []) {
      if (r?.sub && !subs.includes(r.sub)) subs.push(r.sub);
    }
  }
  return subs;
}

/**
 * PART E — mount <OrgProvider><OrgSwitcher/> in the authed shell (org-flow apps ONLY),
 * mirroring the wire-app.mjs idempotent provider-injection pattern:
 *   (1) stamp src/components/org-context.tsx (skip if present);
 *   (2) pre-validate the layout's <RouteGuard>…<AuthenticatedShell>{children}…</RouteGuard>
 *       anchor — if absent, WARN + skip (NEVER half-patch);
 *   (3) add `import { OrgProvider, OrgSwitcher } from '@/components/org-context';`;
 *   (4) nest INSIDE <RouteGuard> so the order becomes
 *       <RouteGuard><OrgProvider><OrgSwitcher /><AuthenticatedShell>{children}</AuthenticatedShell></OrgProvider></RouteGuard>
 *       (the switcher renders in the authed shell WITHOUT editing the base-template
 *       authenticated-shell.tsx, which stays byte-equal);
 *   (5) idempotency: skip if the layout already mentions OrgProvider.
 * The AuthenticatedShell mount carries `{children}`, so wrapping it is exactly what keeps
 * the switcher inside the authed chrome. The pre-flight matches the existing
 * `<AuthenticatedShell>{children}</AuthenticatedShell>` block verbatim.
 */
export function mountOrgContext(srcDir, ctx, orgSubs = []) {
  // (1) stamp the org-context.tsx component. Its LONE seam is `__ORG_SUBS__` — the ordered
  // list of mounted org admin sub-routes (orgSubs, derived from the brief's org flows via
  // orgSubsIn). The first entry is ORG_DEFAULT_SUB, the page the switcher / the /org redirect
  // route to — so they land on a sub that EXISTS (never a 404'd /org/<id>/roles). The value is
  // a real JS string-array literal; an EMPTY orgSubs (org-create-only app) → `[]` (the switcher
  // sets the active org without navigating). assertNoUnsubstituted then confirms no seam leaked.
  const ctxDest = path.join(srcDir, 'components', 'org-context.tsx');
  if (fs.existsSync(ctxDest)) {
    skip(ctxDest, ctx);
  } else {
    let body = readTemplate(FLOWS_TEMPLATES_DIR, 'org-context.tsx');
    const subsLiteral = '[' + orgSubs.map((s) => `'${s}'`).join(', ') + ']';
    body = body.split('__ORG_SUBS__').join(subsLiteral);
    assertNoUnsubstituted(ctxDest, body);
    write(ctxDest, body, ctx);
  }

  // (2)-(5) inject the provider/switcher into the layout.
  const layoutPath = path.join(srcDir, 'app', 'layout.tsx');
  if (!fs.existsSync(layoutPath)) {
    ctx.warnings.push(
      `org-flow shell mount: layout.tsx not found at ${rel(layoutPath)} — the OrgProvider/OrgSwitcher were not ` +
        'mounted. Wrap <AuthenticatedShell>{children}</AuthenticatedShell> with <OrgProvider><OrgSwitcher/>…</OrgProvider> by hand.',
    );
    return;
  }
  let src = fs.readFileSync(layoutPath, 'utf8');

  // (5) already wired → no-op.
  if (src.includes('OrgProvider')) {
    skip(layoutPath + ' (OrgProvider mount)', ctx);
    return;
  }

  // (2) pre-flight the anchor: the AuthenticatedShell block carrying {children} inside
  // RouteGuard. Capture the line's leading whitespace so the injected wrapper nests at the
  // SAME indent regardless of the template's tabs/spaces (no ragged JSX).
  const shellRe = /^([ \t]*)(<AuthenticatedShell>\s*\{children\}\s*<\/AuthenticatedShell>)/m;
  const shellMatch = src.match(shellRe);
  if (!shellMatch || !/<RouteGuard>/.test(src)) {
    ctx.warnings.push(
      `org-flow shell mount: the <RouteGuard>…<AuthenticatedShell>{children}</AuthenticatedShell> anchor in ${rel(layoutPath)} ` +
        'moved — the OrgProvider/OrgSwitcher were NOT injected (never half-patch). Mount them inside <RouteGuard> by hand: ' +
        '<RouteGuard><OrgProvider><OrgSwitcher /><AuthenticatedShell>{children}</AuthenticatedShell></OrgProvider></RouteGuard>.',
    );
    return;
  }

  // (3) add the import after the AuthenticatedShell import anchor (else after the first
  // import line) — idempotent guard above already ensured it is absent.
  const orgImport = "import { OrgProvider, OrgSwitcher } from '@/components/org-context';";
  const shellImportRe = /^import \{ AuthenticatedShell \} from '@\/components\/layouts\/authenticated-shell';$/m;
  if (shellImportRe.test(src)) {
    src = src.replace(shellImportRe, (m) => `${m}\n${orgImport}`);
  } else {
    // Fallback: insert after the first import statement so the import is never dangling.
    const firstImport = src.match(/^import .*$/m);
    if (firstImport) {
      src = src.replace(firstImport[0], `${firstImport[0]}\n${orgImport}`);
    } else {
      ctx.warnings.push(
        `org-flow shell mount: no import anchor in ${rel(layoutPath)} to add the org-context import — skipped (never half-patch).`,
      );
      return;
    }
  }

  // (4) nest OrgProvider/OrgSwitcher INSIDE RouteGuard, wrapping the AuthenticatedShell.
  // Use the captured indent of the AuthenticatedShell line so the wrapper aligns; the
  // shell + switcher indent one extra unit (the original indent's last char — tab or 2
  // spaces — repeated) so the nesting reads cleanly. Functional either way (JSX ignores
  // whitespace), but this keeps the emitted layout tidy + lint-friendly.
  const indent = shellMatch[1];
  const step = indent.endsWith('\t') ? '\t' : '  ';
  const inner = indent + step;
  src = src.replace(
    shellRe,
    `${indent}<OrgProvider>\n${inner}<OrgSwitcher />\n${inner}$2\n${indent}</OrgProvider>`,
  );

  write(layoutPath, src, ctx);
}

/**
 * (f) Iterate brief.flows[], mount each flow's blocks per FLOW_SURFACES, and write
 * build/flow-surfaces.json. The single entry point called from main() after step (e).
 */
export function emitFlowSurfaces(srcDir, brief, crudRoutes, ctx) {
  const flows = Array.isArray(brief.flows) ? brief.flows : [];
  if (flows.length === 0) return;

  // Where dedicated auth landings send a successful/verified user — the app's first
  // CRUD surface (mirrors step (e)'s authedRedirect).
  const routes = brief.ui?.routes ?? [];
  const authedRedirect =
    (crudRoutes[0] && crudRoutes[0].path) || (routes[0] && routes[0].path) || '/';

  // The surface manifest QA reads. Keyed by flow id.
  const surfaces = {};

  // ── OrgContext gate (PART E) — org-flow apps ONLY ─────────────────────────
  // The brief's org-route flows. When non-empty, stamp src/components/org-context.tsx
  // and mount <OrgProvider><OrgSwitcher/> in the authed shell (gated on org flows). A
  // non-org (owner/email) app has orgRouteFlows.length===0 → NONE of org-context.tsx,
  // the layout OrgProvider/OrgSwitcher mount, the [orgId] pages, or the /org redirect is
  // emitted; layout.tsx / sidebar-config.ts / app-routes.ts stay byte-identical.
  const orgRouteFlows = orgRouteFlowsIn(flows);
  if (orgRouteFlows.length > 0) {
    // The ordered mounted org admin subs (DERIVED from the chosen org flows) — stamped into
    // org-context.tsx (ORG_SUBS / ORG_DEFAULT_SUB) so the switcher + the /org redirect land on
    // a sub that EXISTS, and reused by emitOrgStaticPages for the same default.
    const orgSubs = orgSubsIn(flows);
    mountOrgContext(srcDir, ctx, orgSubs);
    emitOrgStaticPages(srcDir, ctx);
  }

  // ── account-session group → ONE aggregated /account page ──────────────────
  const accountFlows = flows.filter((f) => FLOW_SURFACES[f]?.kind === 'aggregate-account');
  if (accountFlows.length > 0) {
    const surface = emitAccountPage(srcDir, accountFlows, ctx);
    if (surface) for (const f of accountFlows) surfaces[f] = surface;

    // StepUpProvider dependency check (point 5): an account-session section (change-password,
    // sessions, api-keys, account-deletion) gates on a <StepUpProvider>. That provider is wired
    // by wire-app.mjs WHENEVER the use-step-up / step-up-provider block is installed — which the
    // `shadcn add` on-ramp does for the `step-up` flow OR when another installed block pulls
    // use-step-up in as a DEPENDENCY. So the real "provider present?" signal is the INSTALLED
    // block, not `step-up ∈ brief.flows`. Gating on flow membership false-negatived the warning
    // (warned "step-up needed but not in flows" even though use-step-up arrived as a dependency
    // and StepUpProvider IS wired). Warn ONLY when the block is genuinely absent.
    if (!stepUpBlockInstalled(srcDir)) {
      const gated = accountFlows.filter((f) => FLOW_SURFACES[f]?.needsStepUp);
      if (gated.length > 0) {
        ctx.warnings.push(
          `account flows [${gated.join(', ')}] gate on a StepUpProvider, but the use-step-up / step-up-provider ` +
            `block is not installed under ${rel(path.join(srcDir, 'blocks', 'auth', 'use-step-up'))} — wire-app.mjs ` +
            'only wraps <StepUpProvider> when that block is present (installed for the `step-up` flow, or pulled in ' +
            'as a block dependency), so the step-up gate will have no provider. Add `step-up` to the brief flows ' +
            '(or ensure a flow that depends on use-step-up is installed).',
        );
      }
    }
  }

  // ── StepUpProvider provider-ordering reconcile (the b2b crash fix) ─────────
  // Runs for ANY app with flows, INDEPENDENT of account flows: the crash-causing case is an
  // ORG app (e.g. flows [email-password, organization, org-members]) whose org block pulls in
  // use-step-up transitively, with NO account-session flow at all. wire-app.mjs wrote
  // blocks-providers.tsx at Phase 3 BEFORE that block was installed (so without <StepUpProvider>);
  // we run at Phase 7 (after install) and ensure the wrap hands-free. Internally gated on the
  // use-step-up block being on disk, so a non-step-up app (the owner canary, the public-read
  // blog) is a strict no-op — its blocks-providers.tsx stays byte-identical.
  ensureStepUpProvider(srcDir, ctx);

  // ── per-flow: dedicated routes, org routes, auth-form add-ons ──────────────
  for (const fid of flows) {
    const s = FLOW_SURFACES[fid];
    if (!s) continue; // email-password / step-up / unknown → no own surface here.

    if (s.kind === 'dedicated-route' || (s.kind === 'aggregate-account' && s.routes)) {
      // dedicated-route flows, AND the aggregate-account flow (account-deletion) that
      // ALSO ships a dedicated link-landing route. Auth landings are public.
      let lastLandingSurface = null;
      for (const r of s.routes ?? []) {
        const surface = emitDedicatedPage(srcDir, r, authedRedirect, ctx, { access: 'public' });
        // For pure dedicated-route flows the surface IS the (first) route; for the
        // aggregate-account+route case the /account section surface already won the
        // flow key, so only set it if not already mapped.
        if (!surfaces[fid]) surfaces[fid] = surface;
        // The email-link LANDING page is the LAST dedicated route (e.g. password-reset
        // ships /forgot-password THEN /reset-password — the reset page is the landing).
        lastLandingSurface = surface;
      }
      // Emit an explicit `<fid>-landing` key so the live-QA driver's
      // routeFor('<fid>-landing', …) resolves to the path the mounter ACTUALLY emitted
      // (e.g. /verify-email, /reset-password, /delete-account) instead of falling back to
      // its hard-coded /auth/<page> default (a 404 here, since the tiered template mounts
      // these at the bare route). Mounter↔driver contract fix (FLOW-QA mail2). No-op for
      // flows whose driver has no landing step — an extra key is harmless.
      if (lastLandingSurface) surfaces[`${fid}-landing`] = lastLandingSurface;
    }

    if (s.kind === 'org-route') {
      // An explicit `surface` override wins (e.g. `organization` → /org/new, the
      // org-CREATE page where its driver's testids mount — NOT a /org/[orgId]/<sub>
      // admin page). Set it FIRST so the per-route auto-assignment below can't claim
      // the flow's surface with a token-carrying [orgId] path the driver can't resolve.
      if (s.surface && !surfaces[fid]) surfaces[fid] = s.surface;
      for (const r of s.routes ?? []) {
        const surface = emitOrgPage(srcDir, r, ctx);
        if (!surfaces[fid]) surfaces[fid] = surface; // first org route is the flow's surface
      }
      // org-invites also ships a self-reading /invite landing (public).
      for (const r of s.dedicated ?? []) {
        emitDedicatedPage(srcDir, r, authedRedirect, ctx, { access: 'public' });
      }
    }

    if (s.kind === 'auth-form-addon') {
      emitAuthFormAddon(srcDir, fid, s.addon, ctx);
      // Add-ons have no own page — their "surface" is the sign-in page.
      surfaces[fid] = { path: '/sign-in', shellTestid: null };
    }
  }

  // ── write build/flow-surfaces.json (the QA SoT) ───────────────────────────
  writeFlowSurfacesManifest(brief, surfaces, ctx);
}

/**
 * Write the flow-surfaces.json manifest — the {"<flow>":{path,shellTestid}} mounter↔driver
 * contract the live-QA driver (RECON-2) reads to find each flow's surface instead of
 * re-deriving it. Written to BOTH the LEGACY singleton build/flow-surfaces.json AND the
 * per-app build/<db_name>/flow-surfaces.json (RECON-3 per-app state) so an APP_ID-scoped
 * live-QA run (which reads build/<app-id>/ first) picks up THIS app's surfaces and not a
 * stale sibling's. live-qa.mjs resolves per-app-first then legacy. Always rewritten (a
 * generated index, deterministic from the brief). No-op in --dry-run.
 */
export function writeFlowSurfacesManifest(brief, surfaces, ctx) {
  const payload = {
    _README:
      'GENERATED by scripts/scaffold-frontend.mjs (step f, flow-block mounting). Maps each brief flow id ' +
      'to the app surface its blocks were mounted at: { path, shellTestid }. The live-QA driver ' +
      '(scripts/live-qa.mjs, RECON-2) reads this to navigate to the right surface (override per-flow with ' +
      'LIVE_QA_ROUTE_<FLOW>). shellTestid is the APP-controlled testid to wait on (null ⇒ the page mounts the ' +
      "block bare; wait on the block's own testid).",
    app: brief.app?.id ?? brief.naming?.db_name ?? null,
    flows: surfaces,
  };
  const body = JSON.stringify(payload, null, 2) + '\n';
  // LEGACY singleton (unchanged) + the per-app copy keyed by naming.db_name (the same
  // APP_ID convention golden-path.sh/genericity-check.sh derive). De-dup if they collide.
  const targets = new Set([path.join(BUILD_DIR, 'flow-surfaces.json')]);
  const appId = brief.naming?.db_name;
  if (appId) targets.add(path.join(BUILD_DIR, appId, 'flow-surfaces.json'));
  for (const manifestPath of targets) {
    ctx.written.push(manifestPath);
    if (ctx.dryRun) continue;
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, body);
  }
}
