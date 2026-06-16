/**
 * org-context.tsx — the active-organization context for the authorization (org) flows.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/components/org-context.tsx — ONLY when the brief's `flows` include at
 * least one authorization flow (organization / org-members / org-roles / org-invites /
 * app-memberships). A non-org (owner/email) app NEVER receives this file (the whole
 * OrgContext is gated on org flows), so the frozen owner/email canary stays byte-identical.
 *
 * The generator substitutes ONE seam: `__ORG_SUBS__` → the ordered list of org admin
 * sub-routes this app ACTUALLY mounted (derived from the brief's org flows, e.g.
 * ['settings','members'] — NEVER a hard-coded 'roles'). The FIRST entry is the default
 * landing sub for the switcher / the /org redirect, so they route to a page that EXISTS
 * (a 404'd /org/<id>/roles when org-roles wasn't chosen is the bug this closes). Because
 * `__ORG_SUBS__` is the LONE seam, the file otherwise stamps verbatim.
 *
 * WHAT IT PROVIDES
 * ────────────────
 *   • OrgProvider({ children })  — runs useOrgMembershipsQuery once, exposes the signed-in
 *     actor's orgs ({ id, isOwner }) + isLoading, AND owns the ACTIVE-ORG state (defaulted
 *     to the actor's personal/owned org). This is the single source of truth for "which org
 *     am I acting in" — both the org-scoped entity creates and the switcher read it.
 *   • useActiveOrg()             — { orgId, orgs, isLoading, setActiveOrg }. `orgId` is the
 *     active org: the `/org/[orgId]/…` URL param when on an org page, else the OrgProvider's
 *     active-org state (defaulted to the owned org). Org-scoped entity-page creates read
 *     `orgId` as the AuthzEntityMembership `entity_id`; the OrgSwitcher reads it as the
 *     current selection and calls setActiveOrg on change.
 *   • resolveOwnedOrgId()        — the bootstrap "personal org" id from the TokenManager
 *     app→auth→admin chain (at bootstrap the user IS their own org, so userId === ownedOrgId).
 *     The active-org default + the /org index redirect fall back to this before the
 *     memberships query resolves.
 *   • ORG_SUBS / ORG_DEFAULT_SUB — the mounted org sub-routes + the first (default landing)
 *     sub, so the switcher / index route to a page that EXISTS (never a 404'd /org/<id>/roles).
 *   • OrgSwitcher()              — a dropdown of the actor's orgs; selecting one SETS the
 *     active org AND router.push(`/org/<id>/<sub>`) (the current sub if already on an org
 *     page, else ORG_DEFAULT_SUB), with a trailing "Create organization" item → /org/new.
 *
 * ORG DISPLAY LABEL: OrgMembership exposes no org name column, so the switcher labels
 * each org by its id. // TODO: join orgs (users type=2) for a human display label.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import * as React from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useOrgMembershipsQuery } from '@sdk/admin';
import { TokenManager } from '@/lib/auth/token-manager';
import { useAuth } from '@/store/app-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RiExpandUpDownLine, RiAddLine } from '@remixicon/react';

/**
 * The org admin sub-routes THIS app mounted, in flow order (generator-substituted from the
 * brief's org flows — e.g. organization→settings, org-members→members, org-roles→roles).
 * The first entry is the default landing sub for the switcher / the /org redirect, so they
 * route to a page that EXISTS. Empty ⇒ no org admin page mounted (the switcher still sets the
 * active org but does not navigate to a sub).
 */
export const ORG_SUBS: readonly string[] = __ORG_SUBS__;
export const ORG_DEFAULT_SUB: string | null = ORG_SUBS[0] ?? null;

/** One org the signed-in actor belongs to. `id` is the org's users-row id (entityId). */
export interface ActiveOrg {
  id: string;
  isOwner: boolean;
}

interface OrgContextValue {
  orgs: ActiveOrg[];
  isLoading: boolean;
  /** The active org id (the OrgProvider's selection; the URL param overrides it in useActiveOrg). */
  activeOrgId: string | null;
  setActiveOrg: (id: string) => void;
}

const OrgContext = React.createContext<OrgContextValue>({
  orgs: [],
  isLoading: false,
  activeOrgId: null,
  setActiveOrg: () => {},
});

/**
 * Runs the orgMemberships query ONCE, exposes the actor's org list, AND owns the active-org
 * state. `entityId` IS the org's users-row id; OrgMembership has no name field, so the switcher
 * labels by id. The active org DEFAULTS to the actor's owned (personal) org — the `isOwner`
 * membership, else the first membership, else the bootstrap token id (resolveOwnedOrgId) before
 * the query resolves — and is never auto-overwritten once the user picks one (setActiveOrg).
 */
