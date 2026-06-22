/**
 * org-page.tsx — a generic /org/[orgId]/<sub> admin surface for the authorization flows.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/org/[orgId]/<sub>/page.tsx (one file per authorization route) WHEN
 * the brief's `flows` include the matching authorization flow (organization /
 * org-members / org-roles / org-invites / app-memberships). The generator fills the
 * seams with exactly the block(s) that flow installs (component/import/props VERBATIM
 * from references/flows.json howto.usage).
 *
 * The shell carries data-testid="org-<sub>-page" — the APP-controlled testid the
 * live-QA driver (RECON-2) waits on before targeting each block's own ACTION testids
 * (add-role-button, invite-submit, save-settings-submit, …).
 *
 * ORG ID FROM THE URL: every org admin page lives under app/org/[orgId]/, so the
 * active org id is the `orgId` route param — read UNCONDITIONALLY via
 * `const { orgId } = useParams()` and passed to each block's `orgId` prop. There is no
 * inline-mint seam: the org is selected by the OrgSwitcher / the /org redirect (which
 * resolves the bootstrap personal org) and carried in the URL. See
 * src/components/org-context.tsx (OrgProvider / OrgSwitcher / resolveOwnedOrgId).
 *
 * The generator fills these seams: the block + hook imports (__ORG_IMPORTS__), any
 * extra page hooks (__ORG_HOOKS__), the page title, the shell testid, and the block
 * JSX body (which reads the `orgId` const).
 *
 * AUTHOR THE PRESENTATION. The block(s) are INGREDIENTS; this wrapper is a neutral default —
 * author each /org/[orgId]/<sub> surface from the app's design.md, per
 * references/design-guide.md. PRESERVE the contract: the /org/[orgId]/<sub> path shape, the
 * org-<sub>-page shell testid, the mounted block(s), and the orgId-from-useParams wiring.
 * Restyle freely; keep the path + block + sentinel.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';
import { useParams } from 'next/navigation';

__ORG_IMPORTS__

export default function OrgPage() {
__ORG_HOOKS__  const { orgId } = useParams<{ orgId: string }>();
  return (
    <div data-testid="__ORG_SHELL_TESTID__" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">__ORG_PAGE_TITLE__</h1>
      <div className="space-y-6">
__ORG_BODY__
      </div>
    </div>
  );
}
