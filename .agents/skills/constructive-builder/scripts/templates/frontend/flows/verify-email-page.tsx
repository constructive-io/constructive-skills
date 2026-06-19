/**
 * verify-email-page.tsx — the /verify-email route for the `email-verification` flow.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/verify-email/page.tsx WHEN the brief's `flows` include
 * `email-verification`. Self-reading: VerifyEmailPage reads ?email_id= and ?token=
 * from the URL itself, so the wrapper just mounts the block with the app's nav hrefs.
 *
 * Source: references/flows.json `email-verification` → howto.usage (component, import,
 * props are VERBATIM from there). The __AUTHED_REDIRECT__ seam is the app's primary
 * entity surface (first CRUD route) — where a verified user lands.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import { VerifyEmailPage } from '@/blocks/auth/verify-email-page/verify-email-page';

export default function Page() {
  return <VerifyEmailPage signInHref="/sign-in" dashboardHref="__AUTHED_REDIRECT__" />;
}