export function OrgProvider({ children }: { children: React.ReactNode }) {
  // Subscribe to auth so the provider RE-RENDERS the instant the token lands. Sign-up/sign-in are
  // client-nav, so this layout-level provider never remounts; without the subscription it keeps the
  // stale pre-auth derivation and the FIRST same-session org-scoped create is blocked on an empty
  // active org. (Same class as the per-request app-token seam: never act before auth has landed.)
  const auth = useAuth();
  const isAuthed = Boolean(auth?.isAuthenticated && auth?.token?.accessToken);

  const { data, isLoading } = useOrgMembershipsQuery({
    selection: {
      fields: { id: true, entityId: true, isOwner: true },
      orderBy: ['CREATED_AT_DESC'],
      first: 100,
    },
    // Only fire once authenticated — an anonymous fire errors (permission denied) and React Query
    // caches the error, leaving orgs=[] for the whole session. The disabled→enabled (login)
    // transition triggers the fetch, so orgs populate WITHOUT a reload.
    enabled: isAuthed,
  });
  // `entityId` IS the org's users-row id; `isOwner` flags the actor's ownership. Both are
  // nullable in the SDK selection, so coalesce: drop rows with no id (never route to
  // /org/<null>) and default isOwner to false. No name field → the switcher labels by id.
  const orgs: ActiveOrg[] = (data?.orgMemberships?.nodes ?? [])
    .filter((n) => Boolean(n.entityId))
    .map((n) => ({
      id: n.entityId as string,
      isOwner: Boolean(n.isOwner),
      // TODO: join orgs (users type=2) for a display label — OrgMembership has no org name.
    }));

  // The default active org: the owned org, else the first membership, else the bootstrap token id
  // (so a fresh single-org actor — users==orgs at bootstrap — has a non-null active org even before
  // the memberships query resolves). The token id is read from the SUBSCRIBED auth slice FIRST
  // (reactive — re-derives the instant sign-up lands the token, same session), falling back to the
  // storage read for SSR/edge cases. `||` (not `??`) so an empty-string token read falls through.
  const bootstrapOrgId = auth?.token?.userId || resolveOwnedOrgId() || null;
  const defaultOrgId =
    orgs.find((o) => o.isOwner)?.id ?? orgs[0]?.id ?? bootstrapOrgId ?? null;

  // Active-org selection. Null until defaulted/picked; a user pick (setActiveOrg) is sticky.
  const [picked, setPicked] = React.useState<string | null>(null);
  const activeOrgId = picked || defaultOrgId || null;

  const value = React.useMemo<OrgContextValue>(
    () => ({ orgs, isLoading, activeOrgId, setActiveOrg: setPicked }),
    [orgs, isLoading, activeOrgId],
  );
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

/**
 * The active org id + the actor's org list + loading flag + a setter. `orgId` is the active
 * org: the `/org/[orgId]/…` URL param when an org admin page is mounted, else the OrgProvider's
 * active-org state (defaulted to the owned org). Org-scoped entity-page creates read `orgId` as
 * the AuthzEntityMembership `entity_id`; the OrgSwitcher reads it + calls setActiveOrg on change.
 */
export function useActiveOrg(): {
  orgId: string | null;
  orgs: ActiveOrg[];
  isLoading: boolean;
  setActiveOrg: (id: string) => void;
} {
  const params = useParams<{ orgId: string }>();
  const { orgs, isLoading, activeOrgId, setActiveOrg } = React.useContext(OrgContext);
  // The URL param wins when present (we ARE on an org admin page for that org); otherwise the
  // provider's active-org state (defaulted to the owned org) is the active org.
  const orgId = params?.orgId ?? activeOrgId ?? null;
  return { orgId, orgs, isLoading, setActiveOrg };
}

/**
 * The bootstrap "personal org" id — identical to the chain the org-scoped create used before
 * the active-org context. At bootstrap the signed-in user IS their own org (users==orgs), so
 * the TokenManager userId doubles as the owned org id. CLIENT-only (reads browser storage).
 */
export function resolveOwnedOrgId(): string {
  return (
    (typeof window !== 'undefined' &&
      (TokenManager.getToken('app').token?.userId ||
        TokenManager.getToken('auth').token?.userId ||
        TokenManager.getToken('admin').token?.userId)) ||
    ''
  );
}

/**
 * A dropdown of the actor's orgs. Selecting one SETS the active org AND routes to
 * `/org/<id>/<sub>` (the current sub when already on an org page, else ORG_DEFAULT_SUB — a
 * page that EXISTS, never a 404'd /org/<id>/roles). A trailing "Create organization" item
 * routes to /org/new. The create item renders even when the actor has no orgs yet.
 */
export function OrgSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { orgId, orgs, isLoading, setActiveOrg } = useActiveOrg();

  // The route is `/org/<id>/<sub>` → segs = ['', 'org', '<id>', '<sub>', …]; keep the current
  // sub when on an org admin page, else the first mounted sub. Never the hard-coded 'roles'.
  const segs = String(pathname || '').split('/');
  const onOrgPage = segs[1] === 'org' && segs[2] && segs[2] !== 'new';
  const sub = (onOrgPage && segs[3]) || ORG_DEFAULT_SUB;

  const activeLabel = orgId ? `Org ${String(orgId).slice(0, 8)}` : 'Select organization';

  function selectOrg(id: string) {
    setActiveOrg(id);
    // Only navigate to an org admin sub when one is mounted (else just set the active org —
    // e.g. an app with org-create but no org admin pages).
    if (sub) router.push(`/org/${id}/${sub}` as never);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="org-switcher"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="max-w-40 truncate">{isLoading ? 'Loading…' : activeLabel}</span>
        <RiExpandUpDownLine className="text-muted-foreground/60 h-4 w-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-55">
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.id}
            data-testid={`org-switcher-item-${o.id}`}
            onClick={() => selectOrg(o.id)}
            className="gap-2 py-2"
          >
            {/* TODO: join orgs (users type=2) for a display label — labelled by id for now. */}
            <span className="flex-1 truncate">{`Org ${String(o.id).slice(0, 8)}`}</span>
            {o.isOwner && <span className="text-muted-foreground text-xs">owner</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem
          data-testid="org-switcher-create"
          onClick={() => router.push('/org/new' as never)}
          className="gap-2 py-2"
        >
          <RiAddLine className="h-4 w-4 opacity-60" aria-hidden="true" />
          <span>Create organization</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
