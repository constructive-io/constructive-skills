#!/usr/bin/env node

import process from 'node:process';

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const args = { mode };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = rest[i + 1];
    args[key] = value;
    i += 1;
  }

  return args;
}

function pass(message) {
  console.log(`  PASS: ${message}`);
}

function fail(message) {
  console.error(`  FAIL: ${message}`);
  process.exit(1);
}

async function graphql(endpoint, query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    fail(`GraphQL POST to ${endpoint} returned HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    const details = json.errors.map((error) => error?.message).filter(Boolean).join('; ');
    fail(`GraphQL POST to ${endpoint} returned schema errors: ${details || 'unknown error'}`);
  }

  return json.data;
}

function requireFields(actual, required, label) {
  for (const name of required) {
    if (!actual.includes(name)) {
      fail(`${label} is missing required field '${name}'`);
    }
    pass(`${label} includes '${name}'`);
  }
}

// PostGraphile INFLECTION-tolerant field matcher (fixes the underscored/multi-word false-FAIL:
// a brief's snake_case table `audit_log` surfaces on the GraphQL query root as the camelCase,
// pluralized field `auditLogs` — never the raw `audit_log`). We don't know which inflector is
// active (classic emits `allAuditLogs`; the simplify-inflector Constructive uses emits
// `auditLogs`), so we accept ANY of the candidate inflections of the snake_case name AND fall
// back to a case-insensitive de-underscored comparison so multi-word tables always pass.

// snake_case → camelCase: audit_log → auditLog
function camelize(snake) {
  return String(snake)
    .toLowerCase()
    .replace(/[_-]+([a-z0-9])/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

// Minimal English pluralizer matching PostGraphile/inflection's common cases (enough for
// identifier-shaped table names): …y→…ies (but not vowel+y), s/x/z/ch/sh→…es, else +s.
function pluralize(word) {
  if (/[^aeiou]y$/i.test(word)) return word.replace(/y$/i, 'ies');
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

// Collapse to a comparable key: lowercase, strip separators, and singularize a trailing
// plural so `audit_log`, `auditLog`, `auditLogs`, `allAuditLogs` all reduce to the same root.
function normalizeFieldKey(name) {
  let s = String(name).toLowerCase().replace(/[_-]+/g, '');
  // drop a leading PostGraphile classic "all" connection prefix (allAuditLogs → auditlogs)
  if (s.startsWith('all') && s.length > 3) s = s.slice(3);
  // crude singularize: …ies→…y, …es→… (only when it leaves a non-empty stem), …s→…
  if (s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith('es') && s.length > 3) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 1) s = s.slice(0, -1);
  return s;
}

// True if `field` (a raw snake_case table name from the brief) is satisfied by some live
// query-root field in `actual`. Accepts the raw name, the camelCase singular/plural, the
// classic `all<Plural>` connection, or any field whose normalized key matches.
function fieldSatisfied(actual, field) {
  const camel = camelize(field);
  const camelPlural = pluralize(camel);
  const candidates = new Set([
    field,
    camel,
    camelPlural,
    `all${camelPlural.charAt(0).toUpperCase()}${camelPlural.slice(1)}`,
  ]);
  for (const c of candidates) {
    if (actual.includes(c)) return c;
  }
  const wantKey = normalizeFieldKey(field);
  for (const a of actual) {
    if (normalizeFieldKey(a) === wantKey) return a;
  }
  return null;
}

// Inflection-tolerant variant of requireFields for the per-DB QUERY ROOT, where PostGraphile
// inflection (camelCase + pluralization) means a brief's snake_case table never appears verbatim.
function requireInflectedFields(actual, required, label) {
  for (const name of required) {
    const hit = fieldSatisfied(actual, name);
    if (!hit) {
      fail(
        `${label} is missing required field for table '${name}' ` +
          `(looked for the raw name and its PostGraphile inflections, e.g. '${camelize(name)}' / '${pluralize(camelize(name))}')`
      );
    }
    pass(hit === name ? `${label} includes '${name}'` : `${label} includes '${name}' (as inflected field '${hit}')`);
  }
}

async function verifyPlatform(args) {
  const apiEndpoint = args['platform-api'];
  const authEndpoint = args['platform-auth'];

  if (!apiEndpoint || !authEndpoint) {
    fail('platform mode requires --platform-api and --platform-auth');
  }

  const schemaQuery = `query VerifyPlatformSchema {
    __schema {
      queryType { name }
      mutationType { name }
    }
  }`;

  const authQuery = `query VerifyAuthMutations {
    __schema {
      mutationType {
        fields { name }
      }
    }
  }`;

  const apiData = await graphql(apiEndpoint, schemaQuery);
  if (apiData?.__schema?.queryType?.name !== 'Query') {
    fail(`Platform API query root was '${apiData?.__schema?.queryType?.name ?? 'missing'}', expected 'Query'`);
  }
  pass('Platform API exposes Query root');

  if (apiData?.__schema?.mutationType?.name !== 'Mutation') {
    fail(`Platform API mutation root was '${apiData?.__schema?.mutationType?.name ?? 'missing'}', expected 'Mutation'`);
  }
  pass('Platform API exposes Mutation root');

  const authData = await graphql(authEndpoint, authQuery);
  const authMutations = (authData?.__schema?.mutationType?.fields ?? []).map((field) => field?.name).filter(Boolean);
  requireFields(authMutations, ['signIn', 'signUp'], 'Platform auth mutations');
}

async function verifyDatabase(args) {
  const appAuthEndpoint = args['app-auth'];
  const appPublicEndpoint = args['app-public'];
  const requiredQueryFields = String(args['required-query-fields'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const requiredAuthMutations = String(args['required-auth-mutations'] ?? 'signIn')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!appAuthEndpoint || !appPublicEndpoint) {
    fail('database mode requires --app-auth and --app-public');
  }

  const authQuery = `query VerifyDatabaseAuthMutations {
    __schema {
      mutationType {
        fields { name }
      }
    }
  }`;

  const appQuery = `query VerifyDatabaseQueries {
    __schema {
      queryType {
        fields { name }
      }
    }
  }`;

  const authData = await graphql(appAuthEndpoint, authQuery);
  const authMutations = (authData?.__schema?.mutationType?.fields ?? []).map((field) => field?.name).filter(Boolean);
  requireFields(authMutations, requiredAuthMutations, 'Per-database auth mutations');

  const appData = await graphql(appPublicEndpoint, appQuery);
  const appQueries = (appData?.__schema?.queryType?.fields ?? []).map((field) => field?.name).filter(Boolean);
  // Inflection-tolerant: a snake_case/multi-word table (audit_log) surfaces on the query root as
  // its PostGraphile-inflected field (auditLogs), never the raw name — assert against the LIVE
  // schema's real field names rather than the raw table strings (would false-FAIL underscored tables).
  requireInflectedFields(appQueries, requiredQueryFields, 'Per-database query root');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.mode) {
    case 'platform':
      await verifyPlatform(args);
      break;
    case 'database':
      await verifyDatabase(args);
      break;
    default:
      fail('Usage: node scripts/verify-graphql-contract.mjs <platform|database> [options]');
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
