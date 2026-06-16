/**
 * create-db.ts — Create a new database
 *
 * Signs up, provisions a database, and writes credentials to .env.
 * Usage: pnpm run create-db
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-provision.mjs. The ONE placeholder:
 *   __MODULES__  ← the COMPUTED module closure for this app, spliced in as the
 *                  literal array body. The generator computes it from the brief:
 *                  union(chosen flows' backend.modules from references/flows.json)
 *                  + node→module deps (limits_module:<scope>, realtime_module,
 *                  i18n_module, Search* modules) + relation closure (M2M membership
 *                  junctions pull b2b). De-duplicated; scoped entries are NATIVE
 *                  ['name', { scope }] tuples — NEVER colon strings, NEVER ['all'].
 * ──────────────────────────────────────────────────────────────────────────
 */
import { auth, public_ } from '@constructive-io/sdk';
import { config } from './config.js';
import { withRetry } from './helpers.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicit module list — NEVER ['all']. COMPUTED from the brief's chosen flows +
// node/relation dependency closure. Scoped entries are NATIVE ['name', { scope }]
// tuples — never colon strings.
const MODULES = __MODULES__;

async function main() {
  const ts = Date.now();
  const databaseName = config.databaseName;
  const uniqueEmail = config.adminEmail.replace('@', `+${ts}@`);

  console.log('\n  Create Database\n');
  console.log(`   Database:  ${databaseName}`);
  console.log(`   Admin:     ${uniqueEmail}`);

  // --- Step 1: Sign up ---
  const authClient = auth.createClient({
    endpoint: config.authEndpoint,
  });

  const signUpData = await authClient.mutation
    .signUp(
      { input: { email: uniqueEmail, password: config.adminPassword } },
      { select: { result: { select: { userId: true, accessToken: true } } } },
    )
    .unwrap();

  const userId = (signUpData as Record<string, Record<string, Record<string, string>>>)
    ?.signUp?.result?.userId;
  const accessToken = (signUpData as Record<string, Record<string, Record<string, string>>>)
    ?.signUp?.result?.accessToken;

  if (!accessToken || !userId) {
    console.error('No token/userId returned from signUp');
    process.exit(1);
  }
  console.log(`   Signed up (ID: ${userId})`);

  // --- Step 2: Provision database (modules.localhost) ---
  console.log('\n   Provisioning database...');
  const modulesClient = public_.createClient({
    endpoint: config.modulesEndpoint,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const provData = await withRetry(() =>
    modulesClient.databaseProvisionModule
      .create({
        data: {
          databaseName,
          ownerId: userId,
          subdomain: databaseName,
          domain: 'localhost',
          modules: MODULES,
          bootstrapUser: true,
          options: {},
        },
        select: { id: true, databaseId: true, errorMessage: true },
      })
      .unwrap()
  );

  const dbProv = (provData as Record<string, Record<string, Record<string, string | null>>>)
    ?.createDatabaseProvisionModule?.databaseProvisionModule;

  if (!dbProv || !dbProv.databaseId) {
    console.error(`DB Provision failed: ${dbProv?.errorMessage || 'unknown'}`);
    process.exit(1);
  }

  const databaseId = dbProv.databaseId;
  console.log(`   Database ready (ID: ${databaseId})`);

  // --- Step 3: Write .env ---
  const envPath = path.resolve(__dirname, '../../../.env');
  console.log(`\n   Writing credentials to ${envPath}`);

  let envContent = '';
  try { if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8'); } catch { /* ok */ }

  const newVars: Record<string, string> = {
    DATABASE_ID: databaseId,
    DATABASE_NAME: databaseName,
    ACCESS_TOKEN: accessToken,
    OWNER_ID: userId,
  };

  let content = envContent;
  for (const [key, val] of Object.entries(newVars)) {
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }

  fs.writeFileSync(envPath, content.trim() + '\n');
  console.log('   .env updated');

  console.log('\n  Database created. Run `pnpm run provision` to apply schemas.\n');
}

main().catch((err) => {
  console.error('create-db failed:', err.message ?? err);
  process.exit(1);
});
