/**
 * auth-page.tsx — the sign-in + sign-up route wrappers for the email-password flow.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: this ONE file holds BOTH route pages, separated by a single sentinel
 * line (an SDK-SPLIT comment). scripts/scaffold-frontend.mjs splits on that line and
 * stamps:
 *   • the first half  → <app>/src/app/sign-in/page.tsx
 *   • the second half → <app>/src/app/sign-up/page.tsx
 * iff the brief's `flows` include `email-password` (gap #4). It is idempotent —
 * either page already on disk is left untouched. (The sentinel is matched as a whole
 * line, so this descriptive mention of it cannot be mistaken for the split point.)
 *
 * WHY THIS EXISTS: scripts/wire-app.mjs installs the auth blocks (auth-sign-in-card /
 * auth-sign-up-card) as components, but nothing in the scaffold mounts them at Next
 * routes OR bridges their result into the host's token stores — so the RouteGuard
 * bounces the protected app shell back to `/` (the live-QA `authed-shell` timeout).
 * These wrappers ARE that block→route + host-token-persist bridge.
 *
 * AUTHOR THE PRESENTATION. The block (SignInCard / SignUpCard) is an INGREDIENT; the
 * <main> wrapper below is a neutral default — author the sign-in/up surface from the app's
 * design.md (the masthead, the layout, type, any split/brand panel), per
 * references/art-direction.md. PRESERVE the contract: the route paths (/sign-in, /sign-up,
 * outside the shell), the block mount, the token-persist bridge (justAuthenticated latch →
 * TokenManager.setToken('admin') + setAuthenticated → router.push), and any social-btn-* /
 * cross-origin testids the flow add-ons seam in. Restyle freely; don't drop the bridge.
 *
 * HOST-SIDE TOKEN PERSISTENCE (the two-auth-store fix): the blocks delegate token
 * persistence to the host's onSuccess (they only return the result). We mirror the
 * template's native useLogin:
 *   toApiToken(result) → TokenManager.setToken(token, true, 'admin') →
 *   useAuthActions().setAuthenticated({ id, email }, token, true)
 * so BOTH the TokenManager store (which the SDK reads for Authorization) AND the
 * Zustand auth store (which the RouteGuard/auth-context read) see an authed session,
 * then router.push lands the protected app shell.
 *
 * Placeholder the generator substitutes:
 *   __AUTHED_REDIRECT__ ← the first CRUD route's path (the app's primary entity
 *                         surface — e.g. /todos, /posts, /companies). Where a
 *                         successful sign-in / sign-up lands.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

import { useRef } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { SignInCard, type SignInResult } from '@/blocks/auth/sign-in-card/sign-in-card';
import { TokenManager } from '@/lib/auth/token-manager';
import { toApiToken } from '@/lib/auth/token-utils';
import { useAuthActions } from '@/store/app-store';

const AUTHED_REDIRECT = '__AUTHED_REDIRECT__';

// MODULE-SCOPED success latch — set true synchronously in handleSuccess BEFORE persisting the
// token, so the stale-token guard below skips the clear on the re-renders that router.push +
// setAuthenticated trigger. A per-mount/useEffect clear races handleSuccess and wipes the
// freshly-earned token (see references/platform-gaps.md GAP-13). A fresh full page-load
// re-evaluates this module (latch starts false), so a real leftover token on a cold visit is
// still cleared.
let justAuthenticated = false;

export default function SignInPage() {
  const router = useRouter();
  const authActions = useAuthActions();

  // STALE-TOKEN GUARD: this is an UNAUTHENTICATED entry point — by definition nobody
  // reaching it is signed in (the RouteGuard already bounces genuinely-authed users away
  // before this page renders). So a token sitting in storage here is necessarily a
  // leftover/expired one, and the SDK auth client otherwise attaches it as
  // `Authorization: Bearer …` on the unauthenticated signIn request — which the server
  // rejects with UNAUTHENTICATED (a stale `constructive-auth-token:admin` poisons a clean
  // sign-in). Clear it on mount BEFORE the block renders/submits so signIn goes out
  // bearer-less. (Durable fix is upstream — the auth client must not bearer signUp/signIn;
  // see references/platform-gaps.md.)
  // Latch-guarded stale-token clear (see module-scoped justAuthenticated above): clears a
  // genuinely-leftover token on a cold visit, but NEVER the token a sign-in/up just earned.
  const clearedOnce = useRef(false);
  if (!clearedOnce.current && !justAuthenticated) {
    clearedOnce.current = true;
    if (typeof window !== 'undefined') TokenManager.clearToken('admin');
  }

  function handleSuccess(result: SignInResult) {
    justAuthenticated = true; // latch BEFORE persisting so post-push re-renders skip the clear
    const token = toApiToken(result);
    if (token) {
      TokenManager.setToken(token, true, 'admin');
      authActions.setAuthenticated(
        { id: token.userId ?? token.id, email: '' },
        token,
        true,
      );
    }
    router.push(AUTHED_REDIRECT as Route);
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <SignInCard
        signUpHref="/sign-up"
        forgotPasswordHref="/forgot-password"
        onSuccess={handleSuccess}
      />
    </main>
  );
}
/* ===SCAFFOLD_AUTH_PAGE_SPLIT=== */
'use client';

