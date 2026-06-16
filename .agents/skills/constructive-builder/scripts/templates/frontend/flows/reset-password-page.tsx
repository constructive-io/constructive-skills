/**
 * reset-password-page.tsx — the /reset-password route for the `password-reset` flow.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/reset-password/page.tsx WHEN the brief's `flows` include
 * `password-reset`. This is the destination of the reset link emailed by the
 * forgot-password card.
 *
 * Self-reading: ResetPasswordPage reads ?token= and ?role_id= from the URL itself.
 * Source: references/flows.json `password-reset` block `auth-reset-password-page`
 * (default export, sibling of the forgot-password page).
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import ResetPasswordPage from '@/blocks/auth/reset-password-page/reset-password-page';

export default function Page() {
  return <ResetPasswordPage />;
}
