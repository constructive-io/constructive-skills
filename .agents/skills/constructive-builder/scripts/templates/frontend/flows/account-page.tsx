/**
 * account-page.tsx — the aggregated /account surface for the account-session flows.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-frontend.mjs (step (f), flow-block mounting)
 * to <app>/src/app/account/page.tsx WHEN the brief's `flows` include at least one
 * account-session flow (profile / account-emails / change-password / sessions /
 * api-keys / connected-accounts / account-deletion). It renders ONLY the sections the
 * brief actually installed — the generator fills the imports + sections seams with
 * exactly those blocks (each component/import/prop sourced VERBATIM from
 * references/flows.json howto.usage).
 *
 * The shell carries data-testid="account-page" — the APP-controlled testid the live-QA
 * driver (scripts/live-qa.mjs, RECON-2) waits on before targeting each block's own
 * ACTION testids (save-profile-btn, change-password-submit, add-email-button, …).
 *
 * STEP-UP NOTE: change-password / sessions / api-keys / connected-accounts / the
 * danger card gate on a StepUpProvider, which scripts/wire-app.mjs mounts at the app
 * root ONLY when the `use-step-up` block is installed (i.e. the brief's flows include
 * `step-up`). If you chose one of those sections WITHOUT `step-up`, the scaffolder
 * emitted a warning — add `step-up` to the brief's flows so the gate has its provider.
 *
 * Lists with NO generated hook (sessions, api-keys, connected-accounts) are mounted
 * with an empty data prop + a // TODO seam — wire their data source per the block's
 * documented adapter prop. See references/flows.json for each flow's usage.
 *
 * AUTHOR THE PRESENTATION. The blocks are INGREDIENTS; this wrapper is a neutral default —
 * author the /account surface from the app's design.md (the section rhythm, headings,
 * grouping, type), per references/design-guide.md. PRESERVE the contract: the /account path,
 * data-testid="account-page", the mounted blocks, and each block's own ACTION testids.
 * Restyle and re-group freely; don't drop a section or hide a control.
 * ──────────────────────────────────────────────────────────────────────────
 */
'use client';

__IMPORTS__

export default function AccountPage() {
  return (
    <div data-testid="account-page" className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Account</h1>
      <div className="space-y-8">
__SECTIONS__
      </div>
    </div>
  );
}
