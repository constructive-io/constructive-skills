/**
 * forgot-password-page.tsx — the /forgot-password route for the `password-reset` flow.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/forgot-password/page.tsx WHEN the brief's `flows` include
 * `password-reset`. The sign-in-card already links here via forgotPasswordHref
 * (wired in the auth-page template) — this page IS that link's destination.
 *
 * Self-reading: ForgotPasswordPage owns its own form + submit. Source:
 * references/flows.json `password-reset` → howto.usage (default import, verbatim).
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import ForgotPasswordPage from '@/blocks/auth/forgot-password-page/forgot-password-page';

export default function Page() {
  return <ForgotPasswordPage />;
}