import { useRef } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';

import { SignUpCard, type SignUpResult } from '@/blocks/auth/sign-up-card/sign-up-card';
import { TokenManager } from '@/lib/auth/token-manager';
import { toApiToken } from '@/lib/auth/token-utils';
import { useAuthActions } from '@/store/app-store';

const AUTHED_REDIRECT = '__AUTHED_REDIRECT__';

// MODULE-SCOPED success latch — set true synchronously in handleSuccess BEFORE persisting the
// token, so the stale-token guard below skips the clear on the re-renders that router.push +
// setAuthenticated trigger. A per-mount/useEffect clear races handleSuccess and wipes the
// freshly-earned token (see references/platform-gaps.md GAP-13). A fresh full page-load
// re-evaluates this module (latch starts false), so a real leftover token on a cold visit is
// still cleared.
let justAuthenticated = false;

export default function SignUpPage() {
  const router = useRouter();
  const authActions = useAuthActions();

  // STALE-TOKEN GUARD: this is an UNAUTHENTICATED entry point — by definition nobody
  // reaching it is signed in (the RouteGuard already bounces genuinely-authed users away
  // before this page renders). So a token sitting in storage here is necessarily a
  // leftover/expired one, and the SDK auth client otherwise attaches it as
  // `Authorization: Bearer …` on the unauthenticated signUp request — which the server
  // rejects with UNAUTHENTICATED (the evaluator proved a stale
  // `constructive-auth-token:admin` makes signUp return UNAUTHENTICATED). Clear it on mount
  // BEFORE the block renders/submits so signUp goes out bearer-less. (Durable fix is
  // upstream — the auth client must not bearer signUp/signIn; see
  // references/platform-gaps.md.)
  // Latch-guarded stale-token clear (see module-scoped justAuthenticated above): clears a
  // genuinely-leftover token on a cold visit, but NEVER the token a sign-in/up just earned.
  const clearedOnce = useRef(false);
  if (!clearedOnce.current && !justAuthenticated) {
    clearedOnce.current = true;
    if (typeof window !== 'undefined') TokenManager.clearToken('admin');
  }

  function handleSuccess(result: SignUpResult) {
    justAuthenticated = true; // latch BEFORE persisting so post-push re-renders skip the clear
    const token = toApiToken(result);
    if (token) {
      TokenManager.setToken(token, true, 'admin');
      authActions.setAuthenticated(
        { id: token.userId ?? token.id, email: '' },
        token,
        true,
      );
    }
    router.push(AUTHED_REDIRECT as Route);
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <SignUpCard
        showPasswordConfirm={false}
        signInHref="/sign-in"
        onSuccess={handleSuccess}
      />
    </main>
  );
}
