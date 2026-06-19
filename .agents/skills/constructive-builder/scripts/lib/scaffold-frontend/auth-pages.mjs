/**
 * scripts/lib/scaffold-frontend/auth-pages.mjs — (e) AUTH BRIDGE PAGES.
 *
 * When the brief's `flows` include `email-password`, emit the sign-in + sign-up route pages
 * from templates/frontend/auth-page.tsx. wire-app.mjs installs the auth-sign-in-card /
 * auth-sign-up-card BLOCKS but nothing mounts them at Next routes or bridges their result into
 * the host token stores, so the RouteGuard bounces the protected shell back to `/` (gap #4).
 * These wrappers ARE that block→route + host-token-persist bridge (the proven two-auth-store
 * fix). No-op unless email-password is a chosen flow.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TEMPLATES_DIR } from './paths.mjs';
import { readTemplate, write, skip, assertNoUnsubstituted } from './writers.mjs';

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
export function emitAuthPages(srcDir, brief, crudRoutes, ctx) {
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
