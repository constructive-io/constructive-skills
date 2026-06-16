/**
 * delete-account-page.tsx — the /delete-account route for the `account-deletion` flow.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/delete-account/page.tsx WHEN the brief's `flows` include
 * `account-deletion`. This is the destination of the deletion-confirmation link.
 *
 * PROP-DRIVEN (not self-reading): AccountDeletionConfirmPage takes `token` + `userId`
 * as props, so THIS wrapper reads them from the URL (?token= & ?user_id=) and passes
 * them down. Source: references/flows.json `account-deletion` → howto.usage
 * (component, import, props are VERBATIM; the searchParams read is the wrapper's job,
 * which the usage snippet notes the page expects from the link).
 *
 * useSearchParams() requires a Suspense boundary in the Next app router, so the
 * block is mounted inside <Suspense>. The __AUTHED_REDIRECT__ seam is reused for the
 * post-deletion redirect target (sign-in is the natural landing, but we keep the
 * single redirect seam the scaffolder already substitutes).
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { AccountDeletionConfirmPage } from '@/blocks/auth/account-deletion-confirm-page/account-deletion-confirm-page';

function DeleteAccountInner() {
  const params = useSearchParams();
  // The deletion link carries ?token= and ?user_id= — read them here and pass to the
  // block (it does not read the URL itself).
  const token = params.get('token') ?? '';
  const userId = params.get('user_id') ?? '';
  return <AccountDeletionConfirmPage token={token} userId={userId} redirectTo="/sign-in" />;
}

export default function Page() {
  return (
    <main data-testid="delete-account-page" className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Suspense fallback={null}>
        <DeleteAccountInner />
      </Suspense>
    </main>
  );
}
