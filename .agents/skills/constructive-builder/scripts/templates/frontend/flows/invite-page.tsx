/**
 * invite-page.tsx — the /invite route for the `org-invites` flow.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/invite/page.tsx WHEN the brief's `flows` include `org-invites`.
 * This is the destination of an org/app-membership invitation link.
 *
 * Self-reading: InvitationAcceptancePage reads ?token= and ?kind= from the URL
 * itself. Source: references/flows.json `org-invites` → howto.usage (default import,
 * verbatim).
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import InvitationAcceptancePage from '@/blocks/auth/invitation-acceptance-page/invitation-acceptance-page';

export default function Page() {
  return <InvitationAcceptancePage />;
}
