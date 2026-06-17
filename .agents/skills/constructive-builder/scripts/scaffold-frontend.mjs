#!/usr/bin/env node
/**
 * scripts/scaffold-frontend.mjs <brief> <appDir>
 *
 * Brief → the per-entity domain UI, AFTER Phase-3 codegen has produced the typed
 * SDK hooks (@sdk/app). Runs at PHASE 4 (see scaffold-app.mjs for the staging).
 *
 * It does SIX things, each independently idempotent (re-running is a safe no-op):
 *   (a) CRUD INFRA (once) — stamps the runtime-generic meta-form stack from
 *       scripts/templates/frontend/crud/* into <app>/src/{components/crud,lib/meta,types}.
 *       This is the REUSE: DynamicFormCard / useMeta / DynamicField are schema-driven
 *       (introspect `_meta` at runtime) — NOT a bespoke per-table form. The two
 *       `__APP_ENDPOINT__` placeholders are rewired to the app's runtime
 *       `getEndpoint('app')` (the per-DB app-public endpoint) so nothing bakes a URL.
 *       DynamicFormCard's Delete affordance is delete-mode-aware: a HARD delete when
 *       the table exposes a root delete mutation, else a SOFT delete (an UPDATE that
 *       sets the DataSoftDelete `is_deleted` flag) for soft-delete tables — so the
 *       Delete button never vanishes just because a table is soft-delete.
 *   (b) ENTITY PAGES — per `ui.routes[].kind: crud`, emits a thin
 *       <app>/src/app/<entity>/page.tsx from templates/frontend/entity-page.tsx:
 *       a typed quick-add + list (the codegen'd SDK hooks) plus DynamicFormCard on
 *       the CRUD Stack for edit/detailed-create. The entity name → SDK hook names +
 *       generic `<entity>-*` testids. `entity: todo` reproduces the canary's
 *       `todo-*` testids with ZERO special-casing.
 *   (c) ROUTES + NAV — idempotently appends a route entry to src/app-routes.ts
 *       (APP_ROUTES, access:'protected', context:'app') and a NavItem to
 *       src/lib/navigation/sidebar-config.ts. Skips entries already present.
 *   (d) NON-CRUD STUBS — kind: dashboard|detail|custom → a stub page with a
 *       `// TODO: custom UI — build with @constructive-io/ui; see constructive-frontend`
 *       seam + the route entry. (No nav item unless it is a primary surface.)
 *   (e) AUTH BRIDGE PAGES — when `flows` include `email-password`, emits the
 *       /sign-in + /sign-up route wrappers (the block→route + host-token-persist
 *       bridge) from templates/frontend/auth-page.tsx.
 *   (f) FLOW-BLOCK MOUNTING — the #1 harness fix. The Blocks on-ramp installs each
 *       flow's blocks as COMPONENTS, but nothing mounts them at a reachable,
 *       testid-carrying Next route — so a multi-flow app provisions auth/account/org
 *       capability that is unreachable from the UI. Step (f) closes that GENERICALLY:
 *       driven by FLOW_SURFACES (which mirrors references/flows.json) + the brief's
 *       flows[], it aggregates the account-session blocks onto ONE /account page,
 *       mounts each authorization flow at a /org/<sub> route, stamps the dedicated
 *       link-landing pages (verify-email / reset-password / delete-account / invite,
 *       skipped when the base template already ships them), seams the auth-form
 *       add-ons (cross-origin / social-oauth) into /sign-in, and writes
 *       build/flow-surfaces.json (the surface manifest the live-QA driver reads).
 *       Component names / import paths / props are sourced VERBATIM from each flow's
 *       howto.usage. Everything is GATED on the flow being in brief.flows, so the
 *       canary (flows: [email-password]) emits ZERO new pages.
 *
 * Auth/account/org UI is the Blocks on-ramp (scripts/wire-app.mjs + `shadcn add` of
 * the flow's blocks); this scaffolder owns the domain-entity surface (a–d) AND, via
 * step (f), the block→route MOUNTING that makes those installed blocks reachable. It
 * does NOT re-implement the blocks — it mounts the registry blocks the on-ramp adds.
 *
 * GENERIC BY CONSTRUCTION. Everything is read from the brief. Nothing here
 * hard-codes `todo`/`todos` (or any domain) as a value — the per-entity emission
 * derives every identifier (hook names, testids, the `_meta` table type, route key,
 * nav label) from `ui.routes[].entity` + the matching `data_model.tables[]`, and the
 * flow mounting derives every surface from `flows[]` + FLOW_SURFACES (no flow id is
 * special-cased; adding a flow = adding a FLOW_SURFACES entry).
 *
 * Usage:
 *   node scripts/scaffold-frontend.mjs build/app-brief.yaml ./my-app
 *   node scripts/scaffold-frontend.mjs build/app-brief.yaml ./my-app --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadBrief, BriefError } from './lib/brief.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, 'templates', 'frontend');
const CRUD_TEMPLATES_DIR = path.join(TEMPLATES_DIR, 'crud');
const FLOWS_TEMPLATES_DIR = path.join(TEMPLATES_DIR, 'flows');

// ════════════════════════════════════════════════════════════════════════════
// Inflection — singular `entity` (kebab/snake/lower) → the identifiers the SDK +
// _meta + testids use. Deliberately a small, legible English pluralizer scoped to
// the common table-name shapes (no irregular-noun table) — matches how the
// platform's GraphQL inflection names list hooks (`company` → `companies`).
// ════════════════════════════════════════════════════════════════════════════

/** Split an identifier on -, _, space, or camelCase boundaries → lowercase words. */
function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** kebab/snake/camel → PascalCase (e.g. blog-post → BlogPost). */
function pascal(name) {
  return words(name).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** kebab/snake/camel → camelCase (e.g. blog-post → blogPost). */
function camel(name) {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** kebab/lower form for the data-testid prefix (e.g. BlogPost → blog-post). */
function kebab(name) {
  return words(name).join('-');
}

/** Human heading from the route label, falling back to a Title-Cased entity. */
function titleCase(name) {
  return words(name).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * English pluralize the LAST word of an identifier, preserving the rest.
 *   y→ies (consonant+y), (s|x|z|ch|sh)→es, default +s.
 * Operates on the word list so `blog-post` → `blog-posts` (only the tail inflects).
 */
function pluralizeWords(name) {
  const ws = words(name);
  if (ws.length === 0) return [];
  const last = ws[ws.length - 1];
  let plural;
  if (/[^aeiou]y$/.test(last)) plural = last.slice(0, -1) + 'ies';
  else if (/(s|x|z|ch|sh)$/.test(last)) plural = last + 'es';
  else plural = last + 's';
  return [...ws.slice(0, -1), plural];
}

function wordsToPascal(ws) {
  return ws.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
function wordsToCamel(ws) {
  const p = wordsToPascal(ws);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** All the per-entity identifiers, derived from the singular `entity` token. */
function entityIdentifiers(entity) {
  const pluralWords = pluralizeWords(entity);
  return {
    EntitiesPascal: wordsToPascal(pluralWords), // list hook: use<Entities>Query  (Todos / Contacts)
    entitiesCamel: wordsToCamel(pluralWords), // data accessor: data.<entities>   (todos / contacts)
    // create hook: use__Create_Entity__Mutation expands to useCreate<Entity>Mutation —
    // the `Create` is part of the value (the template literal is `use__Create_Entity__Mutation`).
    CreateEntityPascal: 'Create' + pascal(entity),
    EntityPascal: pascal(entity), // DynamicFormCard tableName (the _meta type)  (Todo / Contact)
    entityKebab: kebab(entity), // data-testid prefix  (todo / contact / blog-post)
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CODEGEN-ACTUAL COLUMN NAMES (SG-A for COLUMNS) — derive every emitted column field
// name from what CODEGEN produced, not from the brief.
//
// SG-A already derives the TABLE-facing identifiers (hooks / data accessor / `_meta`
// tableName) from the table NAME so the page imports the REAL codegen'd hooks. The
// SAME hazard exists one level down, on COLUMNS: the platform's construct_blueprint can
// emit a column under a name that does NOT equal the brief's `camel(field_name)` — e.g.
// it strips the `_` before a single-char trailing segment, so the brief column
// `elevation_m` deploys (and codegens) as `elevationm`, `temperature_c` as
// `temperaturec`, while a multi-char trailing segment (`area_sqm`) survives as `areaSqm`.
// Emitting the brief-derived camelCase (`elevationM` / `temperatureC`) then breaks tsc
// (the SDK row/input type has no such member). The fix MIRRORS SG-A: read the names
// codegen ACTUALLY produced and use those — for EVERY column — so ANY platform name
// transformation is transparent. There is NO mangling rule encoded here; we never
// special-case `_<char>` — we just adopt whatever codegen wrote.
//
// SOURCE = the generated SDK row interfaces in `@sdk/app`'s types.ts
// (<src>/graphql/sdk/app/types.ts), which codegen emits at Phase 3 — BEFORE this
// scaffolder runs at Phase 4. Each table is one `export interface <EntityPascal> { … }`
// whose members are the codegen-actual camelCase column names (the SAME EntityPascal the
// page already uses for the `_meta` tableName, so the lookup key is free). When that file
// is ABSENT (the codegen-free dry-run / the rot-canaries, which scaffold into a bare temp
// src/ with no SDK) the resolver returns null and EVERY caller falls back to the
// brief-derived `camel()` name — so a non-mangled brief (every canary fixture) stamps
// BYTE-IDENTICALLY and the genericity proof holds.
// ════════════════════════════════════════════════════════════════════════════

/** Normalize a camel/identifier to its mangling-insensitive key: lowercase, alnum only.
 *  `elevationM` → `elevationm`, codegen `elevationm` → `elevationm` (they collapse to the
 *  same key); `areaSqm` ↔ `areaSqm` likewise. This is what lets a brief-derived name match
 *  whatever codegen wrote WITHOUT encoding the platform's transform. */
function normalizeColKey(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Parse the generated SDK `types.ts` once → Map<EntityPascal, string[] memberNames>.
 *  Each `export interface <Name> { a: …; b: …; }` block contributes its member identifiers
 *  (the codegen-actual column names). Tolerant: a missing/unreadable file → empty Map (every
 *  caller then falls back to the brief name). Cached on `ctx` so we read the file at most once
 *  per scaffold run. */
function codegenInterfaces(srcDir, ctx) {
  if (ctx && ctx._codegenIfaces) return ctx._codegenIfaces;
  const map = new Map();
  // @sdk/app → <src>/graphql/sdk/app (see the app tsconfig `paths`); types.ts holds the rows.
  const typesPath = path.join(srcDir, 'graphql', 'sdk', 'app', 'types.ts');
  let text = '';
  try {
    text = fs.readFileSync(typesPath, 'utf8');
  } catch {
    if (ctx) ctx._codegenIfaces = map;
    return map; // no SDK yet (dry-run / canary) — callers fall back to the brief name.
  }
  // Match each `export interface <Name> { … }` body, then pull the `member:` identifiers.
  const ifaceRe = /export\s+interface\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = ifaceRe.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    const members = [];
    const memRe = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g;
    let mm;
    while ((mm = memRe.exec(body)) !== null) members.push(mm[1]);
    if (members.length) map.set(name, members);
  }
  if (ctx) ctx._codegenIfaces = map;
  return map;
}

/**
 * A per-table column remapper: given the codegen interface for `EntityPascal`, return a
 * function naive→actual that maps a brief-derived camelCase column name to the name codegen
 * ACTUALLY emitted. Resolution:
 *   • exact hit  — the naive name IS a codegen member (the common, non-mangled case) → unchanged.
 *   • unique normalized hit — exactly ONE codegen member shares the naive name's
 *     mangling-insensitive key (normalizeColKey) → adopt that codegen member (e.g. naive
 *     `elevationM` → codegen `elevationm`). The single-match guard means we never guess when a
 *     normalization is ambiguous.
 *   • otherwise   — return the naive name unchanged (no SDK / unknown column / ambiguous) so
 *     behavior degrades to today's brief-derived name (canary byte-identical).
 * GENERIC: derives purely from the codegen output; encodes no entity/column literal and no
 * `_<char>` mangling rule — it adopts whatever codegen wrote, so any platform name transform
 * (this one or a future one) is handled the same way.
 */
function makeColMapper(srcDir, EntityPascal, ctx) {
  const ifaces = codegenInterfaces(srcDir, ctx);
  const members = ifaces.get(EntityPascal) || null;
  if (!members || members.length === 0) {
    return (naive) => naive; // codegen-free (dry-run/canary) or table not in the SDK → brief name.
  }
  const exact = new Set(members);
  // Build the normalized index, but only keep keys that map to a UNIQUE member (so an
  // ambiguous normalization never silently rewrites to the wrong column).
  const byNorm = new Map();
  const ambiguous = new Set();
  for (const mem of members) {
    const k = normalizeColKey(mem);
    if (byNorm.has(k)) ambiguous.add(k);
    else byNorm.set(k, mem);
  }
  return (naive) => {
    if (exact.has(naive)) return naive; // codegen has this exact name — nothing to remap.
    const k = normalizeColKey(naive);
    if (!ambiguous.has(k) && byNorm.has(k)) return byNorm.get(k); // adopt the codegen-actual name.
    return naive; // unknown/ambiguous — fall back to the brief name (unchanged behavior).
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FLOW SURFACES — the flow → block-mount map (step (f), the flow-block mounting).
//
// scaffold-frontend ONLY owns the domain-entity surface (steps a–e). The Blocks
// on-ramp (scripts/wire-app.mjs + `shadcn add`) installs each flow's blocks AS
// COMPONENTS, but nothing mounts them at a reachable, testid-carrying Next route —
// so a multi-flow app provisions auth/account/org capability that is unreachable
// from the UI (the #1 harness bug). Step (f) closes that gap GENERICALLY: it reads
// the brief's flows[] and, for each, mounts the flow's blocks on a real surface.
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

const ACCOUNT_PATH = '/account';
const ACCOUNT_SHELL_TESTID = 'account-page';

const FLOW_SURFACES = {
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
function accountSessionStepUpFlows() {
  return Object.entries(FLOW_SURFACES)
    .filter(([, s]) => s.group === 'account-session' && s.needsStepUp)
    .map(([id]) => id);
}

/**
 * Whether the use-step-up / step-up-provider BLOCK is installed under the app — the
 * SAME signal wire-app.mjs uses to decide whether to wrap children in <StepUpProvider>
 * (blockFileExists(['auth','use-step-up','step-up-provider'])). The `shadcn add` on-ramp
 * installs use-step-up either because `step-up` is a chosen flow OR because another
 * installed block declares it as a DEPENDENCY — in BOTH cases StepUpProvider IS wired, so
 * a step-up-gated section has its provider. We therefore gate the step-up warning on the
 * ABSENCE of this block (the real wiring signal), not on `step-up ∈ brief.flows` (which
 * misses the dependency-install case → a false-negative warning). Tolerates the .tsx/.ts
 * extension the registry emits. Returns false pre-install (block dir not yet present).
 */
function stepUpBlockInstalled(srcDir) {
  const base = path.join(srcDir, 'blocks', 'auth', 'use-step-up', 'step-up-provider');
  return fs.existsSync(base + '.tsx') || fs.existsSync(base + '.ts');
}

// The import specifiers for the two blocks the providers wrapper mounts — the SAME
// strings wire-app.mjs uses (RUNTIME_SPEC / STEPUP_SPEC), so the reconciled file below
// is byte-identical to what wire-app emits for a step-up-installed app.
const BLOCKS_RUNTIME_SPEC = '@/blocks/runtime/blocks-runtime';
const STEP_UP_PROVIDER_SPEC = '@/blocks/auth/use-step-up/step-up-provider';

/**
 * The canonical `blocks-providers.tsx` body for an app whose installed blocks include
 * use-step-up — i.e. wraps children in <StepUpProvider>. This string MUST stay
 * BYTE-IDENTICAL to wire-app.mjs's `providersBody` for the `stepUpInstalled === true`
 * case (see wire-app.mjs step (d)), so that after this reconcile a later `node
 * scripts/wire-app.mjs` run detects an in-sync wrapper and no-ops (its idempotency
 * guard matches /<StepUpProvider[\s>]/). If you change wire-app's providers body, change
 * this in lockstep. We reproduce it (rather than import wire-app) because wire-app is a
 * CLI with top-level side effects (arg parse / die / dynamic port allocation + run-state
 * write); importing it to reuse one string would re-run all of that.
 */
function stepUpProvidersBody() {
  return `'use client';

import type { ReactNode } from 'react';
import { BlocksRuntime } from '${BLOCKS_RUNTIME_SPEC}';
import { StepUpProvider } from '${STEP_UP_PROVIDER_SPEC}';
import { TokenManager } from '@/lib/auth/token-manager';

// Owns the getToken closure on the client side, so layout.tsx (a Server Component) never passes
// a function across the server→client boundary (gotchas BLOCKS-009). BlocksRuntime owns the
// 'auth' + 'admin' namespaces (configures each + attaches Authorization per request via getToken);
// AppProvider still owns 'app'. StepUpProvider wraps children (the use-step-up block is installed).
// Generated by scripts/wire-app.mjs.
export function BlocksProviders({ children }: { children: ReactNode }) {
  return (
    <BlocksRuntime
      namespaces={['auth', 'admin']}
      getToken={() => TokenManager.getToken('admin').token?.accessToken}
    >
      <StepUpProvider>{children}</StepUpProvider>
    </BlocksRuntime>
  );
}
`;
}

/**
 * STEP-UP PROVIDER RECONCILE (the b2b provider-ordering fix). wire-app.mjs writes
 * src/components/blocks-providers.tsx at Phase 3, BEFORE `shadcn add` installs the flow's
 * blocks (Phase 5). So when an installed block TRANSITIVELY pulls in use-step-up (e.g. the
 * org members/roles/invite/app-membership blocks call useStepUp() at render), the file
 * wire-app wrote does NOT wrap <StepUpProvider> — and nothing re-wraps it after the block
 * lands, so useStepUp() throws at runtime and the org page crashes. scaffold-frontend runs
 * at Phase 7 (AFTER the blocks are installed), so HERE we can detect the installed block and
 * ensure the wrapper hands-free.
 *
 * Detection is by the INSTALLED block on disk (stepUpBlockInstalled — the SAME signal
 * wire-app uses), NOT by brief.flows: the crash-causing case has NO `step-up` flow and NO
 * step-up-gated account section — use-step-up arrives purely as a block DEPENDENCY of an org
 * block. Gating on flows would miss it. This is exactly wire-app's own reconcile semantics
 * (re-write when the desired StepUpProvider wrapping differs from what's on disk), mirrored
 * here as the documented fallback to invoking wire-app (whose other side effects — env writes,
 * dynamic port re-allocation + run-state rewrite — must not re-fire at Phase 7).
 *
 * Idempotent + contained:
 *   • No use-step-up block on disk → no-op (so a non-step-up app — the owner canary, the
 *     public-read blog — is NEVER given a StepUpProvider; blocks-providers.tsx stays byte-equal).
 *   • File missing → WARN (wire-app owns CREATING it at Phase 3); we never fabricate it here.
 *   • Already wraps <StepUpProvider> → skip (no change).
 *   • Has BlocksRuntime but no wrapper → re-write to the canonical step-up body (a full
 *     overwrite, exactly as wire-app's reconcile does).
 *   • No BlocksRuntime (unexpected shape) → WARN, leave untouched (never half-patch).
 */
function ensureStepUpProvider(srcDir, ctx) {
  // GATE: only act when the use-step-up block is actually installed. This is the lone guard
  // that keeps the canary + blog byte-identical (they install no step-up-needing block).
  if (!stepUpBlockInstalled(srcDir)) return;

  const providersPath = path.join(srcDir, 'components', 'blocks-providers.tsx');
  if (!fs.existsSync(providersPath)) {
    ctx.warnings.push(
      `step-up provider reconcile: the use-step-up block is installed but ${rel(providersPath)} is missing — ` +
        'wire-app.mjs (Phase 3) creates the BlocksProviders wrapper; run it (node scripts/wire-app.mjs --app <app> --sub <db>) ' +
        'so the StepUpProvider wrap can be applied. An org/step-up block calls useStepUp() at render and will throw without it.',
    );
    return;
  }

  const existing = fs.readFileSync(providersPath, 'utf8');
  // Match the JSX WRAPPER tag, not any mention of the word (the no-step-up file's comment
  // literally says "StepUpProvider is omitted…", which a bare /StepUpProvider/ would
  // false-positive on — the regression wire-app's guard also avoids). Same regex as wire-app.
  if (/<StepUpProvider[\s>]/.test(existing)) {
    skip(providersPath + ' (StepUpProvider already wrapped)', ctx);
    return;
  }
  if (!/BlocksRuntime/.test(existing)) {
    ctx.warnings.push(
      `step-up provider reconcile: ${rel(providersPath)} has no BlocksRuntime wrapper (unexpected shape) — left untouched ` +
        '(never half-patch). Re-run wire-app.mjs to regenerate it, or wrap children in <StepUpProvider> by hand.',
    );
    return;
  }
  // Re-write to the canonical step-up-installed body (byte-identical to wire-app's), so the
  // installed org/step-up block's useStepUp() has its provider. Full overwrite mirrors
  // wire-app's reconcile. write() respects --dry-run (records, writes nothing in dry-run).
  write(providersPath, stepUpProvidersBody(), ctx);
}

// ════════════════════════════════════════════════════════════════════════════
// App-dir detection — mirror verify-phase.sh app_rel(): the app may live at
// <appDir>/app OR <appDir>/packages/app (the pgpm nextjs template nests it).
// Returns the `src` dir (the canonical app source root).
// ════════════════════════════════════════════════════════════════════════════

function resolveAppSrc(appDir) {
  const candidates = [
    path.join(appDir, 'app', 'src'),
    path.join(appDir, 'packages', 'app', 'src'),
    path.join(appDir, 'src'), // appDir already points at the app package
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Default to packages/app/src (the template's nested layout) so a fresh dir
  // still gets a deterministic target; the caller wires this at Phase 4 when the
  // scaffold already exists, so this branch is the genuinely-empty fallback.
  return path.join(appDir, 'packages', 'app', 'src');
}

// ════════════════════════════════════════════════════════════════════════════
// Writers
// ════════════════════════════════════════════════════════════════════════════

function readTemplate(dir, name) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

function write(filePath, content, ctx) {
  ctx.written.push(filePath);
  if (ctx.dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function skip(filePath, ctx) {
  ctx.skipped.push(filePath);
}

/**
 * (a) Stamp the runtime-generic CRUD infra ONCE. Rewrites the two
 * `__APP_ENDPOINT__` placeholders to the app's runtime endpoint resolver
 * (getEndpoint('app')) so the meta-form stack hits the per-DB app-public endpoint
 * with no baked URL. Idempotent: skips files already present.
 */
function stampCrudInfra(srcDir, ctx) {
  const targets = [
    // template-name, destination (relative to src)
    ['meta-types.ts', path.join('types', 'meta.ts')],
    ['field-renderer.ts', path.join('lib', 'meta', 'field-renderer.ts')],
    ['use-meta.ts', path.join('lib', 'meta', 'use-meta.ts')],
    ['dynamic-field.tsx', path.join('components', 'crud', 'dynamic-field.tsx')],
    ['dynamic-form-card.tsx', path.join('components', 'crud', 'dynamic-form-card.tsx')],
  ];

  for (const [tpl, rel] of targets) {
    const dest = path.join(srcDir, rel);
    if (fs.existsSync(dest)) {
      skip(dest, ctx);
      continue;
    }
    let body = readTemplate(CRUD_TEMPLATES_DIR, tpl);
    body = rewireEndpoint(body);
    write(dest, body, ctx);
  }
}

/**
 * Rewire the `__APP_ENDPOINT__` endpoint constant to the app's runtime resolver.
 *
 * The boilerplate already resolves the per-DB app-public GraphQL endpoint at
 * runtime (UI override → NEXT_PUBLIC_APP_ENDPOINT → api-<db>.localhost) via
 * getEndpoint('app') in @/app-config — there is NO single static URL to bake. So
 * instead of substituting a literal, we swap the placeholder const for a call to
 * that resolver. This keeps the CRUD infra portable across every app/db without a
 * codegen step, and stays correct under endpoint overrides.
 *
 * If a future template variant pins a literal endpoint instead, set
 * SCAFFOLD_APP_ENDPOINT and we substitute that verbatim (escape hatch).
 */
function rewireEndpoint(body) {
  const literal = process.env.SCAFFOLD_APP_ENDPOINT;
  if (literal) {
    return body.replace(/__APP_ENDPOINT__/g, literal);
  }
  // Replace the declaration line with a runtime-resolved getter. The const name
  // (APP_ENDPOINT) and every use site stay valid; only its value changes from a
  // baked string to a function call.
  const decl = /const APP_ENDPOINT = '__APP_ENDPOINT__';/;
  if (decl.test(body)) {
    body = body.replace(
      decl,
      "import { getEndpoint } from '@/app-config';\n" +
        '// The per-DB app-public GraphQL endpoint, resolved at runtime (UI override →\n' +
        '// NEXT_PUBLIC_APP_ENDPOINT → api-<db>.localhost). No baked URL — see scaffold-frontend.mjs.\n' +
        "const APP_ENDPOINT = getEndpoint('app');",
    );
  } else if (body.includes('__APP_ENDPOINT__')) {
    // Shape drifted (the decl line moved). Fail loud rather than ship a literal
    // placeholder into the app — the caller can set SCAFFOLD_APP_ENDPOINT.
    throw new Error(
      'scaffold-frontend: a crud template still contains __APP_ENDPOINT__ but the ' +
        "`const APP_ENDPOINT = '__APP_ENDPOINT__';` anchor moved. Restore the anchor in " +
        'scripts/templates/frontend/crud/* or set SCAFFOLD_APP_ENDPOINT to a literal endpoint.',
    );
  }
  return body;
}

/**
 * The label field to SHOW for a parent row in an FK picker (SG-6): the first REQUIRED
 * text field of the parent table, else a conventional slug/name/title/label text field,
 * else any text field, else null (→ the picker falls back to the raw id). Derived ONLY
 * from the parent table's `data_model.tables[].fields` so the key is a guaranteed-real
 * column, and inflected camelCase to match the SDK/_meta (first_name → firstName).
 * GENERIC: this is the same priority pickTitleField uses for the OWN row label, applied to
 * the PARENT — no entity/column is hard-coded.
 */
function labelFieldFor(parentTable, mapCol = (n) => n) {
  const fields = parentTable?.fields ?? [];
  const isText = (f) => !f.type || f.type.name === 'text' || f.type.name === 'citext';
  const requiredText = fields.find((f) => f.required && isText(f) && f.name !== 'slug');
  if (requiredText) return mapCol(camel(requiredText.name));
  const conventional = fields.find((f) => isText(f) && ['slug', 'name', 'title', 'label'].includes(camel(f.name)));
  if (conventional) return mapCol(camel(conventional.name));
  const anyText = fields.find((f) => isText(f) && f.name !== 'slug');
  if (anyText) return mapCol(camel(anyText.name));
  return null;
}

/**
 * EVERY belongs-to FK on one table — the FK-picker input. Reads brief.data_model.relations
 * and keeps every RelationBelongsTo whose source_table is THIS table, REQUIRED or OPTIONAL,
 * including SELF-REFERENTIAL ones (target == source). Earlier only REQUIRED non-self FKs
 * got a picker; optional + self-ref FKs fell through to a bare raw-UUID text box (SG-1).
 * Now all render the SAME <select> picker (optional ones simply allow the empty choice and
 * stay out of the submit guard).
 * Each result describes one FK select:
 *   fkKey       — the FK input key (field_name `topic_id` → `topicId`), MAPPED to the
 *                 codegen-actual column name (a mangled FK column → its real SDK member); the
 *                 key spread into the create AND the base for every per-FK var name (unique
 *                 because a column name is unique on the table). The common `<parent>_id` shape
 *                 is multi-char so it is never mangled (childfk canary unchanged), but deriving
 *                 it from codegen keeps it correct for ANY FK column name.
 *   FkKeyPascal — PascalCase fkKey (`TopicId`) → the setter name `set<FkKeyPascal>`.
 *   fkKebab     — FK-column kebab (field_name minus a trailing _id, underscores → dashes):
 *                 the UNIQUE <fkColumn> half of the testid <entity>-<fkColumn>-select. Keyed
 *                 on the COLUMN, not the parent entity, so two FKs to the SAME parent
 *                 (author_id/reviewer_id → users) get DISTINCT testids. For the common
 *                 <parent>_id shape this equals the parent-entity kebab (topic_id → topic),
 *                 so the canary/childfk testids are unchanged.
 *   required    — true for a NON-NULL parent FK (drives the submit guard + non-empty default).
 *   selfRef     — true when target_table == source_table (the self-ref tree case).
 *   labelField  — the parent's display field (SG-6) or null (→ show the id).
 *   parentLabel — human parent label for the empty-state ("No Topics yet").
 *   ids         — entityIdentifiers(singular(target_table)): the PARENT's list-hook name
 *                 (use<EntitiesPascal>Query), data accessor (<entitiesCamel>), and testid
 *                 prefix (<entityKebab>, the <parentEntity> half of the testid).
 * Returns [] when the table has no belongs-to FK (the canary path).
 */
function belongsToFks(brief, table, srcDir = null, ctx = null) {
  const relations = brief?.data_model?.relations ?? [];
  const tables = brief?.data_model?.tables ?? [];
  // Codegen-actual column mapper for THIS (child) table — used for the FK input key.
  const childEntity = singularFromTable(table?.name) || kebab(table?.name || '');
  const childMapCol = srcDir
    ? makeColMapper(srcDir, entityIdentifiers(childEntity).EntityPascal, ctx)
    : (n) => n;
  const out = [];
  for (const r of relations) {
    if (r?.$type !== 'RelationBelongsTo') continue;
    if (r.source_table !== table?.name) continue;
    if (!r.field_name || !r.target_table) continue;
    // FK input key → the codegen-actual name (SG-A for columns). The setter/var names derive
    // from the SAME (possibly remapped) key so they stay consistent JS identifiers.
    const fkKey = childMapCol(camel(r.field_name));
    const parentSingular = singularFromTable(r.target_table) || kebab(r.target_table);
    const parentTable = tables.find((t) => t.name === r.target_table) || null;
    // The parent's label field must be selected by ITS codegen-actual name → the parent table's
    // own mapper (a different interface than the child's).
    const parentMapCol = srcDir
      ? makeColMapper(srcDir, entityIdentifiers(parentSingular).EntityPascal, ctx)
      : (n) => n;
    out.push({
      fkKey,
      FkKeyPascal: pascal(fkKey),
      fkKebab: r.field_name.replace(/_id$/, '').replace(/_/g, '-'),
      required: r.is_required === true,
      selfRef: r.target_table === r.source_table,
      labelField: labelFieldFor(parentTable, parentMapCol),
      parentLabel: titleCase(parentSingular),
      ids: entityIdentifiers(parentSingular),
    });
  }
  return out;
}

/**
 * Build the five entity-page FK seams for a table's belongs-to FKs (REQUIRED, OPTIONAL, and
 * SELF-REFERENTIAL — all render the same picker; SG-1).
 * `entityKebab` is the CHILD entity's testid prefix (the <entity> half of the contract
 * testid <entity>-<fkColumn>-select); each FK's fkKebab is the <fkColumn> half. EVERY seam is
 * the empty string when `fks` is empty — that is what keeps the no-FK canary byte-identical.
 * The two WHOLE-LINE seams (parentHookImport / parentFkHook) begin with a leading '\n' when
 * non-empty and are placed in the template with no line of their own, so the empty case leaves
 * no stray blank line; the three mid-expression/JSX seams carry their own leading separator
 * (', ' / ' || ' / '\n') exactly like the existing __CREATE_EXTRA__ seam. Per-FK variables are
 * keyed by the unique fkKey so multiple FKs (or two FKs to the same parent) never collide;
 * duplicate parent imports are de-duped.
 *
 * REQUIRED vs OPTIONAL/SELF-REF (the SG-1 split):
 *   • REQUIRED FK — defaults to the first parent once loaded (so a child create always has a
 *     parent), is unconditionally spread into the create, and adds a submit guard (` || !fk`).
 *     This path is BYTE-IDENTICAL to the prior required-only behavior (the childfk canary).
 *   • OPTIONAL / SELF-REF FK — no non-empty default (the empty choice is valid → the column
 *     stays NULL), an extra "— none —" option to clear it, NO submit guard, and the create key
 *     is spread CONDITIONALLY (`...(fk ? { fk } : {})`) so an unset optional FK is omitted from
 *     the mutate rather than sent as ''. A self-ref FK reads the SAME table's list (it is just a
 *     belongs-to onto its own table), so no special hook is needed.
 *
 * LABEL (SG-6): each FK fetches its parent's labelField (when one exists) alongside id and
 * renders it as the <option> TEXT (value stays the id) — so the picker shows a human name, not
 * a raw UUID. When the parent has no text label the picker falls back to the id.
 *
 * `ownListHook` is the page's OWN list-hook name (the table-derived use<Entities>Query the
 * template already imports). A SELF-REF FK's parent IS the page's own table, so its import is
 * SKIPPED to avoid a duplicate-import TS error — the FK hook block reuses the already-imported
 * hook. Pass null to import every FK's hook (no own-hook to de-dupe against).
 */
function buildFkSeams(entityKebab, fks = [], ownListHook = null) {
  if (!Array.isArray(fks) || fks.length === 0) {
    return { parentHookImport: '', parentFkHook: '', fkSelectJsx: '', createFkExtra: '', submitGuard: '' };
  }

  // (1) parent list-hook imports — mirror the page's own `} from '@sdk/app';` shape.
  // De-dupe by hook name so two FKs to the same parent table don't redeclare the import, AND
  // EXCLUDE the page's OWN list hook (`ownListHook`): a SELF-REF FK (or any FK onto the page's
  // own table) reads the list the template already imports at the top, so re-importing it here
  // would be a DUPLICATE-import TS error (TS2300). The self-ref FK hook block reuses that hook.
  const importLines = [
    ...new Set(
      fks
        .map((fk) => `use${fk.ids.EntitiesPascal}Query`)
        .filter((hook) => hook !== ownListHook)
        .map((hook) => `import { ${hook} } from '@sdk/app';`),
    ),
  ];
  const parentHookImport = importLines.length ? '\n' + importLines.join('\n') : '';

  // (2) parent FK hooks — one block per FK: fetch the parent list (id + the label field when
  // one exists; SG-6), hold the user's choice in state, and — for REQUIRED FKs — DEFAULT to the
  // first parent once loaded (no useEffect — a derived `<fkKey>` const, so the `react` import
  // stays `{ useState }`). An OPTIONAL/self-ref FK leaves the choice empty (NULL is valid).
  const hookBlocks = fks.map((fk) => {
    const choice = `${fk.fkKey}Choice`;
    const options = `${fk.fkKey}Options`;
    const labelSel = fk.labelField ? `id: true, ${fk.labelField}: true` : 'id: true';
    const kindNote = fk.selfRef
      ? 'optional self-ref belongs-to FK (the tree parent); NULL is valid'
      : fk.required
        ? 'required belongs-to FK; default to the first parent once loaded'
        : 'optional belongs-to FK; NULL is valid (no default)';
    const valueExpr = fk.required ? `${choice} || ${options}[0]?.id || ''` : choice;
    return [
      `  // ${fk.fkKey} — ${kindNote}.`,
      `  const ${fk.fkKey}Query = use${fk.ids.EntitiesPascal}Query({`,
      `    selection: { fields: { ${labelSel} } },`,
      `  });`,
      `  const ${options} = ${fk.fkKey}Query.data?.${fk.ids.entitiesCamel}?.nodes ?? [];`,
      `  const [${choice}, set${fk.FkKeyPascal}] = useState('');`,
      `  const ${fk.fkKey} = ${valueExpr};`,
    ].join('\n');
  });
  const parentFkHook = '\n' + hookBlocks.join('\n');

  // (3) FK select JSX — one per FK, at the form's 12-space child indent. The disabled
  // empty-state (testid <entity>-<fkColumn>-select-empty) shows when there are zero parents;
  // otherwise the bound select (testid <entity>-<fkColumn>-select). The testid is keyed on the
  // FK COLUMN (fkKebab) so two FKs to the same parent never share a testid. The <option> shows
  // the parent's label field when present (SG-6), else the id. Optional/self-ref FKs get a
  // leading "— none —" option so the column can be cleared to NULL.
  const selectBlocks = fks.map((fk) => {
    const options = `${fk.fkKey}Options`;
    const sel = `${entityKebab}-${fk.fkKebab}-select`;
    const optText = fk.labelField ? `{opt.${fk.labelField} ?? opt.id}` : '{opt.id}';
    const noneOption = fk.required ? '' : '\n                <option value="">— none —</option>';
    return [
      `            {${options}.length === 0 ? (`,
      `              <select`,
      `                data-testid="${sel}-empty"`,
      `                disabled`,
      `                className="rounded-md border px-3 py-2 text-sm"`,
      `              >`,
      `                <option>No ${fk.parentLabel} yet</option>`,
      `              </select>`,
      `            ) : (`,
      `              <select`,
      `                data-testid="${sel}"`,
      `                value={${fk.fkKey}}`,
      `                onChange={(e) => set${fk.FkKeyPascal}(e.target.value)}`,
      `                className="rounded-md border px-3 py-2 text-sm"`,
      `              >${noneOption}`,
      `                {${options}.map((opt) => (`,
      `                  <option key={opt.id} value={opt.id ?? ''}>`,
      `                    ${optText}`,
      `                  </option>`,
      `                ))}`,
      `              </select>`,
      `            )}`,
    ].join('\n');
  });
  const fkSelectJsx = '\n' + selectBlocks.join('\n');

  // (4) create-input FK keys — spread INSIDE the mutate call after __CREATE_EXTRA__; each
  // carries its own leading ', ' so the empty case collapses cleanly (mirrors createExtra).
  // REQUIRED FKs spread the key plainly (it always has a value); OPTIONAL/self-ref FKs spread
  // CONDITIONALLY so an unset FK is omitted (NULL) rather than sent as ''.
  const createFkExtra = fks
    .map((fk) => (fk.required ? `, ${fk.fkKey}: ${fk.fkKey}` : `, ...(${fk.fkKey} ? { ${fk.fkKey}: ${fk.fkKey} } : {})`))
    .join('');

  // (5) submit guard — appended to the submit button's `disabled` expression; each REQUIRED FK
  // carries its own leading ' || ' so submit stays disabled until every required parent is
  // chosen. Optional/self-ref FKs do NOT gate submit (NULL is valid).
  const submitGuard = fks.filter((fk) => fk.required).map((fk) => ` || !${fk.fkKey}`).join('');

  return { parentHookImport, parentFkHook, fkSelectJsx, createFkExtra, submitGuard };
}

// ════════════════════════════════════════════════════════════════════════════
// N:M LINK MANAGEMENT (the M:N relation-manager surface, SG-2 Stage 2).
//
// A brief with a RelationManyToMany (junction) provisions the link TABLE + its typed
// SDK hooks (use<Junctions>Query / useCreate<Junction>Mutation / useDelete<Junction>-
// Mutation) but, before this, generated NO UI to create/manage the links — you could
// not attach/detach a linked record from the app (the Cleome field-guide↔observation
// citations + observation cooccurrence had to be SEEDED by script). For each N:M
// relation OWNED by a table (source_table === the table) we now stamp a generic
// RELATION-MANAGER surface (templates/frontend/crud/relation-manager.tsx) and mount it
// as a SECTION on the owning entity's page: it lists the records currently linked to a
// chosen owning row and lets the user ADD (create a junction row) and REMOVE (delete it).
//
// SCOPE: the junction FK PAIR only (link / unlink). Junction PAYLOAD columns are the
// deferred SG-3 grammar gap (the M:N `data:` block exposes no payload-column slot) — a
// comment seam in the template notes payload is future; none are emitted here.
//
// GENERIC + CANARY-SAFE. Everything derives from the brief's N:M relation + the SAME
// inflection the rest of the file uses (junction/source/target table → entityIdentifiers
// + camel(singular)+'Id' FK keys). An app with NO RelationManyToMany emits NOTHING new
// (manyToManyRelations returns [] → both seams are '' and no template file is written),
// so the owner/blog/childfk canaries — and the CRM fixture (RelationBelongsTo only) —
// stay byte-identical; only crm/cleome-style N:M briefs get the manager.
// ════════════════════════════════════════════════════════════════════════════

// The junction-node $types that MATERIALIZE an `entity_id` column on the link row (so an
// org-scoped junction's create MUST supply a non-null entity_id). Mirrors brief.mjs's
// NODE_PROVIDED_COLUMNS (the SAME source of truth the backend builder reads), narrowed to
// the entity_id producers. A junction whose `data.nodes` includes one of these kept its
// org security (AuthzEntityMembership honored); a DataId-only junction was coerced to
// AuthzAllowAll (GAP-1d) and has NO entity_id column → its create takes only the FK pair.
const JUNCTION_ENTITY_ID_NODES = new Set(['DataEntityMembership', 'DataOwnershipInEntity']);
// Authz* policy types whose junction is org-scoped (materializes entity_id). Mirrors
// brief.mjs's JUNCTION_MATERIALIZING_NODES key set — the SAME signal the backend uses to
// emit Pattern-3 nodes. Read from the policy INTENT so the frontend tracks the backend
// even when the brief states the intent WITHOUT explicit nodes (the default org path).
const JUNCTION_ORG_POLICY_TYPES = new Set(['AuthzEntityMembership', 'AuthzMemberOwner']);
// The `junction_policy:` shorthand → the Authz* type it resolves to (mirrors brief.mjs's
// JUNCTION_POLICY_SHORTHAND, narrowed to the type so the frontend reads the same intent).
const JUNCTION_POLICY_SHORTHAND_TYPE = {
  'org-membership': 'AuthzEntityMembership',
  'member-owner': 'AuthzMemberOwner',
};

/**
 * Whether a RelationManyToMany junction is ORG-SCOPED — i.e. it materializes an
 * `entity_id` column, so its create needs a non-null `entityId`. Tracks the backend's
 * Pattern-3 decision (brief.mjs liftManyToManySecurity) 1:1, GENERICALLY, with NO junction
 * name special-cased. A junction is org-scoped when EITHER:
 *   (a) its nodes (nested `data.nodes` or flat SDK `nodes`) include a DataEntityMembership
 *       / DataOwnershipInEntity (an advanced author declared the column), OR
 *   (b) its requested policy INTENT is org-scoped — nested `data.policy_type`, the
 *       `junction_policy:` shorthand, or a flat `policies[].$type` of AuthzEntityMembership
 *       / AuthzMemberOwner — AND the author did NOT force a non-materializing explicit
 *       `nodes` set (in which case the backend coerces to AuthzAllowAll and there is NO
 *       entity_id column). This is exactly when the backend emits the Pattern-3 node.
 */
function junctionOrgScoped(rel) {
  const explicitNodes = Array.isArray(rel?.data?.nodes)
    ? rel.data.nodes
    : Array.isArray(rel?.nodes)
      ? rel.nodes
      : null;
  // (a) explicit materializing node present → org-scoped regardless of policy form.
  if (explicitNodes && explicitNodes.some((n) => JUNCTION_ENTITY_ID_NODES.has(typeof n === 'string' ? n : n?.$type))) {
    return true;
  }
  // If the author forced an explicit nodes set WITHOUT a materializing node, the backend
  // can't honor an org policy (it coerces to AuthzAllowAll) → no entity_id column.
  if (explicitNodes) return false;
  // (b) no explicit nodes → org-scoped iff the requested policy intent is org-scoped
  // (the default Pattern-3 path materializes entity_id). Read the intent from all forms.
  const nested = rel?.data?.policy_type;
  const short = (typeof rel?.junction_policy === 'string')
    ? JUNCTION_POLICY_SHORTHAND_TYPE[rel.junction_policy]
    : undefined;
  const flat = Array.isArray(rel?.policies) ? rel.policies.map((p) => p?.$type) : [];
  return JUNCTION_ORG_POLICY_TYPES.has(nested) ||
    JUNCTION_ORG_POLICY_TYPES.has(short) ||
    flat.some((t) => JUNCTION_ORG_POLICY_TYPES.has(t));
}

/**
 * EVERY RelationManyToMany OWNED by `table` (source_table === table.name) — the N:M
 * relations whose manager mounts on THIS entity's page. The owning side is the SOURCE
 * (e.g. a field_guide owns its guide_citations → observations), matching the brief's
 * source/target direction; the manager attaches/detaches the TARGET records.
 *
 * Each result describes one junction manager, every identifier DERIVED (zero literals):
 *   junctionName  — the junction table name (junction_table_name, else <source>_<target>).
 *   junctionIds   — entityIdentifiers(singular(junctionName)): the junction list hook
 *                   (use<Junctions>Query), data accessor (<junctions>), create/delete
 *                   hook bases, DynamicFormCard `_meta` type, and the testid prefix.
 *   ownFkKey      — the junction FK column → the OWNING row (camel(singular(source))+'Id').
 *   otherFkKey    — the junction FK column → the LINKED record (camel(singular(target))+'Id').
 *   otherIds      — entityIdentifiers(singular(target_table)): the LINKED entity's list hook
 *                   (the add-picker's options source) + data accessor.
 *   otherLabelField — the linked table's display field (labelFieldFor) or null (→ show id).
 *   otherLabel    — the linked entity's human label ("Observations") for the empty/picker.
 *   relLabel      — the section heading (titleCase of the junction name).
 *   relKebab      — kebab singular of the junction → the data-testid prefix base.
 *   orgScoped     — true when the junction materializes entity_id (junctionOrgScoped) → the
 *                   create needs `entityId: activeOrgId`.
 * Returns [] when the table owns no N:M relation (the canary path — emits NOTHING new).
 */
function manyToManyRelations(brief, table, srcDir = null, ctx = null) {
  const relations = brief?.data_model?.relations ?? [];
  const tables = brief?.data_model?.tables ?? [];
  const out = [];
  for (const r of relations) {
    if (r?.$type !== 'RelationManyToMany') continue;
    if (r.source_table !== table?.name) continue;
    if (!r.target_table) continue;
    const junctionName =
      r.junction_table_name || [r.source_table, r.target_table].filter(Boolean).join('_');
    const sourceSingular = singularFromTable(r.source_table) || kebab(r.source_table);
    const targetSingular = singularFromTable(r.target_table) || kebab(r.target_table);
    const targetTable = tables.find((t) => t.name === r.target_table) || null;
    // The linked (target) table's label column must be selected by ITS codegen-actual name.
    const targetMapCol = srcDir
      ? makeColMapper(srcDir, entityIdentifiers(targetSingular).EntityPascal, ctx)
      : (n) => n;
    out.push({
      junctionName,
      junctionIds: entityIdentifiers(singularFromTable(junctionName) || kebab(junctionName)),
      // The junction FK columns the platform generates: <singular(table)>Id, camelCased
      // (verified against the codegen'd Create<Junction>Input — fieldGuideId/observationId).
      // These are structurally <entity>Id (multi-char tail) so the platform never mangles them.
      ownFkKey: camel(sourceSingular) + 'Id',
      otherFkKey: camel(targetSingular) + 'Id',
      otherIds: entityIdentifiers(targetSingular),
      otherLabelField: labelFieldFor(targetTable, targetMapCol),
      otherLabel: titleCase(pluralizeWords(targetSingular).join('-')),
      relLabel: titleCase(pluralizeWords(singularFromTable(junctionName) || junctionName).join('-')),
      relKebab: kebab(singularFromTable(junctionName) || junctionName),
      orgScoped: junctionOrgScoped(r),
    });
  }
  return out;
}

/**
 * Stamp ONE relation-manager component (templates/frontend/crud/relation-manager.tsx) per
 * N:M relation into <app>/src/components/crud/relations/<junction>-relation-manager.tsx,
 * substituting every junction-derived identifier. Idempotent: skips if the file already
 * exists. Returns the import path + the component name the entity page mounts.
 *
 * The two label seams collapse cleanly when the linked table has NO text label
 * (otherLabelField === null): the selection drops to bare `id`, the picker option shows
 * `opt.id`, and the resolved row label shows `hit.id` — never a leaked `?? undefined`.
 */
function emitRelationManager(srcDir, rel, ctx) {
  const dir = path.join(srcDir, 'components', 'crud', 'relations');
  const fileBase = `${rel.junctionName.replace(/_/g, '-')}-relation-manager`;
  const dest = path.join(dir, `${fileBase}.tsx`);
  const componentName = `${rel.junctionIds.EntityPascal}RelationManager`;
  const importPath = `@/components/crud/relations/${fileBase}`;

  if (fs.existsSync(dest)) {
    skip(dest, ctx);
    return { importPath, componentName };
  }

  // The linked-record selection.fields body + the two label expressions (SG-6).
  const labelSelect = rel.otherLabelField ? `id: true, ${rel.otherLabelField}: true` : 'id: true';
  // Picker <option> (loop var `opt`) + the labelForLink resolver (matched row `hit`).
  const optLabelExpr = rel.otherLabelField ? `opt.${rel.otherLabelField} ?? opt.id` : 'opt.id';
  const hitLabelExpr = rel.otherLabelField
    ? `(hit.${rel.otherLabelField} as string | undefined) ?? hit.id ?? '(unknown)'`
    : "hit.id ?? '(unknown)'";

  // Org-scoping seams — only an entity_id-materializing junction gets them (so a DataId-
  // only junction's create stays the bare FK pair, matching its codegen'd Create input).
  const orgImport = rel.orgScoped ? ORG_SCOPING_IMPORT : '';
  const orgConst = rel.orgScoped ? ORG_OWNER_CONST : '';
  const orgCreateKey = rel.orgScoped ? ', entityId: activeOrgId' : '';
  const orgAddGuard = rel.orgScoped ? ' || !activeOrgId' : '';

  let body = readTemplate(CRUD_TEMPLATES_DIR, 'relation-manager.tsx');
  const subs = [
    // longer tokens before shorter so a prefix never clobbers a longer match.
    ['__Create_Junction__', rel.junctionIds.CreateEntityPascal],
    ['__Delete_Junction__', 'Delete' + rel.junctionIds.EntityPascal],
    ['__JUNCTION_PASCAL__', rel.junctionIds.EntityPascal],
    ['__Junctions__', rel.junctionIds.EntitiesPascal],
    ['__junctions__', rel.junctionIds.entitiesCamel],
    ['__Others__', rel.otherIds.EntitiesPascal],
    ['__others__', rel.otherIds.entitiesCamel],
    ['__OWN_FK_KEY__', rel.ownFkKey],
    ['__OTHER_FK_KEY__', rel.otherFkKey],
    ['__OTHER_LABEL_SELECT__', labelSelect],
    ['__OTHER_LABEL_EXPR_FN__', hitLabelExpr],
    ['__OTHER_LABEL_EXPR__', optLabelExpr],
    ['__rel__', rel.relKebab],
    ['__REL_LABEL__', rel.relLabel],
    ['__OTHER_LABEL__', rel.otherLabel],
    ['__ORG_SCOPING_IMPORT__', orgImport],
    ['__ORG_SCOPING_CONST__', orgConst],
    ['__ORG_CREATE_KEY__', orgCreateKey],
    ['__ORG_ADD_GUARD__', orgAddGuard],
  ];
  for (const [tok, val] of subs) body = body.split(tok).join(val);
  assertNoUnsubstituted(dest, body);
  write(dest, body, ctx);
  return { importPath, componentName };
}

/**
 * Build the two entity-page seams that MOUNT the N:M relation managers for a table:
 *   • relationManagerImport — the per-junction `import { <Comp> } from '<path>';` lines,
 *     each on its own line with a leading '\n' when non-empty (mirrors parentHookImport).
 *   • relationManagerJsx    — the per-junction <…RelationManager ownerOptions={rows}
 *     ownerLabelOf={…} /> blocks, mounted as sections after the entity list. Passes the
 *     page's already-loaded `rows` as the owner options + a labelOf that reads the page's
 *     titleField (so the owner picker shows a name), so the manager is usable directly
 *     from the list page (pick an owner → manage its links) with NO detail route needed.
 *
 * BOTH seams are the empty string when `m2mRels` is empty — the load-bearing default that
 * keeps the no-N:M canary byte-identical (the seams collapse to nothing). The component is
 * stamped (emitRelationManager) as a side effect so the import resolves.
 */
function buildRelationManagerSeams(srcDir, m2mRels, titleField, ctx) {
  if (!Array.isArray(m2mRels) || m2mRels.length === 0) {
    return { relationManagerImport: '', relationManagerJsx: '' };
  }
  const importLines = [];
  const jsxBlocks = [];
  for (const rel of m2mRels) {
    const { importPath, componentName } = emitRelationManager(srcDir, rel, ctx);
    importLines.push(`import { ${componentName} } from '${importPath}';`);
    jsxBlocks.push(
      [
        `      {/* N:M link management — ${rel.relLabel} (junction ${rel.junctionName}). */}`,
        `      <${componentName}`,
        `        ownerOptions={rows}`,
        `        ownerLabelOf={(row) => String(row.${titleField} ?? row.id)}`,
        `      />`,
      ].join('\n'),
    );
  }
  return {
    relationManagerImport: '\n' + importLines.join('\n'),
    relationManagerJsx: '\n' + jsxBlocks.join('\n'),
  };
}

/**
 * (b) Emit one entity page from the entity-page template, substituting the
 * per-entity identifiers. Idempotent: skips if the page already exists.
 *
 * `fks` (default []) is the table's belongs-to FKs (from belongsToFks(brief, table)):
 * required, optional, AND self-referential. For each one the page emits a parent-list-hook
 * import, a parent FK <select> picker bound to a default-selected state, the create-input FK
 * key, and (for REQUIRED FKs only) a submit guard. The EMPTY-ARRAY DEFAULT is load-bearing:
 * every FK seam collapses to the empty string when there are no FKs, so the no-FK path
 * (the todos canary) stays byte-identical to the pre-FIX-1 template.
 *
 * `m2mRels` (default []) is the N:M relations this table OWNS (manyToManyRelations(brief,
 * table)). For each one the page mounts a generic <…RelationManager> section (link/unlink
 * UI) and a relation-manager component is stamped under components/crud/relations/. The
 * EMPTY-ARRAY DEFAULT is equally load-bearing: both N:M seams collapse to '' when the table
 * owns no junction, so a non-N:M table (every canary) stays byte-identical.
 */
function emitEntityPage(srcDir, route, table, ctx, fks = [], m2mRels = []) {
  const entity = route.entity || singularFromTable(table?.name) || kebab(route.path);
  // SG-A — the SDK hooks (use<Entities>Query / useCreate<Entity>Mutation), the data accessor
  // (data.<entities>) and the DynamicFormCard `_meta` tableName ALL derive from the TABLE name
  // (codegen generates them from the table), NOT the route ENTITY. For the common case where the
  // entity inflects to the table (todo↔todos) these coincide → byte-identical canary; for an
  // ALIAS entity (a route whose entity does not inflect to its backing table) they DIVERGE and
  // the page must import the REAL table-derived hooks — deriving them from the alias would import
  // hooks that codegen never generated (the silent-break the old tableFor produced).
  const tableEntity = singularFromTable(table?.name) || entity;
  const sdkIds = entityIdentifiers(tableEntity); // SDK/_meta-facing identifiers (from the table)
  const ids = entityIdentifiers(entity); // UI/testid-facing identifiers (from the route entity)
  const label = route.label || titleCase(entity);
  // SG-A for COLUMNS — remap every brief-derived column name to the name codegen ACTUALLY
  // emitted for THIS table's SDK row interface (sdkIds.EntityPascal, the same `_meta` type the
  // page already names). When the SDK isn't present (dry-run / canary) this is the identity, so
  // the brief-derived name is used unchanged (canary byte-identical). Threaded into every
  // column-emitting helper below so a platform-mangled column (e.g. elevation_m → elevationm) is
  // referenced by its real codegen name in the selection AND the create mutate — not the brief's.
  const mapCol = makeColMapper(srcDir, sdkIds.EntityPascal, ctx);
  const titleField = pickTitleField(table, mapCol);
  const createExtra = pickCreateExtra(table, titleField, mapCol);
  const scoping = scopingSeams(table);
  const selectionFields = buildSelectionFields(table, titleField, mapCol);
  const createSelection = buildCreateSelection(titleField);
  const listWhere = buildListWhere(table);
  // The page's OWN list hook (table-derived) — passed so a self-ref FK doesn't re-import it.
  const ownListHook = `use${sdkIds.EntitiesPascal}Query`;
  const fkSeams = buildFkSeams(ids.entityKebab, fks, ownListHook);
  // N:M link-management seams (the relation-manager sections this table owns). Both '' for
  // a non-N:M table (byte-identical canary). Side-effect: stamps each junction's manager
  // component (idempotent), so the page's imports resolve. Uses the table-derived titleField
  // for the owner picker's label (the SAME field the row label binds to).
  const relSeams = buildRelationManagerSeams(srcDir, m2mRels, titleField, ctx);

  // The page DIRECTORY is the route PATH (so the Next.js URL matches the brief's
  // `path`), NOT the entity — e.g. `path: /todos, entity: todo` lands at app/todos/
  // (serving /todos) while every identifier/testid still derives from `todo`.
  const dest = path.join(srcDir, 'app', ...routeSegments(route.path), 'page.tsx');
  if (fs.existsSync(dest)) {
    skip(dest, ctx);
    return { entity, ids, label };
  }

  let body = readTemplate(TEMPLATES_DIR, 'entity-page.tsx');
  // Order matters: the longer tokens (__Create_Entity__, __Entities__) before the
  // shorter (__Entity__) so a prefix never clobbers a longer match.
  const subs = [
    // SDK/_meta-facing identifiers → derived from the TABLE (sdkIds) so the page imports the
    // REAL codegen'd hooks + names the real `_meta` type, even for an ALIAS entity (SG-A). The
    // list/create hooks, the data accessor, the component + create-const names, and the
    // DynamicFormCard tableName all use the table singular — consistent and codegen-correct.
    ['__Create_Entity__', sdkIds.CreateEntityPascal],
    ['__Entities__', sdkIds.EntitiesPascal],
    ['__entities__', sdkIds.entitiesCamel],
    ['__Entity__', sdkIds.EntityPascal],
    // UI/testid-facing identifiers → derived from the route ENTITY alias (the testid prefix +
    // heading the live-QA driver and the user see). The empty-state testid is the kebab PLURAL of
    // the entity (consistent with the singular <entity>-row/-edit testids), kept SEPARATE from the
    // table-derived data accessor so an alias entity's testids all share the entity prefix while
    // the data accessor still reads the real table key. For the common case (entity inflects to the
    // table) this equals the old camel-plural for single-word entities → byte-identical canary.
    ['__entity__', ids.entityKebab],
    ['__ENTITIES_EMPTY_TESTID__', `${pluralizeWords(entity).join('-')}-empty`],
    ['__ENTITY_LABEL__', label],
    ['__TITLE_FIELD__', titleField],
    ['__SELECTION_FIELDS__', selectionFields],
    ['__LIST_WHERE__', listWhere],
    ['__CREATE_SELECTION__', createSelection],
    // Scoping seams (policy-derived): the lone scoping import + the scoping-id const + the
    // active-org submit guard. For owner/public tables these reproduce the prior template
    // EXACTLY (TokenManager import + ownerId const + empty guard) → byte-identical canary; an
    // org-membership table instead reads the active org from useActiveOrg() (the single source
    // of truth) and gates the create on it being resolved.
    ['__SCOPING_IMPORT__', scoping.scopingImport],
    ['__OWNER_CONST__', scoping.ownerConst],
    ['__ORG_SUBMIT_GUARD__', scoping.orgSubmitGuard],
    // Belongs-to FK seams (required + optional + self-ref). EACH is '' when there are no
    // FKs (byte-identical canary). __CREATE_EXTRA__ stays before __CREATE_FK_EXTRA__ on the
    // mutate line; the two whole-line seams (__PARENT_HOOK_IMPORT__/__PARENT_FK_HOOK__) carry
    // their own leading newline so the empty case leaves no stray blank line.
    ['__CREATE_EXTRA__', createExtra],
    ['__PARENT_HOOK_IMPORT__', fkSeams.parentHookImport],
    ['__PARENT_FK_HOOK__', fkSeams.parentFkHook],
    ['__FK_SELECT_JSX__', fkSeams.fkSelectJsx],
    ['__CREATE_FK_EXTRA__', fkSeams.createFkExtra],
    ['__SUBMIT_GUARD__', fkSeams.submitGuard],
    // N:M relation-manager seams. EACH is '' when the table owns no junction (byte-identical
    // canary). __RELATION_MANAGER_IMPORT__ carries its own leading newline (like the FK hook
    // import); __RELATION_MANAGER_JSX__ mounts the manager sections after the entity list.
    ['__RELATION_MANAGER_IMPORT__', relSeams.relationManagerImport],
    ['__RELATION_MANAGER_JSX__', relSeams.relationManagerJsx],
  ];
  for (const [tok, val] of subs) {
    body = body.split(tok).join(val);
  }
  assertNoUnsubstituted(dest, body);
  write(dest, body, ctx);
  return { entity, ids, label };
}

/** Singular entity guess from a table name (drop a trailing plural -s/-ies/-es). */
function singularFromTable(tableName) {
  if (!tableName) return null;
  const ws = words(tableName);
  if (ws.length === 0) return null;
  let last = ws[ws.length - 1];
  if (/ies$/.test(last)) last = last.slice(0, -3) + 'y';
  else if (/(s|x|z|ch|sh)es$/.test(last)) last = last.slice(0, -2);
  else if (/s$/.test(last)) last = last.slice(0, -1);
  return [...ws.slice(0, -1), last].join('-');
}

/**
 * The field shown as each row's label + bound to the quick-add input. The
 * generator prefers, in order: the first REQUIRED text field, the first text
 * field, a conventional name (title/name/label), else 'title'. Emitted camelCase
 * because the SDK/_meta inflect snake → camel, then mapped through `mapCol` to the
 * codegen-actual name (the title is BOTH a selection key and the create mutate key, so a
 * mangled text column must use its real codegen name). `mapCol` defaults to identity so
 * existing callers (codegen-free) are unchanged.
 */
function pickTitleField(table, mapCol = (n) => n) {
  const fields = table?.fields ?? [];
  const isText = (f) => !f.type || f.type.name === 'text' || f.type.name === 'citext';
  const requiredText = fields.find((f) => f.required && isText(f) && f.name !== 'slug');
  if (requiredText) return mapCol(camel(requiredText.name));
  const anyText = fields.find((f) => isText(f) && f.name !== 'slug');
  if (anyText) return mapCol(camel(anyText.name));
  const conventional = fields.find((f) => ['title', 'name', 'label'].includes(camel(f.name)));
  if (conventional) return mapCol(camel(conventional.name));
  return 'title';
}

/**
 * The owner-uuid columns a `policies_raw` table declares via an Authz*Owner* policy's
 * `data.entity_fields` (SG-2). A table reached through the policies_raw ESCAPE HATCH gets
 * NO mapped-policy scoping const, so its required owner uuid columns (e.g. an
 * AuthzDirectOwnerAny over a pair of owner uuid columns) are never set and every INSERT
 * NOT-NULL/RLS-rejects. We read EVERY policies_raw entry's `data.entity_fields` (the generic
 * shape ALL the owner-style raw Authz types use: entity_fields is a list of uuid columns the
 * actor must own) and return them camelCased + de-duped, so the create can set each to the
 * actor id (a self-default — the actor owns the row it creates). Returns [] for a table with
 * no policies_raw owner fields (every mapped-policy table → unchanged).
 */
function policiesRawOwnerFields(table, mapCol = (n) => n) {
  const raw = Array.isArray(table?.policies_raw) ? table.policies_raw : [];
  const cols = [];
  for (const p of raw) {
    const ef = p?.data?.entity_fields;
    if (Array.isArray(ef)) {
      for (const c of ef) if (c) cols.push(mapCol(camel(c))); // codegen-actual owner-uuid column name
    }
  }
  return [...new Set(cols)];
}

/**
 * The REQUIRED NON-TEXT fields a quick-add create must supply a minimal value for (SG-B).
 * pickTitleField only binds the first required TEXT field; any OTHER required column with no
 * DB default — a date, integer, numeric, boolean, or timestamp — is dropped from the quick-add
 * mutate, so the create NOT-NULL-rejects (e.g. a required `observed_on` date column the title
 * input can't fill). This collects ALL `required: true` fields with no `default` and returns,
 * for each non-text one, the camelCase key + a type-appropriate minimal literal:
 *   date        → today (YYYY-MM-DD)        integer/numeric → 0
 *   boolean     → the field default, else false
 *   timestamptz → the current instant (ISO)
 * SKIPPED (handled elsewhere or unfabricable): the titleField (already bound), any TEXT/citext
 * field (text is the title or an optional field), uuid columns (FK columns are supplied by the
 * FK seams; owner uuid columns by the policy/policies_raw scoping — a random uuid is never
 * fabricated), and json (no sensible non-null minimal). GENERIC: keyed off the brief field
 * type, no entity/column hard-coding — exactly how the backend builder reads field types.
 * Each fragment includes its own leading `, ` so it splices into the mutate after the title.
 */
function requiredNonTextDefaults(table, titleField, mapCol = (n) => n) {
  const fields = table?.fields ?? [];
  const out = [];
  for (const f of fields) {
    if (f.required !== true) continue;
    if (f.default !== undefined) continue; // a DB default fills it — don't override
    const key = mapCol(camel(f.name)); // codegen-actual name (a mangled column → its real SDK key)
    if (key === titleField) continue; // already bound to the quick-add input
    const type = f.type?.name || 'text';
    if (type === 'text' || type === 'citext') continue; // title or optional text
    let literal;
    if (type === 'date') literal = 'new Date().toISOString().slice(0, 10)';
    else if (type === 'integer' || type === 'bigint' || type === 'smallint' || type === 'numeric' || type === 'decimal' || type === 'real' || type === 'double precision' || type === 'float') literal = '0';
    else if (type === 'boolean') literal = 'false';
    else if (type === 'timestamptz' || type === 'timestamp' || type === 'timestamptz_ms') literal = 'new Date().toISOString()';
    else continue; // uuid (FK/owner — handled elsewhere), json, or unknown — never fabricate
    out.push(`, ${key}: ${literal}`);
  }
  return out.join('');
}

/**
 * True when the table opted into the `temporal` restrict (restrict: [temporal] →
 * RESTRICT_MODIFIERS.temporal in lib/brief.mjs). That modifier adds two nullable
 * `valid_from`/`valid_until` timestamptz columns AND a RESTRICTIVE `AuthzTemporal`
 * policy whose INSERT WITH-CHECK only passes for a row that is IN-WINDOW
 * (valid_from <= now() AND (valid_until IS NULL OR valid_until > now())). Detected
 * GENERICALLY off the brief's `restrict` tag — no entity hard-coding — exactly the
 * way buildTableDefinition consumes RESTRICT_MODIFIERS, so it tracks the modifier 1:1.
 */
function isTemporalTable(table) {
  return Array.isArray(table?.restrict) && table.restrict.includes('temporal');
}

/**
 * The policy-derived extra create-input keys the quick-add spreads. Per the
 * table's policy intent the create needs a non-null scoping column:
 *   owner / public-read+owner-write  -> `, ownerId`  (DataDirectOwner.owner_id)
 *   org-membership                    -> `, entityId: activeOrgId`
 *                                        (AuthzEntityMembership.entity_id — the active org)
 *   member-owner                      -> `, ownerId, entityId: activeOrgId` (SG-C: AuthzMemberOwner
 *                                        needs BOTH owner_id AND entity_id — the prior code emitted
 *                                        only entityId, so every member-owner create NOT-NULL-rejected
 *                                        on owner_id. The ownerId is the actor, like the owner tier.)
 *   public-lookup                     -> '' (no ownership column)
 *   policies_raw owner fields         -> `, <col>: ownerId` per declared entity_fields column (SG-2:
 *                                        a policies_raw ESCAPE-HATCH table gets no mapped scoping const,
 *                                        so its required owner uuid columns were never set. Each is set
 *                                        to the actor id — a self-default, e.g. lend-to-self.)
 *
 * PLUS, when the table is `restrict: [temporal]`, a temporal WINDOW fragment so the
 * quick-add row PASSES the RESTRICTIVE AuthzTemporal INSERT WITH-CHECK (else every
 * generated create is rejected — proven: a curl with an explicit window inserts, the
 * generated form does not). We supply `validFrom` as the CURRENT instant computed
 * from the runtime clock at submit time (`new Date().toISOString()` — emitted-app
 * code, which may use the JS Date API) and OMIT `validUntil` so the column stays NULL
 * (open-ended) — the in-window shape: valid_from <= now() AND valid_until IS NULL.
 * The two fragments compose (a table can be BOTH owner-scoped AND temporal), so the
 * order is `[, <policy key>][, validFrom: …]`.
 *
 * PLUS the SG-B required-non-text defaults — a minimal value for every required column the
 * quick-add title binding can't fill (date/int/bool/timestamp), so the create is not
 * NOT-NULL-rejected on a required non-text column.
 *
 * Returned as a code fragment spliced INTO THE MUTATION BODY ONLY (a real expression
 * context) after the title field — it INCLUDES its own leading `, ` so the empty case
 * collapses cleanly to `mutate({ title: t })`. It is NEVER injected into the JSDoc
 * header: a `/* … *​/` fragment there would prematurely close the doc-comment (gap #2).
 */
function pickCreateExtra(table, titleField, mapCol = (n) => n) {
  const policy = table?.policy;
  let extra = '';
  if (policy === 'owner' || policy === 'public-read+owner-write') extra += ', ownerId';
  else if (policy === 'org-membership') extra += ', entityId: activeOrgId';
  // SG-C — member-owner needs BOTH owner_id (NOT NULL) AND entity_id.
  else if (policy === 'member-owner') extra += ', ownerId, entityId: activeOrgId';
  // SG-2 — policies_raw owner entity_fields: set each declared owner uuid column to the actor id.
  for (const col of policiesRawOwnerFields(table, mapCol)) extra += `, ${col}: ownerId`;
  // SG-B — required non-text columns the title binding can't fill (date/int/bool/timestamp).
  extra += requiredNonTextDefaults(table, titleField, mapCol);
  // Temporal window: land the row IN-window so the RESTRICTIVE AuthzTemporal WITH-CHECK
  // passes AND the row is immediately visible (valid_from = now ≤ now; valid_until NULL).
  if (isTemporalTable(table)) extra += ', validFrom: new Date().toISOString()';
  return extra;
}

/** True when the table's policy intent is org-membership (AuthzEntityMembership). */
function isOrgScopedTable(table) {
  const policy = table?.policy;
  return policy === 'org-membership' || policy === 'member-owner';
}

/**
 * True when the create needs the `ownerId` admin-token const. Owner / public-read+owner-write
 * always do; MEMBER-OWNER does too (SG-C — it needs owner_id AND entity_id); and any table with
 * policies_raw owner entity_fields does (SG-2). Drives whether scopingSeams emits the TokenManager
 * ownerId const alongside (for member-owner) the useActiveOrg() org const.
 */
function needsOwnerId(table) {
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
 * The const's leading line carries the template's own 2-space indent; continuation lines embed
 * it. GENERIC: composed from independent ORG and OWNER fragments off the table's policy intent,
 * so each tier reproduces the prior template EXACTLY where it always did (owner/public → owner
 * const only; org-membership → org const only) and ONLY member-owner gains the second const.
 */
const ORG_SCOPING_IMPORT = "import { useActiveOrg } from '@/components/org-context';";
const OWNER_SCOPING_IMPORT = "import { TokenManager } from '@/lib/auth/token-manager';";
const ORG_OWNER_CONST = [
  '// Org-membership create scope. AuthzEntityMembership requires entity_id to be an org the',
  '  // signed-in user belongs to — the ACTIVE org. useActiveOrg() is the single source of truth:',
  '  // the OrgProvider defaults it to the actor\'s owned (personal) org and the OrgSwitcher updates',
  '  // it, so creates land in whatever org the user is acting in (multi-org safe), not a token guess.',
  '  const { orgId: activeOrgId } = useActiveOrg();',
].join('\n');
const OWNER_ID_CONST = [
  '// Owner id for owner-scoped creates (DataDirectOwner). Unused keys are harmless —',
  '  // the generator only spreads what the policy needs (see the mutation body).',
  '  const ownerId =',
  "    (typeof window !== 'undefined' &&",
  "      TokenManager.getToken('admin').token?.userId) ||",
  "    '';",
].join('\n');
// The member-owner ownerId const (SG-C) — same value as OWNER_ID_CONST but a member-owner-specific
// comment; emitted AFTER the org const so the page reads activeOrg first, then ownerId.
const MEMBER_OWNER_ID_CONST = [
  '// SG-C (member-owner create): AuthzMemberOwner needs BOTH owner_id AND entity_id; supply the',
  '  // actor id so the create passes + is author-scoped (the org const above gives entity_id).',
  '  const ownerId =',
  "    (typeof window !== 'undefined' &&",
  "      TokenManager.getToken('admin').token?.userId) ||",
  "    '';",
].join('\n');

function scopingSeams(table) {
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
    };
  }
  // org-membership only — UNCHANGED.
  if (wantsOrg) {
    return {
      scopingImport: ORG_SCOPING_IMPORT,
      ownerConst: ORG_OWNER_CONST,
      // entity_id is NON-NULL on AuthzEntityMembership tables — wait for a resolved active org.
      orgSubmitGuard: ' || !activeOrgId',
    };
  }
  // owner / public-read+owner-write / policies_raw owner — UNCHANGED.
  return {
    scopingImport: OWNER_SCOPING_IMPORT,
    ownerConst: OWNER_ID_CONST,
    orgSubmitGuard: '',
  };
}

/**
 * The list-query `selection.fields` object body (codegen 4.45.1+ HookStrictSelect
 * mandates a non-empty fields set). Always includes `id` + the label field, then every
 * brief field on the table. Each field name is the brief camelCase (the SDK/_meta inflect
 * snake → camel) MAPPED through `mapCol` to the codegen-actual name, so a platform-mangled
 * column (e.g. brief `elevation_m` → codegen `elevationm`) is selected by its real SDK
 * member instead of the brief-derived `elevationM` (which the SDK row type lacks → tsc
 * break). Derived ONLY from `data_model.tables[].fields` (every key is a real column) +
 * the codegen interface; `mapCol` defaults to identity so a codegen-free caller is
 * unchanged. The passed `titleField` is already mapped by the caller.
 * Returned as the indented body lines that fill the __SELECTION_FIELDS__ seam (which
 * sits at 8-space indent inside `fields: { … }`).
 */
function buildSelectionFields(table, titleField, mapCol = (n) => n) {
  const keys = ['id', titleField];
  for (const f of table?.fields ?? []) {
    const k = mapCol(camel(f.name));
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((k, i) => `${i === 0 ? '' : '        '}${k}: true,`).join('\n');
}

/**
 * The create-mutation `selection.fields` body — the minimal `id` + label field the
 * onSuccess refetch needs. Fills the __CREATE_SELECTION__ seam (8-space indent).
 */
function buildCreateSelection(titleField) {
  const keys = ['id'];
  if (titleField && titleField !== 'id') keys.push(titleField);
  return keys.map((k, i) => `${i === 0 ? '' : '        '}${k}: true,`).join('\n');
}

/** True when the table opted into soft-delete (features: [soft-delete] → DataSoftDelete). */
function isSoftDeleteTable(table) {
  return Array.isArray(table?.features) && table.features.includes('soft-delete');
}

/**
 * The list-query `where` filter that fills the __LIST_WHERE__ seam (which sits at the
 * `fields: { … },` indent inside `selection: { … }`, i.e. 6 spaces). For a SOFT-DELETE
 * table the Delete affordance flips `is_deleted` true and the row PERSISTS, so without a
 * list filter it stays visible (the MED residual). We emit the typed list `where`
 * `{ isDeleted: { equalTo: false } }` so soft-deleted rows drop out of the active list
 * while remaining in the DB. The filter is GraphQL-inflected `isDeleted` (DataSoftDelete's
 * column) via the codegen <Table>Filter (isDeleted: BooleanFilter, equalTo: boolean) — the
 * codegen-correct list `where`, NOT a top-level `condition`. Non-soft-delete tables get an
 * empty string (no filter line at all — they are unchanged).
 *
 * Returned WITH a leading newline so it inserts cleanly right after the `fields: { … },`
 * block; the empty case collapses to nothing (the next line stays `orderBy:`).
 */
function buildListWhere(table) {
  if (!isSoftDeleteTable(table)) return '';
  // DataSoftDelete materializes `is_deleted` → GraphQL inflects it to `isDeleted`; the
  // BooleanFilter operator is `equalTo`. Filter to the not-soft-deleted rows.
  return '\n      // Soft-delete: hide rows whose DataSoftDelete `isDeleted` flag is set' +
    ' (the row persists in the DB; Delete only flips the flag).' +
    '\n      where: { isDeleted: { equalTo: false } },';
}

/**
 * (d) Emit a stub page for a non-CRUD route (dashboard|detail|custom) with a
 * clearly-marked seam. Idempotent.
 */
function emitStubPage(srcDir, route, ctx) {
  const label = route.label || titleCase(kebab(route.path || 'page'));
  const dest = path.join(srcDir, 'app', ...routeSegments(route.path), 'page.tsx');
  if (fs.existsSync(dest)) {
    skip(dest, ctx);
    return;
  }
  const componentName = pascal(label || 'Page') + 'Page';
  const kind = route.kind || 'custom';
  const body = `'use client';

/**
 * ${route.path || '/'} — ${label} (kind: ${kind}).
 *
 * STUB emitted by scripts/scaffold-frontend.mjs for a non-CRUD route. The generic
 * CRUD path (typed list + DynamicFormCard) only covers \`kind: crud\`; richer
 * surfaces are yours to build.
 *
 * // TODO: custom UI — build with @constructive-io/ui; see constructive-frontend
 * //   (CRUD Stack cards, meta-forms, the 50+ Base UI components). For a read list
 * //   use the typed @sdk/app hooks directly; for create/edit reuse DynamicFormCard
 * //   from @/components/crud/dynamic-form-card.
 */
export default function ${componentName}() {
  return (
    <div data-testid="authed-shell" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">${label}</h1>
      <p className="text-muted-foreground text-sm">
        {/* TODO: custom UI — build with @constructive-io/ui; see constructive-frontend */}
        This ${kind} page is a scaffold stub. Replace it with your UI.
      </p>
    </div>
  );
}
`;
  write(dest, body, ctx);
}

/**
 * (e) AUTH ROUTES — when the brief's `flows` include `email-password`, emit the
 * sign-in + sign-up route pages from templates/frontend/auth-page.tsx. wire-app.mjs
 * installs the auth-sign-in-card / auth-sign-up-card BLOCKS but nothing mounts them
 * at Next routes or bridges their result into the host token stores, so the
 * RouteGuard bounces the protected shell back to `/` (gap #4). These wrappers ARE
 * that block→route + host-token-persist bridge (the proven two-auth-store fix).
 *
 * The ONE template file holds both pages, split on the `AUTH-PAGE SPLIT` marker; the
 * first half → app/sign-in/page.tsx, the second → app/sign-up/page.tsx. The
 * __AUTHED_REDIRECT__ seam is the app's primary entity surface (first CRUD route).
 * Idempotent per page. No-op unless email-password is a chosen flow.
 */
function emitAuthPages(srcDir, brief, crudRoutes, ctx) {
  const flows = Array.isArray(brief.flows) ? brief.flows : [];
  if (!flows.includes('email-password')) return;

  // Where a successful sign-in/up lands: the app's first CRUD surface, else first
  // route, else the root. Mirrors the proven .scratch-genericity pages (/todos, /posts).
  const routes = brief.ui?.routes ?? [];
  const authedRedirect =
    (crudRoutes[0] && crudRoutes[0].path) || (routes[0] && routes[0].path) || '/';

  const raw = readTemplate(TEMPLATES_DIR, 'auth-page.tsx');
  // Split on the sentinel line ONLY when it is a whole line of its own (so the
  // header's descriptive mention of the sentinel can never be mistaken for it).
  const SPLIT_LINE = /^\/\* ===SCAFFOLD_AUTH_PAGE_SPLIT=== \*\/$/m;
  const parts = raw.split(SPLIT_LINE);
  if (parts.length !== 2) {
    ctx.warnings.push(
      'auth-page.tsx must contain exactly ONE `/* ===SCAFFOLD_AUTH_PAGE_SPLIT=== */` sentinel line — ' +
        `found ${parts.length - 1}; skipped sign-in/sign-up emission. Mount the auth blocks at ` +
        '/sign-in and /sign-up by hand (see blocks-onramp §4).',
    );
    return;
  }
  let signInBody = parts[0].replace(/\s*$/, '\n');
  let signUpBody = parts[1].replace(/^\s*\n/, '');
  signInBody = signInBody.split('__AUTHED_REDIRECT__').join(authedRedirect);
  signUpBody = signUpBody.split('__AUTHED_REDIRECT__').join(authedRedirect);

  for (const [seg, body] of [['sign-in', signInBody], ['sign-up', signUpBody]]) {
    const dest = path.join(srcDir, 'app', seg, 'page.tsx');
    if (fs.existsSync(dest)) {
      skip(dest, ctx);
      continue;
    }
    assertNoUnsubstituted(dest, body);
    write(dest, body, ctx);
  }
}

/**
 * (c) Idempotently append a route entry to src/app-routes.ts. The app uses a
 * named-key APP_ROUTES const object; we insert a new key just before the closing
 * `} as const;` of that object. Skips if a route with the same path already exists.
 */
function appendRoute(srcDir, route, ctx, { context = 'app', access = 'protected' } = {}) {
  const routesPath = path.join(srcDir, 'app-routes.ts');
  if (!fs.existsSync(routesPath)) {
    ctx.warnings.push(`app-routes.ts not found at ${rel(routesPath)} — skipped route append for ${route.path}`);
    return;
  }
  let src = fs.readFileSync(routesPath, 'utf8');
  const routePath = route.path;
  // Idempotency: a route already declaring this exact path?
  if (new RegExp(`path:\\s*'${escapeRegex(routePath)}'`).test(src)) {
    skip(routesPath + ` (route ${routePath})`, ctx);
    return;
  }
  const key = routeKey(route);
  const entry = `\n\t// App data route — generated by scaffold-frontend.mjs.\n` +
    `\t${key}: {\n` +
    `\t\tpath: '${routePath}' as Route,\n` +
    `\t\tsearchParams: {},\n` +
    `\t\taccess: '${access}' as RouteAccessType,\n` +
    `\t\tcontext: '${context}' as SchemaContext,\n` +
    `\t},\n`;

  // Insert before the APP_ROUTES object's closing `} as const;`. Anchor on the
  // first `} as const;` AFTER `export const APP_ROUTES`.
  const anchorIdx = src.indexOf('export const APP_ROUTES');
  if (anchorIdx === -1) {
    ctx.warnings.push(`app-routes.ts has no \`export const APP_ROUTES\` — skipped route append for ${routePath}`);
    return;
  }
  const closeIdx = src.indexOf('} as const;', anchorIdx);
  if (closeIdx === -1) {
    ctx.warnings.push(`app-routes.ts APP_ROUTES has no \`} as const;\` close — skipped route append for ${routePath}`);
    return;
  }
  src = src.slice(0, closeIdx) + entry + src.slice(closeIdx);
  write(routesPath, src, ctx);
}

/**
 * The Next.js app-router folder segments for a route path. Each URL segment
 * becomes one directory; a dynamic `[id]` segment is preserved verbatim. `/` (the
 * root) maps to no extra segments (the app/ dir itself).
 */
function routeSegments(p) {
  return String(p || '/')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean);
}

/** Tokenize a route path into lowercase words (also splitting on `/`). */
function pathWords(p) {
  return String(p || '')
    .replace(/^\//, '')
    .split('/')
    .flatMap((seg) => words(seg))
    .filter(Boolean);
}

/**
 * Route key (UPPER_SNAKE) from an explicit `route.key`, else the entity or path
 * (e.g. blog-post → BLOG_POSTS). The explicit key lets the flow-mount step give its
 * /org/<sub> routes keys that do NOT collide with the base template's existing
 * APP_ROUTES keys (the template already declares ORG_MEMBERS / ORG_SETTINGS /
 * ORG_INVITES for its own /orgs/[orgId]/… routes; a derived /org/members key would
 * duplicate them and break the `as const` object).
 */
function routeKey(route) {
  if (route.key) return String(route.key).toUpperCase();
  const base = route.entity ? pluralizeWords(route.entity) : pathWords(route.path);
  const key = base.join('_').toUpperCase();
  return key || 'ROUTE';
}

/**
 * (c) Idempotently append a NavItem to src/lib/navigation/sidebar-config.ts. We
 * insert into the `mainItems` array. Skips if an item with the same href exists.
 */
function appendNavItem(srcDir, route, label, ctx) {
  const navPath = path.join(srcDir, 'lib', 'navigation', 'sidebar-config.ts');
  if (!fs.existsSync(navPath)) {
    ctx.warnings.push(`sidebar-config.ts not found at ${rel(navPath)} — skipped nav append for ${route.path}`);
    return;
  }
  let src = fs.readFileSync(navPath, 'utf8');
  const href = route.path;
  if (new RegExp(`href:\\s*'${escapeRegex(href)}'`).test(src)) {
    skip(navPath + ` (nav ${href})`, ctx);
    return;
  }
  const id = (route.entity ? words(route.entity) : pathWords(route.path)).join('-') || 'item';
  // Use a generic icon already imported by the base template (RiHome4Line) to
  // avoid adding an import the agent may not have; the agent swaps it for a
  // domain icon. (SEAM noted in the comment.)
  const item = `\t\t{\n` +
    `\t\t\tid: '${id}',\n` +
    `\t\t\tlabel: '${label}',\n` +
    `\t\t\ticon: RiHome4Line, // SEAM: swap for a domain icon from @remixicon/react\n` +
    `\t\t\thref: '${href}',\n` +
    `\t\t\tisActive: isRouteActive?.('${routeKey(route)}'),\n` +
    `\t\t},\n`;

  // Anchor: the `mainItems` array literal. Insert before its closing `];`.
  const miIdx = src.indexOf('mainItems');
  if (miIdx === -1) {
    ctx.warnings.push(`sidebar-config.ts has no \`mainItems\` array — skipped nav append for ${href} (add a NavItem by hand)`);
    return;
  }
  const openIdx = src.indexOf('[', miIdx);
  const closeIdx = src.indexOf('];', openIdx);
  if (openIdx === -1 || closeIdx === -1) {
    ctx.warnings.push(`sidebar-config.ts \`mainItems\` array not closed with \`];\` — skipped nav append for ${href}`);
    return;
  }
  // Drop the whitespace-only run that immediately precedes `];` (the close's own
  // indentation) so the new item lands at the array's item indent and the close
  // re-indents cleanly to one tab — regardless of the original close indentation.
  const head = src.slice(0, closeIdx).replace(/[ \t]*$/, '');
  src = head + item + '\t' + src.slice(closeIdx);
  write(navPath, src, ctx);
}

// ════════════════════════════════════════════════════════════════════════════
// (f) FLOW-BLOCK MOUNTING — mount each brief flow's installed blocks on a
// reachable, testid-carrying Next surface (the #1 harness bug). Purely additive +
// GATED on brief.flows, so the canary (flows: [email-password]) emits ZERO new
// pages (email-password is handled by step (e); it is absent from FLOW_SURFACES).
//
// Drives off FLOW_SURFACES (which mirrors references/flows.json), and reuses the
// existing routeSegments() / appendRoute() / appendNavItem() / write() / skip() /
// assertNoUnsubstituted() so route + nav appends stay idempotent and tab-indented.
//
// Emits build/flow-surfaces.json {"<flow>":{path,shellTestid}} as the single source
// of truth the live-QA driver (RECON-2) reads (so QA navigates to the right surface
// instead of re-deriving it).
// ════════════════════════════════════════════════════════════════════════════

/** Indent every line of a JSX fragment by `pad` spaces (first line included). */
function indentBlock(text, pad) {
  const p = ' '.repeat(pad);
  return String(text)
    .split('\n')
    .map((l) => (l.length ? p + l : l))
    .join('\n');
}

/**
 * The ONE aggregated /account page, composed from whichever account-session sections
 * the brief installed. Imports + section JSX come VERBATIM from FLOW_SURFACES (sourced
 * from flows.json howto.usage). Idempotent: skips if the page already exists. Returns
 * the surface descriptor for flow-surfaces.json, or null when nothing was mounted.
 */
function emitAccountPage(srcDir, accountFlows, ctx) {
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
function emitDedicatedPage(srcDir, routeSpec, authedRedirect, ctx, { access }) {
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
function emitOrgPage(srcDir, routeSpec, ctx) {
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
function emitOrgStaticPages(srcDir, ctx) {
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
function emitAuthFormAddon(srcDir, fid, addon, ctx) {
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
function orgRouteFlowsIn(flows) {
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
function orgSubsIn(flows) {
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
function mountOrgContext(srcDir, ctx, orgSubs = []) {
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
function emitFlowSurfaces(srcDir, brief, crudRoutes, ctx) {
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
function writeFlowSurfacesManifest(brief, surfaces, ctx) {
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
  const targets = new Set([path.resolve(__dirname, '..', 'build', 'flow-surfaces.json')]);
  const appId = brief.naming?.db_name;
  if (appId) targets.add(path.resolve(__dirname, '..', 'build', appId, 'flow-surfaces.json'));
  for (const manifestPath of targets) {
    ctx.written.push(manifestPath);
    if (ctx.dryRun) continue;
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, body);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Small helpers
// ════════════════════════════════════════════════════════════════════════════

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rel(p) {
  return path.relative(process.cwd(), p);
}

/**
 * Fail loudly if any template placeholder survived substitution (outside comments).
 * `allow` lists INTENTIONAL placeholders that are real, documented seams (e.g. the
 * org ORG_ID_SEAM const) — those are skipped by the guard.
 */
function assertNoUnsubstituted(name, content, allow = []) {
  for (const line of content.split('\n')) {
    const t = line.trimStart();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    const m = line.match(/__[A-Z][A-Z0-9_]*__|__[a-zA-Z]+__/);
    if (m && !allow.includes(m[0])) {
      throw new Error(
        `scaffold-frontend: ${rel(name)} still contains unsubstituted placeholder ${m[0]} — ` +
          'template/substitution drift (see the entity-page.tsx header for the token list).',
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the data_model table a CRUD route binds to. The route entity is a UI ALIAS
 * (the testid/label name) that need NOT inflect to the table name — e.g. a route whose
 * entity is a product label (`{ entity: ledger-entry }`) may point at a differently-named
 * backing table (`accounting_entries`) that the alias neither pluralizes nor singularizes to.
 *
 * RESOLUTION ORDER (most authoritative first):
 *   1. explicit `route.table` — the brief author names the backing table directly. This
 *      is the GENERIC escape hatch for an alias entity (SG-A): when the route name is a
 *      product label that does not inflect to the column-name table, declare `table:` and
 *      the binding is unambiguous. Validated against the real table set; a typo HARD-FAILS.
 *   2. inflection match on the entity — plural(entity) == table, singular(table) == entity,
 *      or singular table name == entity (the common case; the canaries take this path).
 *   3. positional fallback — the next still-UNCONSUMED table, IN BRIEF ORDER, matched to
 *      this route by position. CRUD routes are conventionally authored in table order, so
 *      an un-inflectable alias with no `table:` still resolves to its sibling table rather
 *      than silently mis-scoping to the wrong one.
 * If NONE resolve, we HARD-FAIL naming the unresolved alias + the remaining tables — we
 * NEVER fall back to tables[0] (the old behavior), which silently emitted a broken
 * owner-scoped page against nonexistent SDK hooks for any alias route.
 *
 * `consumed` (a Set of already-bound table names) makes the positional fallback skip
 * tables earlier routes already claimed, so each route lands on a distinct table.
 */
function tableFor(brief, route, consumed = new Set()) {
  const tables = brief.data_model?.tables ?? [];
  const where = `route ${route.path || '(no path)'}`;

  // (1) explicit table: — authoritative. Must name a real table.
  if (route.table) {
    const hit = tables.find((t) => t.name === route.table || camel(t.name) === camel(route.table));
    if (hit) return hit;
    throw new Error(
      `scaffold-frontend: ${where} declares table: "${route.table}" but no data_model table ` +
        `has that name. Tables: ${tables.map((t) => t.name).join(', ') || '(none)'}.`,
    );
  }

  const ent = route.entity;
  if (!ent) {
    // No entity + no table: bind the next unconsumed table positionally (single-route apps
    // and the implicit-first-table convention). Fail loud if every table is taken.
    const next = tables.find((t) => !consumed.has(t.name));
    if (next) return next;
    throw new Error(
      `scaffold-frontend: ${where} has neither \`entity\` nor \`table\` and every data_model ` +
        `table is already bound to an earlier route — add an explicit \`table:\` to this route.`,
    );
  }

  // (2) inflection match.
  const pluralOfEntity = pluralizeWords(ent).join('');
  const byInflection =
    tables.find((t) => camel(t.name) === pluralOfEntity) ||
    tables.find((t) => singularFromTable(t.name) === kebab(ent)) ||
    tables.find((t) => camel(t.name) === camel(ent)); // singular table name
  if (byInflection) return byInflection;

  // (3) positional fallback — the next unconsumed table in brief order (alias without table:).
  const next = tables.find((t) => !consumed.has(t.name));
  if (next) return next;

  // (4) unresolved — fail LOUD instead of emitting a broken page.
  throw new Error(
    `scaffold-frontend: ${where} (entity "${ent}") does not match any data_model table by ` +
      `inflection and no unconsumed table remains for a positional bind. Add an explicit ` +
      `\`table:\` to the route. Tables: ${tables.map((t) => t.name).join(', ') || '(none)'}.`,
  );
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const [briefPath, appDir] = args;

  if (!briefPath || !appDir) {
    console.error('Usage: node scripts/scaffold-frontend.mjs <brief.yaml> <appDir> [--dry-run]');
    process.exit(2);
  }
  if (!fs.existsSync(briefPath)) {
    console.error(`scaffold-frontend: brief not found: ${briefPath}`);
    process.exit(2);
  }

  let brief;
  try {
    brief = loadBrief(briefPath);
  } catch (err) {
    if (err instanceof BriefError) {
      console.error(`scaffold-frontend: invalid brief — ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const srcDir = resolveAppSrc(appDir);
  const ctx = { dryRun, written: [], skipped: [], warnings: [] };

  const routes = brief.ui?.routes ?? [];
  const crudRoutes = routes.filter((r) => (r.kind || 'crud') === 'crud');

  // (a) CRUD infra — stamp once iff there is at least one CRUD route to use it.
  if (crudRoutes.length > 0) {
    stampCrudInfra(srcDir, ctx);
  }

  // (b)+(c)+(d) per route. `consumedTables` tracks which data_model tables CRUD routes
  // have already bound, so tableFor's positional fallback (SG-A) never binds two routes to
  // the same alias table.
  const consumedTables = new Set();
  for (const route of routes) {
    const kind = route.kind || 'crud';
    if (kind === 'crud') {
      const table = tableFor(brief, route, consumedTables);
      if (table?.name) consumedTables.add(table.name);
      // Pass srcDir + ctx so the FK input key + the parent label field derive from the
      // codegen-actual SDK column names (SG-A for columns), not the brief-derived camelCase.
      const fks = belongsToFks(brief, table, srcDir, ctx);
      // The N:M relations THIS table owns (source side) → a relation-manager section per
      // junction. [] for a non-N:M table → the page emits no manager (byte-identical canary).
      // srcDir + ctx so the linked table's label column resolves to its codegen-actual name.
      const m2mRels = manyToManyRelations(brief, table, srcDir, ctx);
      const { label } = emitEntityPage(srcDir, route, table, ctx, fks, m2mRels);
      appendRoute(srcDir, route, ctx, { context: 'app', access: 'protected' });
      appendNavItem(srcDir, route, label, ctx);
    } else {
      emitStubPage(srcDir, route, ctx);
      // A primary dashboard at '/' is the root — don't add a route/nav (the root
      // already exists). Other non-CRUD surfaces get a protected route entry.
      if (route.path && route.path !== '/') {
        appendRoute(srcDir, route, ctx, { context: 'app', access: 'protected' });
        appendNavItem(srcDir, route, route.label || titleCase(kebab(route.path)), ctx);
      }
    }
  }

  // (e) AUTH ROUTES — sign-in + sign-up wrappers for the email-password flow (gap #4):
  // the block→route + host-token-persist bridge so the RouteGuard sees an authed
  // session. No-op unless `email-password` is a chosen flow.
  emitAuthPages(srcDir, brief, crudRoutes, ctx);

  // (f) FLOW-BLOCK MOUNTING — mount each brief flow's installed blocks on a reachable,
  // testid-carrying surface (the #1 harness bug), and write build/flow-surfaces.json.
  // GATED on brief.flows → the canary (flows: [email-password]) emits ZERO new pages.
  emitFlowSurfaces(srcDir, brief, crudRoutes, ctx);

  // Report
  const verb = dryRun ? 'would write' : 'wrote';
  console.log(`scaffold-frontend: ${verb} ${ctx.written.length} files, skipped ${ctx.skipped.length} (already present) into ${rel(srcDir)}`);
  for (const f of ctx.written) console.log(`  + ${rel(f)}`);
  for (const f of ctx.skipped) console.log(`  = ${typeof f === 'string' ? f : rel(f)} (exists)`);
  for (const w of ctx.warnings) console.warn(`  ! ${w}`);
  console.log(`  routes: ${routes.length} (${crudRoutes.length} crud) for app at ${rel(srcDir)}`);
  if (ctx.warnings.length) {
    console.warn('scaffold-frontend: completed WITH warnings (see ! lines) — some route/nav appends were skipped; wire them by hand (see constructive-frontend).');
  }
}

main();
