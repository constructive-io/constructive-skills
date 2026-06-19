/**
 * scripts/lib/inflect.mjs — the ONE home for the identifier inflection the harness shares.
 *
 * Singular `entity` (kebab/snake/lower) → the identifiers the SDK + _meta + testids use.
 * Deliberately a small, legible English pluralizer scoped to the common table-name shapes
 * (no irregular-noun table) — matches how the platform's GraphQL inflection names list hooks
 * (`company` → `companies`).
 *
 * These helpers were copy-pasted across scaffold-frontend.mjs + live-qa.mjs (byte-for-byte —
 * live-qa called them "byte-for-byte copies of that scaffolder's inflection"); this module
 * is that single source so all importers derive identifiers IDENTICALLY. The rot-canaries
 * (check-frontend-scaffold.mjs / check-flow-surfaces.mjs) keep their OWN private copies on
 * purpose — they are the independent oracle that proves the scaffolder's emitted output, and
 * must not import the code under test.
 *
 * GENERIC BY CONSTRUCTION — nothing here hard-codes any entity/table/flow name; every result
 * derives purely from the identifier passed in.
 */

/** Split an identifier on -, _, space, or camelCase boundaries → lowercase words. */
export function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** kebab/snake/camel → PascalCase (e.g. blog-post → BlogPost). */
export function pascal(name) {
  return words(name).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** kebab/snake/camel → camelCase (e.g. blog-post → blogPost). */
export function camel(name) {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** kebab/lower form for the data-testid prefix (e.g. BlogPost → blog-post). */
export function kebab(name) {
  return words(name).join('-');
}

/** Human heading from the route label, falling back to a Title-Cased entity. */
export function titleCase(name) {
  return words(name).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * English pluralize the LAST word of an identifier, preserving the rest.
 *   y→ies (consonant+y), (s|x|z|ch|sh)→es, default +s.
 * Operates on the word list so `blog-post` → `blog-posts` (only the tail inflects).
 */
export function pluralizeWords(name) {
  const ws = words(name);
  if (ws.length === 0) return [];
  const last = ws[ws.length - 1];
  let plural;
  if (/[^aeiou]y$/.test(last)) plural = last.slice(0, -1) + 'ies';
  else if (/(s|x|z|ch|sh)$/.test(last)) plural = last + 'es';
  else plural = last + 's';
  return [...ws.slice(0, -1), plural];
}

export function wordsToPascal(ws) {
  return ws.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
export function wordsToCamel(ws) {
  const p = wordsToPascal(ws);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** All the per-entity identifiers, derived from the singular `entity` token. */
export function entityIdentifiers(entity) {
  const pluralWords = pluralizeWords(entity);
  return {
    EntitiesPascal: wordsToPascal(pluralWords), // list hook: use<Entities>Query  (Todos / Contacts)
    entitiesCamel: wordsToCamel(pluralWords), // data accessor: data.<entities>   (todos / contacts)
    // create hook: use__Create_Entity__Mutation expands to useCreate<Entity>Mutation —
    // the `Create` is part of the value (the template literal is `use__Create_Entity__Mutation`).
    CreateEntityPascal: 'Create' + pascal(entity),
    EntityPascal: pascal(entity), // DynamicFormCard tableName (the _meta type)  (Todo / Contact)
    entityKebab: kebab(entity), // data-testid prefix  (todo / contact / blog-post)
  };
}

/** Singular entity guess from a table name (drop a trailing plural -s/-ies/-es). */
export function singularFromTable(tableName) {
  if (!tableName) return null;
  const ws = words(tableName);
  if (ws.length === 0) return null;
  let last = ws[ws.length - 1];
  if (/ies$/.test(last)) last = last.slice(0, -3) + 'y';
  else if (/(s|x|z|ch|sh)es$/.test(last)) last = last.slice(0, -2);
  else if (/s$/.test(last)) last = last.slice(0, -1);
  return [...ws.slice(0, -1), last].join('-');
}
