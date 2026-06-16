/**
 * provision.ts — Orchestrator for schema provisioning
 * Usage: pnpm run provision
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TEMPLATE: stamped by scripts/scaffold-provision.mjs. Placeholders:
 *   __SCHEMAS__      ← the domain-schema modules array, default
 *                      [ ['App Core', './schemas/core.js'] ]. One entry per
 *                      generated schema file under schemas/ (the generator writes
 *                      schemas/core.ts wholesale; multi-schema apps add more).
 *   __AUTH_PRESET__  ← the chosen auth preset key (e.g. 'auth:email', 'b2b',
 *                      'full', or 'minimal'). The auth-appendix below
 *                      (membership defaults + email-verify + users self_update) is
 *                      GATED on this — a non-auth app uses 'minimal' and the whole
 *                      appendix is skipped. An org preset ('b2b' | 'full') ALSO runs
 *                      the b2b org reconcile (personal-org sprt row + create_entity bit
 *                      + org-table grants — the org counterpart to the users self_update
 *                      step; see PLATFORM-GAPS.md GAP-1b/1c). This is preset-keyed
 *                      boilerplate, not domain code; the generic orchestration loop stays intact.
 *   __SITE_DOMAIN__  ← boolean: whether to backfill the per-app site-domain row that
 *                      send-email-link needs (else "Missing site configuration for
 *                      email"). True for email-capable presets / when email flows are
 *                      in the brief; the INSERT is idempotent + tenant-scoped.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { config } from './config.js';
import { Pool } from 'pg';

// Which auth preset this app provisioned with. 'minimal' = no users/sessions/memberships
// modules → skip the entire auth appendix (membership defaults, email-verify, users
// self-update). Any auth preset ('auth:email' | 'b2b' | 'full' | …) runs the appendix.
// Typed `string` (not the narrowed literal) so the `!== 'minimal'` gate stays valid
// whichever preset the scaffolder stamps in.
const AUTH_PRESET: string = '__AUTH_PRESET__';

// Whether this app exercises email flows (any non-minimal auth preset ships
// emails_module + the email-sending surface). When true the appendix backfills the
// per-app SITE DOMAIN row that send-email-link requires — without it every email
// send fails with "Missing site configuration for email" (see troubleshooting.md
// "Post-Provision: Missing site configuration for email"). Stamped from the brief by
// scaffold-provision.mjs: true for email-capable presets / when email flows are in
// the brief. Idempotent + tenant-scoped (writes ONLY this app's own domain row).
const SITE_DOMAIN_NEEDED: boolean = __SITE_DOMAIN__;

async function run(label: string, mod: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(60));
  const m = await import(mod);
  if (typeof m.default === 'function') await m.default();
  else throw new Error(`Module ${mod} does not export a default function`);
}

async function main() {
  console.log('\n  Schema Provisioning\n');
  console.log(`   Database:  ${config.databaseName}`);
  console.log(`   DB ID:     ${config.databaseId}`);

  if (!config.databaseId || !config.accessToken) {
    console.error('\n  Missing DATABASE_ID or ACCESS_TOKEN in .env');
    console.error('   Run: pnpm run create-db\n');
    process.exit(1);
  }

  // SHARED HUB = SCHEMAS-IN-ONE-DB: connect Pools to the hub db `constructive` explicitly.
  const pgAvailable = !!process.env.PGHOST;
  if (!pgAvailable && AUTH_PRESET !== 'minimal') {
    // NEVER skip the appendix silently. The `provision` npm script self-sources `eval "$(pgpm env)"`;
    // if PGHOST is still unset here, pgpm env exported nothing — warn loudly so a partial provision
    // is obvious rather than masked behind "success".
    console.warn(
      '\n  ⚠️  PGHOST unset — the AUTH APPENDIX (membership approval, email-verify, users self-update,' +
        ' org/public-read reconcile) will be SKIPPED → the app is only PARTIALLY provisioned.' +
        ' Reconcile with scripts/fix-grants.sh (+ fix-org-grants.sh for b2b), or re-run with PG env' +
        ' exported (eval "$(pgpm env)"). This is NOT a clean provision.\n',
    );
  }

  // --- Pass 1: Core domain schemas ---
  // One [label, module] tuple per generated schema file. The generator writes each
  // schemas/<name>.ts wholesale (BlueprintDefinition) and lists it here.
  const schemas = __SCHEMAS__;

  for (const [label, mod] of schemas) {
    await run(label, mod);
  }

  // ════════════════════════════════════════════════════════════════════════
  // AUTH APPENDIX — preset-keyed boilerplate. Only runs for auth-backed apps.
  // A 'minimal' (no-auth) app skips this entirely: there is no memberships /
  // user-identifiers / users table to fix up. Keep this block in sync with the
  // auth modules in create-db.ts MODULES.
  // ════════════════════════════════════════════════════════════════════════
  if (AUTH_PRESET !== 'minimal') {
    // --- Fix membership defaults + verify email (required for per-DB sign-in) ---
    if (pgAvailable) {
      console.log('\n  Enabling app membership defaults + verifying emails...');
      const defaultsPool = new Pool({ database: config.pgDatabase });

      const tenantPrefixLike = config.databaseName.replace(/_/g, '%') + '%'; // anchored: NO leading `%`
      const prefixRes = await defaultsPool.query(
        `SELECT nspname FROM pg_namespace
         WHERE nspname LIKE $1
               AND (nspname LIKE '%memberships-public' OR nspname LIKE '%memberships_public')
         ORDER BY nspname DESC LIMIT 1`,
        [tenantPrefixLike]
      );

      if (prefixRes.rows.length === 0) {
        console.warn(`   ⚠️  Could NOT resolve this tenant's schema prefix (anchored '${tenantPrefixLike}'). ` +
          `Approval + email-verify NOT applied; new signups stay unapproved.`);
      } else {
        const membershipsSchema: string = prefixRes.rows[0].nspname;
        const tenantPrefix = membershipsSchema.replace(/(-|_)memberships(-|_)public$/, '');

        await defaultsPool.query(
          `UPDATE "${membershipsSchema}".app_membership_defaults
           SET is_approved = TRUE, is_verified = TRUE`
        );
        console.log(`   membership defaults updated: ${membershipsSchema}`);

        const emailRes = await defaultsPool.query(
          `SELECT nspname AS schema_name FROM pg_namespace
           WHERE nspname LIKE $1
                 AND (nspname LIKE '%user-identifiers-public' OR nspname LIKE '%user_identifiers_public')
           ORDER BY nspname DESC LIMIT 1`,
          [tenantPrefix + '%']
        );
        if (emailRes.rows.length > 0) {
          const emailsSchema: string = emailRes.rows[0].schema_name;
          await defaultsPool.query(`ALTER TABLE "${emailsSchema}".emails ALTER COLUMN is_verified SET DEFAULT true`);
          await defaultsPool.query(`UPDATE "${emailsSchema}".emails SET is_verified = true WHERE is_verified = false`);
          console.log(`   emails verified: ${emailsSchema}`);
        } else {
          console.warn(`   ⚠️  NO emails schema matched prefix '${tenantPrefix}' — auto-verify-email NOT applied.`);
        }
      }

      await defaultsPool.end();
    }

    // --- SITE DOMAIN backfill (REQUIRED for email flows: magic-link / verify / reset) -----------
    // The per-DB provisioner creates API domains (the api-<sub>.localhost data host)
    // but NO services_public site-domain row. send-email-link resolves the outgoing
    // link's site from services_public.domains JOIN services_public.sites; with no row
    // it aborts every send with "Missing site configuration for email" — making email
    // flows un-exercisable hands-free. This block backfills the app's own site-domain
    // (subdomain = db-name, domain = 'localhost'), idempotently, then verifies the join
    // returns a row. Tenant-scoped: it only writes THIS app's database_id/site_id pair.
    // Exact SQL mirrors troubleshooting.md "Post-Provision: Missing site configuration
    // for email". Gated on SITE_DOMAIN_NEEDED so a no-email app skips it.
    if (pgAvailable && SITE_DOMAIN_NEEDED) {
      console.log('\n  Backfilling site-domain row (email-link site configuration)...');
      const domainPool = new Pool({ database: config.pgDatabase });
      try {
        // INSERT the site-domain for THIS db: resolve database + its sites row, then
        // INSERT (database_id, site_id, subdomain=db-name, domain='localhost').
        // ON CONFLICT (subdomain, domain) DO NOTHING → safe to re-run / no-op if present.
        // NB: $1 MUST carry explicit ::text casts. The pg driver sends the param untyped,
        // so Postgres tries to deduce $1's type independently at the SELECT-list output
        // position (subdomain VALUE) and the WHERE db.name comparison — and aborts with
        // "inconsistent types deduced for parameter $1" when the inferred types disagree.
        // Casting both occurrences to ::text pins one consistent type (FLOW-QA mail2 fix).
        const ins = await domainPool.query(
          `INSERT INTO services_public.domains (database_id, site_id, subdomain, domain)
           SELECT db.id, s.id, $1::text, 'localhost'
           FROM metaschema_public.database db
           JOIN services_public.sites s ON s.database_id = db.id
           WHERE db.name = $1::text
           ON CONFLICT (subdomain, domain) DO NOTHING`,
          [config.databaseName]
        );
        // Verify the join the email service relies on actually returns a row now.
        const verify = await domainPool.query(
          `SELECT d.subdomain, d.domain
           FROM services_public.domains d
           JOIN services_public.sites s ON d.site_id = s.id
           JOIN metaschema_public.database db ON d.database_id = db.id
           WHERE db.name = $1::text
           LIMIT 1`,
          [config.databaseName]
        );
        if (verify.rows.length > 0) {
          const { subdomain, domain } = verify.rows[0] as { subdomain: string; domain: string };
          console.log(`   site-domain ready: ${subdomain}.${domain} (${ins.rowCount ? 'inserted' : 'already present'})`);
        } else {
          // No row even after the INSERT → the app has no services_public.sites row yet
          // (the provisioner did not create one). Email sends will fail; surface it.
          console.warn('   ⚠️  No services_public.sites row resolved for this database — site-domain ' +
            'NOT created. Email flows will fail with "Missing site configuration for email". ' +
            'Confirm the app DB was provisioned with a site (see troubleshooting.md).');
        }
      } catch (err) {
        console.warn(`   ⚠️  site-domain backfill failed: ${(err as Error).message?.slice(0, 160)}. ` +
          'Email flows may fail with "Missing site configuration for email" — apply the INSERT in ' +
          'troubleshooting.md "Post-Provision: Missing site configuration for email" by hand.');
      } finally {
        await domainPool.end();
      }
    }

    // --- users-table self-UPDATE policy (REQUIRED for updateUser / profile / account-settings) ---
    if (pgAvailable) {
      console.log('\n  Applying users-table self-update policy (updateUser persistence)...');
      const idPool = new Pool({ database: config.pgDatabase });
      try {
        const schemaRes = await idPool.query(
          `SELECT id FROM metaschema_public.schema
           WHERE database_id = $1 AND name = 'users_public' LIMIT 1`,
          [config.databaseId]
        );
        const schemaId = schemaRes.rows[0]?.id;
        const tableRes = schemaId
          ? await idPool.query(
              `SELECT id FROM metaschema_public.table
               WHERE schema_id = $1 AND name = 'users' LIMIT 1`,
              [schemaId]
            )
          : { rows: [] as Array<{ id: string }> };
        const tableId = tableRes.rows[0]?.id;

        if (!schemaId || !tableId) {
          console.warn('   ⚠️  Could not resolve users_public.schema/users.table id — self-update ' +
            'policy NOT applied. updateUser will silently no-op.');
        } else {
          const { public_ } = await import('@constructive-io/sdk');
          const modulesClient = public_.createClient({
            endpoint: config.modulesEndpoint,
            headers: { Authorization: `Bearer ${config.accessToken}` },
          });
          await modulesClient.secureTableProvision.create({
            data: {
              databaseId: config.databaseId,
              schemaId,
              tableId,
              tableName: 'users',
              useRls: true,
              policies: [{
                $type: 'AuthzDirectOwner',
                permissive: true,
                privileges: ['update'],
                policy_name: 'self_update',
                data: { entity_field: 'id' },
              }] as unknown as Record<string, unknown>,
            },
            select: { id: true },
          }).unwrap();
          console.log('   users self-update policy applied (auth_upd_self_update)');
        }
      } catch (err) {
        console.warn(`   ⚠️  users self-update policy step failed: ${(err as Error).message?.slice(0, 160)}. ` +
          `updateUser may silently no-op.`);
      } finally {
        await idPool.end();
      }
    }

    // --- PUBLIC-READ (anonymous) reconcile for AuthzPublishable tables ---------------------
    // A `public-read+owner-write` brief intent emits an AuthzPublishable SELECT policy so
    // "published rows are readable by anyone". But the platform lands that policy as
    // `auth_sel_publishable` scoped to the `authenticated` role ONLY, and grants the
    // `anonymous` role NOTHING on the table — so a logged-OUT visitor hitting the public data
    // API gets "permission denied for table <t>" and AuthzPublishable is effectively
    // authenticated-only, never truly public (PLATFORM-GAPS.md GAP — public-read anon SELECT).
    // This step makes public-read MEAN public, idempotently and GENERICALLY:
    //   (1) GRANT USAGE on the domain schema + SELECT on each publishable table to `anonymous`
    //       (the table-level privilege the policy needs to even be evaluated), and
    //   (2) extend the publishable SELECT policy's role list to ALSO include `anonymous`
    //       (RLS still filters to is_published — anon sees ONLY published rows; the owner-write
    //       policies stay authenticated-only, so writes remain owner-scoped).
    // The publishable table set is DISCOVERED from pg_policies (a SELECT policy whose name ends
    // in `_publishable` = the platform's AuthzPublishable derivation) within THIS tenant's
    // domain schema — NEVER a hard-coded table/column. A non-public app has zero such policies,
    // so this is a clean no-op. Scoped to the app_public domain schema (where brief domain
    // tables land), resolved by DATABASE_ID (separator-tolerant name fallback), so it never
    // touches a sibling tenant or a platform/storage schema. The durable fix is upstream
    // (AuthzPublishable should grant the anonymous role itself).
    if (pgAvailable) {
      const pubPool = new Pool({ database: config.pgDatabase });
      try {
        // Resolve THIS tenant's domain (app_public) schema. Prefer DATABASE_ID (exact live
        // tenant); fall back to an anchored, separator-tolerant name match. No table literal.
        let appSchema: string | undefined;
        const byId = await pubPool.query(
          `SELECT schema_name FROM metaschema_public.schema
           WHERE database_id = $1 AND name = 'app_public' LIMIT 1`,
          [config.databaseId]
        );
        appSchema = byId.rows[0]?.schema_name as string | undefined;
        if (!appSchema) {
          const dbLike = config.databaseName.replace(/_/g, '%').replace(/-/g, '%') + '%';
          const byName = await pubPool.query(
            `SELECT schema_name FROM information_schema.schemata
             WHERE schema_name LIKE $1
             ORDER BY length(schema_name), schema_name LIMIT 1`,
            [dbLike + 'app%public']
          );
          appSchema = byName.rows[0]?.schema_name as string | undefined;
        }

        if (!appSchema) {
          // No domain schema resolved — nothing to do (can't be a public-read domain app).
        } else {
          // Discover publishable SELECT policies (platform AuthzPublishable → auth_sel_publishable).
          const pubPolicies = await pubPool.query(
            `SELECT tablename, policyname, roles
             FROM pg_policies
             WHERE schemaname = $1 AND cmd = 'SELECT' AND policyname ~ '_publishable$'`,
            [appSchema]
          );
          if (pubPolicies.rows.length > 0) {
            console.log('\n  Enabling anonymous read for AuthzPublishable (public-read) tables...');
            await pubPool.query(`GRANT USAGE ON SCHEMA "${appSchema}" TO anonymous`);
            let opened = 0;
            for (const row of pubPolicies.rows as Array<{ tablename: string; policyname: string; roles: string[] }>) {
              // (1) table-level SELECT grant — the policy then filters rows to published.
              await pubPool.query(`GRANT SELECT ON "${appSchema}"."${row.tablename}" TO anonymous`);
              // (2) extend the publishable policy's roles to include anonymous (idempotent).
              const roles: string[] = Array.isArray(row.roles) ? row.roles : [];
              if (!roles.includes('anonymous')) {
                const roleList = [...roles, 'anonymous']
                  .map((r) => `"${r.replace(/"/g, '""')}"`)
                  .join(', ');
                await pubPool.query(
                  `ALTER POLICY "${row.policyname}" ON "${appSchema}"."${row.tablename}" TO ${roleList}`
                );
              }
              opened += 1;
            }
            console.log(`   public-read enabled: ${opened} table(s) in ${appSchema} now readable by anonymous (published rows only)`);
          }
        }
      } catch (err) {
        console.warn(`   ⚠️  public-read (anonymous) reconcile failed: ${(err as Error).message?.slice(0, 160)}. ` +
          `Logged-out reads of published rows may 403 with "permission denied" — run scripts/fix-grants.sh <db-name> to backfill.`);
      } finally {
        await pubPool.end();
      }
    }

    // --- B2B ORG RECONCILE (org counterpart to the users self-update step) ---------------
    // Only for org/b2b presets. On the b2b tier a fresh email-password signup gets a `users`
    // row + a personal-org `org_memberships` row, but the per-tenant provisioner does NOT
    // create the personal-org row in the PRIVATE `org_memberships_sprt` that every
    // AuthzEntityMembership table's RLS reads (the AFTER-INSERT trigger only fires its sprt
    // INSERT when an app_memberships_sprt parent exists, and that table is empty after a bare
    // signup), nor grant the `create_entity` permission bit. Result: createCompany /
    // createUser(type=2) / org-member writes are RLS-rejected ("new row violates row-level
    // security policy") even though auth works. This block backfills, idempotently, for every
    // authenticated user (actor = entity = their own id = their personal org):
    //   (a) the create_entity bit on org_memberships (public),
    //   (b) the org_memberships INSERT/UPDATE + org_member_profiles SELECT grants to `authenticated`,
    //   (c) the personal-org sprt row in <db>-memberships-private.org_memberships_sprt (+ the
    //       app_memberships_sprt parent), which is the row the RLS actually checks.
    // WORKAROUND for an upstream provisioner gap — PLATFORM-GAPS.md GAP-1b/1c; gotchas
    // RLS-ORG-RECONCILE-001 / skill-supplements "Org-flow extension". The durable fix is upstream
    // (the dynamic per-tenant provisioner should emit these + seed the personal-org sprt row).
    // The standalone, tenant-anchored form is scripts/fix-org-grants.sh <db-name> (run that by
    // hand if you provisioned manually or need to scope to one --user).
    const isOrgPreset = AUTH_PRESET === 'b2b' || AUTH_PRESET === 'full';
    if (pgAvailable && isOrgPreset) {
      console.log('\n  Applying b2b org reconcile (personal-org sprt row + create_entity + org grants)...');
      const orgPool = new Pool({ database: config.pgDatabase });
      try {
        // Resolve this tenant's memberships-public/-private + permissions-public schemas,
        // anchored on the db-name prefix (NO leading %, separator-tolerant) — never a floating
        // %…% (which would bleed onto a sibling tenant). Mirrors fix-org-grants.sh.
        const dbLike = config.databaseName.replace(/_/g, '%').replace(/-/g, '%') + '%';
        const memPubRes = await orgPool.query(
          `SELECT table_schema FROM information_schema.tables
           WHERE table_name = 'org_memberships' AND table_schema LIKE $1
           ORDER BY length(table_schema), table_schema LIMIT 1`,
          [dbLike + 'memberships%public']
        );
        const memPrivRes = await orgPool.query(
          `SELECT table_schema FROM information_schema.tables
           WHERE table_name = 'org_memberships_sprt' AND table_schema LIKE $1
           ORDER BY length(table_schema), table_schema LIMIT 1`,
          [dbLike + 'memberships%private']
        );
        const permPubRes = await orgPool.query(
          `SELECT table_schema FROM information_schema.tables
           WHERE table_name = 'app_permissions' AND table_schema LIKE $1
           ORDER BY length(table_schema), table_schema LIMIT 1`,
          [dbLike + 'permissions%public']
        );
        const usersPubRes = await orgPool.query(
          `SELECT table_schema FROM information_schema.tables
           WHERE table_name = 'users' AND table_schema LIKE $1
           ORDER BY length(table_schema), table_schema LIMIT 1`,
          [dbLike + 'users%public']
        );
        const memPub = memPubRes.rows[0]?.table_schema as string | undefined;
        const memPriv = memPrivRes.rows[0]?.table_schema as string | undefined;
        const permPub = permPubRes.rows[0]?.table_schema as string | undefined;
        const usersPub = usersPubRes.rows[0]?.table_schema as string | undefined;

        if (!memPub || !memPriv || !permPub || !usersPub) {
          console.warn('   ⚠️  Could not resolve the org/permissions/users schemas — b2b org ' +
            'reconcile NOT applied. createCompany/org writes may be RLS-denied (gotchas RLS-ORG-RECONCILE-001). ' +
            'Run scripts/fix-org-grants.sh <db-name> by hand.');
        } else {
          // Resolve the create_entity bit(64) literal by NAME (the bit position is platform-owned;
          // bit 5 = 0x20). Never hard-code the bit string.
          const ceRes = await orgPool.query(
            `SELECT bitstr::text AS bit FROM "${permPub}".app_permissions WHERE name = 'create_entity' LIMIT 1`
          );
          const ceBit = ceRes.rows[0]?.bit as string | undefined;
          if (!ceBit) {
            console.warn(`   ⚠️  create_entity permission not found in ${permPub}.app_permissions — ` +
              'b2b org reconcile NOT applied. Confirm the b2b preset was provisioned.');
          } else {
            // (b) org-table grants (idempotent).
            await orgPool.query(`GRANT USAGE ON SCHEMA "${memPub}" TO authenticated`);
            await orgPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${memPub}".org_memberships TO authenticated`);
            await orgPool.query(`GRANT SELECT ON "${memPub}".org_member_profiles TO authenticated`);

            // (a)+(c) per actor: create_entity bit + personal-org sprt rows. One statement-stream,
            // ON CONFLICT … DO UPDATE so re-runs are a no-op. $1 = create_entity bit, $2 = actor.
            const usersRes = await orgPool.query(`SELECT id FROM "${usersPub}".users`);
            let reconciled = 0;
            for (const row of usersRes.rows as Array<{ id: string }>) {
              const actor = row.id;
              await orgPool.query(
                `INSERT INTO "${memPriv}".app_memberships_sprt (is_owner, is_admin, permissions, actor_id)
                 VALUES (true, true, $1::bit(64), $2)
                 ON CONFLICT (actor_id) DO UPDATE
                   SET permissions = "${memPriv}".app_memberships_sprt.permissions | $1::bit(64),
                       is_owner = true, is_admin = true;
                 INSERT INTO "${memPriv}".org_memberships_sprt (is_owner, is_admin, permissions, actor_id, entity_id, is_read_only)
                 VALUES (true, true, $1::bit(64), $2, $2, false)
                 ON CONFLICT (actor_id, entity_id) DO UPDATE
                   SET permissions = "${memPriv}".org_memberships_sprt.permissions | $1::bit(64),
                       is_owner = true, is_admin = true, is_read_only = false;
                 UPDATE "${memPub}".org_memberships
                   SET permissions = permissions | $1::bit(64), granted = granted | $1::bit(64)
                   WHERE actor_id = $2 AND entity_id = $2;`,
                [ceBit, actor]
              );
              reconciled += 1;
            }
            console.log(`   b2b org reconcile applied: ${reconciled} actor(s) in ${memPriv} (personal-org sprt + create_entity + org grants)`);
          }
        }
      } catch (err) {
        console.warn(`   ⚠️  b2b org reconcile step failed: ${(err as Error).message?.slice(0, 160)}. ` +
          `createCompany/org writes may be RLS-denied — run scripts/fix-org-grants.sh <db-name> (gotchas RLS-ORG-RECONCILE-001).`);
      } finally {
        await orgPool.end();
      }
    }
  }

  console.log('\n  All schemas provisioned successfully!\n');
}

main().catch((err) => {
  console.error('Provision failed:', err.message ?? err);
  process.exit(1);
});
