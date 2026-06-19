/**
 * scripts/lib/scaffold-frontend/paths.mjs — the on-disk locations scaffold-frontend reads/writes.
 *
 * These were module-level consts in scaffold-frontend.mjs computed from THAT file's
 * `__dirname` (scripts/). This module lives two levels deeper (scripts/lib/scaffold-frontend/),
 * so it recomputes the SAME absolute paths from its own location:
 *   SCRIPTS_DIR  = scripts/                      (two dirs up from here)
 *   TEMPLATES_DIR = scripts/templates/frontend   (entity-page.tsx, auth-page.tsx)
 *   CRUD_TEMPLATES_DIR / FLOWS_TEMPLATES_DIR     (crud/* + flows/*)
 *   BUILD_DIR     = <skill>/build                (the flow-surfaces.json manifest target —
 *                  formerly path.resolve(__dirname, '..', 'build') with __dirname=scripts/).
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/lib/scaffold-frontend → scripts/lib → scripts
export const SCRIPTS_DIR = path.resolve(__dirname, '..', '..');

export const TEMPLATES_DIR = path.resolve(SCRIPTS_DIR, 'templates', 'frontend');
export const CRUD_TEMPLATES_DIR = path.join(TEMPLATES_DIR, 'crud');
export const FLOWS_TEMPLATES_DIR = path.join(TEMPLATES_DIR, 'flows');

// The skill root's build/ dir (scripts/..) — where the flow-surfaces.json manifest lands.
export const BUILD_DIR = path.resolve(SCRIPTS_DIR, '..', 'build');
