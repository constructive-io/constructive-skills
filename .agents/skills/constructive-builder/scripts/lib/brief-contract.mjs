import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BRIEF_SCHEMA_VERSION = 2;
export const BRIEF_KIND = 'constructive.tenant-frontend-brief';
export const VALIDATION_SCHEMA_VERSION = 2;
export const VALIDATION_KIND = 'constructive.builder-validation';
export const CANONICAL_BLOCKS_CATALOG_PATH = fileURLToPath(
  new URL('../../../constructive-blocks/references/install-roots.v1.json', import.meta.url)
);

const CAPABILITY_STATES = new Set(['ready', 'partial', 'unavailable']);
const DOMAIN_MODES = new Set(['crud']);
const VIEWPORTS = new Set(['desktop', 'tablet', 'mobile']);
const COLOR_SCHEMES = new Set(['light', 'dark']);
const VISUAL_STATES = new Set([
  'loading',
  'ready',
  'empty',
  'populated',
  'partial',
  'unavailable',
  'unauthorized',
  'error',
  'validation-error'
]);
const CRUD_OPERATIONS = ['create', 'read', 'update', 'delete'];
const AUTH_CHECKS = [
  'sign-up',
  'sign-in',
  'session-restore',
  'sign-out',
  'forgot-password',
  'reset-password',
  'revoked-session-denied'
];
const AUTH_CHECK_CAPABILITY = new Map([
  ['sign-up', 'auth.credentials'],
  ['sign-in', 'auth.credentials'],
  ['session-restore', 'auth.sessions'],
  ['sign-out', 'auth.sessions'],
  ['revoked-session-denied', 'auth.sessions'],
  ['forgot-password', 'auth.password'],
  ['reset-password', 'auth.password']
]);
const RLS_SEMANTICS = [
  'same-tenant-owner',
  'same-tenant-peer',
  'anonymous',
  'revoked-session',
  'cross-tenant'
];
const REMOVED_KEYS = new Set([
  'flow',
  'flows',
  'required_flows',
  'requiredFlows',
  'registryRoot',
  'registryRoots',
  'modules'
]);
const REFERENCE_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]*$/;
const META_FRONTEND_GUIDANCE = fileURLToPath(
  new URL('../../../constructive-frontend/references/meta-forms.md', import.meta.url)
);
const META_ORM_GUIDANCE = fileURLToPath(
  new URL('../../../constructive-orm/references/query-meta-introspection.md', import.meta.url)
);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function addError(errors, message) {
  errors.push(message);
}

function requireRecord(value, pointer, errors) {
  if (!isRecord(value)) {
    addError(errors, pointer + ' must be an object.');
    return false;
  }
  return true;
}

function requireString(value, pointer, errors) {
  if (!isNonEmptyString(value)) {
    addError(errors, pointer + ' must be a non-empty string.');
    return false;
  }
  return true;
}

function requireBoolean(value, pointer, errors) {
  if (typeof value !== 'boolean') {
    addError(errors, pointer + ' must be a boolean.');
    return false;
  }
  return true;
}

function validateKeys(value, allowed, required, pointer, errors) {
  if (!isRecord(value)) {
    return;
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      addError(errors, pointer + '.' + key + ' is not part of this contract.');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      addError(errors, pointer + '.' + key + ' is required.');
    }
  }
}

function findRemovedKeys(value, pointer, errors) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      findRemovedKeys(value[index], pointer + '[' + index + ']', errors);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    if (REMOVED_KEYS.has(key)) {
      addError(errors, pointer + '.' + key + ' is a removed flow/root-array field; use the strict feature-pack composition contract.');
    }
    findRemovedKeys(value[key], pointer + '.' + key, errors);
  }
}

function validateReference(value, pointer, errors) {
  if (!requireString(value, pointer, errors)) {
    return false;
  }
  if (!REFERENCE_PATTERN.test(value) || value.includes('..') || value.includes('://')) {
    addError(errors, pointer + ' must be an opaque, non-secret handoff reference.');
    return false;
  }
  return true;
}

function validateIdentifier(value, pointer, errors) {
  if (!requireString(value, pointer, errors)) {
    return false;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    addError(errors, pointer + ' must use lowercase kebab-case.');
    return false;
  }
  return true;
}

function validateAbsoluteRoute(value, pointer, errors) {
  if (!requireString(value, pointer, errors)) {
    return false;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('?') || value.includes('#') || value.includes('\\')) {
    addError(errors, pointer + ' must be a clean absolute application route.');
    return false;
  }
  return true;
}

export function isSafeRelativePath(value) {
  if (!isNonEmptyString(value) || value.includes('\0') || value.includes('\\')) {
    return false;
  }
  if (path.posix.isAbsolute(value) || value.startsWith('~')) {
    return false;
  }
  const segments = value.split('/');
  return !segments.includes('..');
}

export function ensureSafeWorkspaceDirectory(workspaceInput, directoryInput, requiredRelativeRoot) {
  const workspacePath = path.resolve(workspaceInput);
  const directoryPath = path.resolve(directoryInput);
  const requiredRoot = path.resolve(workspacePath, requiredRelativeRoot);
  const relativeToRequired = path.relative(requiredRoot, directoryPath);
  if (relativeToRequired.startsWith('..' + path.sep) || relativeToRequired === '..' || path.isAbsolute(relativeToRequired)) {
    throw new Error('Path must stay under ' + requiredRoot + '.');
  }
  const realWorkspace = fs.realpathSync(workspacePath);
  const relativeDirectory = path.relative(workspacePath, directoryPath);
  if (relativeDirectory.startsWith('..' + path.sep) || relativeDirectory === '..' || path.isAbsolute(relativeDirectory)) {
    throw new Error('Path must stay inside the validated workspace.');
  }
  let current = workspacePath;
  const components = relativeDirectory === '' ? [] : relativeDirectory.split(path.sep);
  for (const component of components) {
    current = path.join(current, component);
    if (fs.existsSync(current)) {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error('Workspace output parent must be a real directory, not a symlink: ' + current);
      }
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const realCurrent = fs.realpathSync(current);
    const relativeReal = path.relative(realWorkspace, realCurrent);
    if (relativeReal.startsWith('..' + path.sep) || relativeReal === '..' || path.isAbsolute(relativeReal)) {
      throw new Error('Workspace output parent escapes through a symlink: ' + current);
    }
  }
  return directoryPath;
}

export function resolveBriefOwnedFile(briefDirectoryInput, relativePath, label, errors) {
  const briefDirectory = path.resolve(briefDirectoryInput);
  if (!isSafeRelativePath(relativePath) || relativePath === '.') {
    addError(errors, label + ' must be a safe relative file path.');
    return null;
  }
  const filePath = path.resolve(briefDirectory, relativePath);
  const lexicalRelative = path.relative(briefDirectory, filePath);
  if (lexicalRelative.startsWith('..' + path.sep) || lexicalRelative === '..' || path.isAbsolute(lexicalRelative)) {
    addError(errors, label + ' escapes the brief directory.');
    return null;
  }
  if (!fs.existsSync(filePath)) {
    return filePath;
  }
  const realBriefDirectory = fs.realpathSync(briefDirectory);
  const realFile = fs.realpathSync(filePath);
  const realRelative = path.relative(realBriefDirectory, realFile);
  if (realRelative.startsWith('..' + path.sep) || realRelative === '..' || path.isAbsolute(realRelative)) {
    addError(errors, label + ' escapes the brief directory through a symlinked parent.');
    return null;
  }
  return filePath;
}

function validateRelativePath(value, pointer, errors, allowDot) {
  if (!requireString(value, pointer, errors)) {
    return false;
  }
  if (!isSafeRelativePath(value) || (!allowDot && value === '.')) {
    addError(errors, pointer + ' must be a safe relative path without ~, .., backslashes, or an absolute prefix.');
    return false;
  }
  return true;
}

export function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function readJsonFile(filePath, label, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    addError(errors, label + ' could not be read as JSON at ' + filePath + ': ' + error.message);
    return null;
  }
}

function validateSafeUrl(value, pointer, errors) {
  if (!requireString(value, pointer, errors)) {
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    addError(errors, pointer + ' must be a valid absolute URL.');
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    addError(errors, pointer + ' must use http or https.');
  }
  if (parsed.username || parsed.password) {
    addError(errors, pointer + ' must not contain URL user information.');
  }
  if (parsed.hash) {
    addError(errors, pointer + ' must not contain a fragment.');
  }
  if (parsed.search) {
    addError(errors, pointer + ' must not contain a query string; endpoint descriptors carry routing only.');
  }
}

function validateEndpoint(value, pointer, errors) {
  if (typeof value === 'string') {
    validateSafeUrl(value, pointer, errors);
    return;
  }
  if (!requireRecord(value, pointer, errors)) {
    return;
  }
  validateKeys(value, ['id', 'url'], ['url'], pointer, errors);
  if (Object.hasOwn(value, 'id')) {
    requireString(value.id, pointer + '.id', errors);
  }
  validateSafeUrl(value.url, pointer + '.url', errors);
}

function validateTenant(tenant, catalog, errors, pointer = 'tenant') {
  const result = {
    id: null,
    endpointKinds: [],
    requireCsrfForAuth: null
  };
  if (!requireRecord(tenant, pointer, errors)) {
    return result;
  }
  validateKeys(tenant, ['id', 'name', 'endpoints', 'authPolicy'], ['id', 'endpoints'], pointer, errors);
  if (requireString(tenant.id, pointer + '.id', errors)) {
    result.id = tenant.id;
  }
  if (Object.hasOwn(tenant, 'name')) {
    requireString(tenant.name, pointer + '.name', errors);
  }
  if (!requireRecord(tenant.endpoints, pointer + '.endpoints', errors)) {
    return result;
  }
  const endpointKinds = Object.keys(tenant.endpoints);
  const allowedKinds = new Set(Array.isArray(catalog.endpointKinds) ? catalog.endpointKinds : []);
  if (endpointKinds.length === 0) {
    addError(errors, pointer + '.endpoints must contain at least one explicit semantic endpoint.');
  }
  for (const endpointKind of endpointKinds) {
    if (!allowedKinds.has(endpointKind)) {
      addError(errors, pointer + '.endpoints.' + endpointKind + ' is not an endpoint kind in the pinned Blocks contract.');
    }
    validateEndpoint(tenant.endpoints[endpointKind], pointer + '.endpoints.' + endpointKind, errors);
  }
  if (endpointKinds.includes('auth')) {
    if (!requireRecord(tenant.authPolicy, pointer + '.authPolicy', errors)) {
      addError(errors, pointer + '.authPolicy is required when endpoints.auth is present.');
    } else {
      validateKeys(
        tenant.authPolicy,
        ['requireCsrfForAuth'],
        ['requireCsrfForAuth'],
        pointer + '.authPolicy',
        errors
      );
      if (requireBoolean(
        tenant.authPolicy.requireCsrfForAuth,
        pointer + '.authPolicy.requireCsrfForAuth',
        errors
      )) {
        result.requireCsrfForAuth = tenant.authPolicy.requireCsrfForAuth;
      }
    }
  } else if (Object.hasOwn(tenant, 'authPolicy')) {
    addError(errors, pointer + '.authPolicy is valid only when endpoints.auth is present.');
  }
  result.endpointKinds = endpointKinds;
  return result;
}

function validateProvenance(provenance, catalog, errors) {
  const result = {
    kind: null,
    preset: null,
    frontendPresetRoot: null,
    featurePacks: null
  };
  if (!requireRecord(provenance, 'brief.tenant.provenance', errors)) {
    return result;
  }
  if (provenance.kind === 'preset') {
    validateKeys(provenance, ['kind', 'preset'], ['kind', 'preset'], 'brief.tenant.provenance', errors);
    const routes = Array.isArray(catalog?.backendPresetRouting)
      ? catalog.backendPresetRouting
      : [];
    const route = routes.find((candidate) => candidate?.presetSlug === provenance.preset);
    if (!route) {
      const allowed = routes.map((candidate) => candidate.presetSlug).join(', ');
      addError(errors, 'brief.tenant.provenance.preset must name a backend preset from the pinned Blocks routing contract: ' + allowed + '.');
    } else {
      result.kind = 'preset';
      result.preset = provenance.preset;
      result.frontendPresetRoot = route.frontendPresetRoot;
      result.featurePacks = Array.isArray(route.featurePacks) ? route.featurePacks.slice() : [];
    }
    return result;
  }
  if (provenance.kind === 'custom') {
    validateKeys(
      provenance,
      ['kind', 'compositionReceiptRef', 'capabilityHandoffRef', 'justification'],
      ['kind', 'compositionReceiptRef', 'capabilityHandoffRef', 'justification'],
      'brief.tenant.provenance',
      errors
    );
    validateReference(provenance.compositionReceiptRef, 'brief.tenant.provenance.compositionReceiptRef', errors);
    validateReference(provenance.capabilityHandoffRef, 'brief.tenant.provenance.capabilityHandoffRef', errors);
    requireString(provenance.justification, 'brief.tenant.provenance.justification', errors);
    result.kind = 'custom';
    return result;
  }
  addError(errors, 'brief.tenant.provenance.kind must be preset or custom.');
  return result;
}

function validateOwnership(value, pointer, referenceKey, errors, consoleAllowed) {
  if (!requireRecord(value, pointer, errors)) {
    return null;
  }
  if (value.owner === 'console' && consoleAllowed) {
    validateKeys(value, ['owner'], ['owner'], pointer, errors);
    return 'console';
  }
  if (value.owner === 'host') {
    validateKeys(value, ['owner', referenceKey], ['owner', referenceKey], pointer, errors);
    validateReference(value[referenceKey], pointer + '.' + referenceKey, errors);
    return 'host';
  }
  addError(errors, pointer + '.owner must be ' + (consoleAllowed ? 'console or host.' : 'host.'));
  return null;
}

function validateConsoleSession(session, tenantResult, installedPacks, errors) {
  if (!requireRecord(session, 'brief.frontend.composition.session', errors)) {
    return;
  }
  if (session.kind === 'internal-auth-endpoint') {
    validateKeys(
      session,
      ['kind', 'authEndpointKind', 'csrf', 'callback'],
      ['kind', 'authEndpointKind', 'csrf', 'callback'],
      'brief.frontend.composition.session',
      errors
    );
    if (session.authEndpointKind !== 'auth') {
      addError(errors, 'brief.frontend.composition.session.authEndpointKind must equal auth.');
    }
    if (!tenantResult.endpointKinds.includes('auth')) {
      addError(errors, 'An internal-auth-endpoint Console session requires tenant.endpoints.auth.');
    }
    if (!installedPacks.includes('auth')) {
      addError(errors, 'An internal-auth-endpoint Console session requires the auth feature pack on that Console surface.');
    }
    validateOwnership(session.csrf, 'brief.frontend.composition.session.csrf', 'providerRef', errors, true);
    validateOwnership(session.callback, 'brief.frontend.composition.session.callback', 'handlerRef', errors, true);
    return;
  }
  if (session.kind === 'host-session') {
    validateKeys(
      session,
      ['kind', 'databaseId', 'sessionRef', 'csrf', 'callback'],
      ['kind', 'databaseId', 'sessionRef', 'csrf', 'callback'],
      'brief.frontend.composition.session',
      errors
    );
    requireString(session.databaseId, 'brief.frontend.composition.session.databaseId', errors);
    if (tenantResult.id && session.databaseId !== tenantResult.id) {
      addError(errors, 'A host-session databaseId must exactly match tenant.id.');
    }
    validateReference(session.sessionRef, 'brief.frontend.composition.session.sessionRef', errors);
    validateOwnership(session.csrf, 'brief.frontend.composition.session.csrf', 'providerRef', errors, false);
    validateOwnership(session.callback, 'brief.frontend.composition.session.callback', 'handlerRef', errors, false);
    return;
  }
  addError(errors, 'brief.frontend.composition.session.kind must be internal-auth-endpoint or host-session.');
}

function validateSheetsSession(session, pointer, tenantResult, errors) {
  if (!requireRecord(session, pointer, errors)) {
    return;
  }
  if (session.kind === 'embedded') {
    validateKeys(session, ['kind', 'databaseId', 'sessionRef'], ['kind', 'databaseId', 'sessionRef'], pointer, errors);
    requireString(session.databaseId, pointer + '.databaseId', errors);
    if (tenantResult.id && session.databaseId !== tenantResult.id) {
      addError(errors, pointer + '.databaseId must exactly match tenant.id.');
    }
    validateReference(session.sessionRef, pointer + '.sessionRef', errors);
    return;
  }
  if (session.kind === 'standalone-auth') {
    validateKeys(
      session,
      ['kind', 'authEndpointKind', 'databaseId'],
      ['kind', 'authEndpointKind', 'databaseId'],
      pointer,
      errors
    );
    if (session.authEndpointKind !== 'auth') {
      addError(errors, pointer + '.authEndpointKind must equal auth.');
    }
    if (!tenantResult.endpointKinds.includes('auth')) {
      addError(errors, pointer + ' requires tenant.endpoints.auth.');
    }
    requireString(session.databaseId, pointer + '.databaseId', errors);
    if (tenantResult.id && session.databaseId !== tenantResult.id) {
      addError(errors, pointer + '.databaseId must exactly match tenant.id.');
    }
    if (tenantResult.requireCsrfForAuth !== false) {
      addError(errors, pointer + ' standalone-auth is forbidden unless tenant.authPolicy.requireCsrfForAuth is explicitly false; use embedded host auth when CSRF is required or unknown.');
    }
    return;
  }
  addError(errors, pointer + '.kind must be embedded or standalone-auth.');
}

function validateSheetsTransport(transport, pointer, errors) {
  if (!requireRecord(transport, pointer, errors)) {
    return;
  }
  if (transport.kind === 'default') {
    validateKeys(transport, ['kind'], ['kind'], pointer, errors);
    return;
  }
  if (transport.kind === 'custom-execute') {
    validateKeys(transport, ['kind', 'executeRef', 'justification'], ['kind', 'executeRef', 'justification'], pointer, errors);
    validateReference(transport.executeRef, pointer + '.executeRef', errors);
    requireString(transport.justification, pointer + '.justification', errors);
    return;
  }
  if (transport.kind === 'custom-adapter') {
    validateKeys(
      transport,
      ['kind', 'adapterRef', 'executeRef', 'justification'],
      ['kind', 'adapterRef', 'executeRef', 'justification'],
      pointer,
      errors
    );
    validateReference(transport.adapterRef, pointer + '.adapterRef', errors);
    validateReference(transport.executeRef, pointer + '.executeRef', errors);
    requireString(transport.justification, pointer + '.justification', errors);
    return;
  }
  addError(errors, pointer + '.kind must be default, custom-execute, or custom-adapter.');
}

function validateStandaloneBinding(binding, pointer, packId, tenantResult, catalog, errors) {
  if (!requireRecord(binding, pointer, errors)) {
    return null;
  }
  if (packId === 'data') {
    validateKeys(
      binding,
      ['kind', 'configRef', 'endpointKind', 'session', 'transport'],
      ['kind', 'configRef', 'endpointKind', 'session', 'transport'],
      pointer,
      errors
    );
    if (binding.kind !== 'sheets') {
      addError(errors, pointer + '.kind must equal sheets for feature-pack-data.');
    }
    validateReference(binding.configRef, pointer + '.configRef', errors);
    if (binding.endpointKind !== 'data') {
      addError(errors, pointer + '.endpointKind must equal data.');
    }
    if (!tenantResult.endpointKinds.includes('data')) {
      addError(errors, pointer + ' requires tenant.endpoints.data.');
    }
    validateSheetsSession(binding.session, pointer + '.session', tenantResult, errors);
    validateSheetsTransport(binding.transport, pointer + '.transport', errors);
    const standalone = catalog.standaloneContracts?.data;
    if (standalone?.configType !== 'SheetsConfig' || standalone?.executeType !== 'SheetsExecuteFn') {
      addError(errors, 'The pinned Blocks snapshot does not attest the standalone Data SheetsConfig/SheetsExecuteFn contract.');
    }
    return binding;
  }
  validateKeys(
    binding,
    ['kind', 'resourcesRef', 'policyRef', 'actionsRef', 'sessionRef'],
    ['kind', 'resourcesRef', 'policyRef', 'actionsRef', 'sessionRef'],
    pointer,
    errors
  );
  if (binding.kind !== 'host-resources') {
    addError(errors, pointer + '.kind must equal host-resources for a non-Data standalone pack.');
  }
  validateReference(binding.resourcesRef, pointer + '.resourcesRef', errors);
  validateReference(binding.policyRef, pointer + '.policyRef', errors);
  validateReference(binding.actionsRef, pointer + '.actionsRef', errors);
  validateReference(binding.sessionRef, pointer + '.sessionRef', errors);
  const standalone = catalog.standaloneContracts?.nonData;
  if (standalone?.endpointResolution !== 'none' || standalone?.sessionOwnership !== 'host') {
    addError(errors, 'The pinned Blocks snapshot does not attest the non-Data host-resources contract.');
  }
  return binding;
}

function itemMapFromCatalog(catalog, errors) {
  if (catalog?.schemaVersion !== 1 || catalog?.kind !== 'constructive.blocks-install-roots') {
    addError(errors, 'The Blocks catalog must be schemaVersion 1 with kind constructive.blocks-install-roots.');
  }
  if (!Array.isArray(catalog?.items) || catalog.items.length === 0) {
    addError(errors, 'The Blocks catalog must contain install-root items.');
    return new Map();
  }
  const items = new Map();
  for (const item of catalog.items) {
    if (isRecord(item) && isNonEmptyString(item.name)) {
      items.set(item.name, item);
    }
  }
  return items;
}

function addSurface(result, id, mountPath, roots, items, errors) {
  const packs = [];
  const seenPacks = new Set();
  const surfaceTypes = [];
  const seenSurfaceTypes = new Set();
  for (const root of roots) {
    const item = items.get(root);
    if (!item) {
      addError(errors, 'The selected Blocks root ' + root + ' is absent from the pinned catalog.');
      continue;
    }
    if (!Array.isArray(item.featurePacks)) {
      addError(errors, 'The selected Blocks root ' + root + ' has no featurePacks contract.');
      continue;
    }
    if (isNonEmptyString(item.surface) && !seenSurfaceTypes.has(item.surface)) {
      seenSurfaceTypes.add(item.surface);
      surfaceTypes.push(item.surface);
    }
    for (const packId of item.featurePacks) {
      if (!seenPacks.has(packId)) {
        seenPacks.add(packId);
        packs.push(packId);
      }
    }
  }
  const surface = {
    id,
    mountPath,
    roots: roots.slice(),
    featurePacks: packs,
    surfaceTypes,
    isConsole: surfaceTypes.some((surfaceType) => surfaceType !== 'standalone-feature-pack'),
    bindings: new Map()
  };
  result.surfaces.push(surface);
  for (const root of roots) {
    result.installRoots.push(root);
  }
  return surface;
}

function validateComposition(composition, provenance, tenantResult, catalog, errors) {
  const result = {
    kind: null,
    installRoots: [],
    surfaces: []
  };
  if (!requireRecord(composition, 'brief.frontend.composition', errors)) {
    return result;
  }
  const items = itemMapFromCatalog(catalog, errors);
  if (composition.kind === 'console-preset') {
    validateKeys(
      composition,
      ['kind', 'surfaceId', 'root', 'mountPath', 'session'],
      ['kind', 'surfaceId', 'root', 'mountPath', 'session'],
      'brief.frontend.composition',
      errors
    );
    validateIdentifier(composition.surfaceId, 'brief.frontend.composition.surfaceId', errors);
    validateAbsoluteRoute(composition.mountPath, 'brief.frontend.composition.mountPath', errors);
    const item = items.get(composition.root);
    if (!item || item.surface !== 'preset') {
      addError(errors, 'A console-preset composition root must resolve to a Blocks preset surface.');
    }
    if (provenance.kind !== 'preset') {
      addError(errors, 'A custom tenant backend cannot use a preset frontend root; select console-full, console-modules, or standalone.');
    } else {
      const expectedRoot = provenance.frontendPresetRoot;
      if (!expectedRoot) {
        addError(errors, 'Backend preset ' + provenance.preset + ' has no matching frontend preset root; select console-full, console-core, console-modules, or standalone.');
      } else if (composition.root !== expectedRoot) {
        addError(errors, 'Backend preset ' + provenance.preset + ' requires frontend root ' + expectedRoot + ', not ' + String(composition.root) + '.');
      }
    }
    const surface = addSurface(result, composition.surfaceId, composition.mountPath, [composition.root], items, errors);
    validateConsoleSession(composition.session, tenantResult, surface.featurePacks, errors);
    result.kind = composition.kind;
    return result;
  }
  if (composition.kind === 'console-full') {
    validateKeys(
      composition,
      ['kind', 'surfaceId', 'root', 'mountPath', 'session'],
      ['kind', 'surfaceId', 'root', 'mountPath', 'session'],
      'brief.frontend.composition',
      errors
    );
    validateIdentifier(composition.surfaceId, 'brief.frontend.composition.surfaceId', errors);
    validateAbsoluteRoute(composition.mountPath, 'brief.frontend.composition.mountPath', errors);
    const item = items.get(composition.root);
    if (!item || item.surface !== 'full-console' || composition.root !== 'console-kit-nextjs') {
      addError(errors, 'A console-full composition root must equal console-kit-nextjs.');
    }
    const surface = addSurface(result, composition.surfaceId, composition.mountPath, [composition.root], items, errors);
    validateConsoleSession(composition.session, tenantResult, surface.featurePacks, errors);
    result.kind = composition.kind;
    return result;
  }
  if (composition.kind === 'console-core') {
    validateKeys(
      composition,
      ['kind', 'surfaceId', 'root', 'mountPath', 'session'],
      ['kind', 'surfaceId', 'root', 'mountPath', 'session'],
      'brief.frontend.composition',
      errors
    );
    validateIdentifier(composition.surfaceId, 'brief.frontend.composition.surfaceId', errors);
    validateAbsoluteRoute(composition.mountPath, 'brief.frontend.composition.mountPath', errors);
    const item = items.get(composition.root);
    if (!item || item.surface !== 'core' || composition.root !== 'console-kit-core') {
      addError(errors, 'A console-core composition root must equal console-kit-core.');
    }
    addSurface(result, composition.surfaceId, composition.mountPath, [composition.root], items, errors);
    if (composition.session?.kind !== 'host-session') {
      addError(errors, 'A zero-pack console-core composition requires a host-session boundary.');
    }
    validateConsoleSession(composition.session, tenantResult, [], errors);
    result.kind = composition.kind;
    return result;
  }
  if (composition.kind === 'console-modules') {
    validateKeys(
      composition,
      ['kind', 'surfaceId', 'roots', 'mountPath', 'session'],
      ['kind', 'surfaceId', 'roots', 'mountPath', 'session'],
      'brief.frontend.composition',
      errors
    );
    validateIdentifier(composition.surfaceId, 'brief.frontend.composition.surfaceId', errors);
    validateAbsoluteRoute(composition.mountPath, 'brief.frontend.composition.mountPath', errors);
    const roots = [];
    const seen = new Set();
    if (!Array.isArray(composition.roots) || composition.roots.length === 0) {
      addError(errors, 'brief.frontend.composition.roots must contain at least one Console module root.');
    } else {
      for (let index = 0; index < composition.roots.length; index += 1) {
        const root = composition.roots[index];
        const pointer = 'brief.frontend.composition.roots[' + index + ']';
        if (!requireString(root, pointer, errors)) {
          continue;
        }
        if (seen.has(root)) {
          addError(errors, pointer + ' duplicates ' + root + '.');
          continue;
        }
        seen.add(root);
        roots.push(root);
        const item = items.get(root);
        if (!item || item.surface !== 'console-module') {
          addError(errors, pointer + ' must resolve to a console-module surface; presets, full kits, core, and standalone roots cannot be mixed here.');
        }
      }
    }
    const surface = addSurface(result, composition.surfaceId, composition.mountPath, roots, items, errors);
    validateConsoleSession(composition.session, tenantResult, surface.featurePacks, errors);
    result.kind = composition.kind;
    return result;
  }
  if (composition.kind === 'standalone') {
    validateKeys(composition, ['kind', 'mounts'], ['kind', 'mounts'], 'brief.frontend.composition', errors);
    if (!Array.isArray(composition.mounts) || composition.mounts.length === 0) {
      addError(errors, 'brief.frontend.composition.mounts must contain at least one standalone mount.');
      return result;
    }
    const ids = new Set();
    const roots = new Set();
    const mountPaths = new Set();
    for (let index = 0; index < composition.mounts.length; index += 1) {
      const mount = composition.mounts[index];
      const pointer = 'brief.frontend.composition.mounts[' + index + ']';
      if (!requireRecord(mount, pointer, errors)) {
        continue;
      }
      validateKeys(mount, ['id', 'root', 'mountPath', 'binding'], ['id', 'root', 'mountPath', 'binding'], pointer, errors);
      validateIdentifier(mount.id, pointer + '.id', errors);
      requireString(mount.root, pointer + '.root', errors);
      validateAbsoluteRoute(mount.mountPath, pointer + '.mountPath', errors);
      if (ids.has(mount.id)) {
        addError(errors, pointer + '.id duplicates ' + mount.id + '.');
      }
      if (roots.has(mount.root)) {
        addError(errors, pointer + '.root duplicates ' + mount.root + '; mount each standalone pack once.');
      }
      if (mountPaths.has(mount.mountPath)) {
        addError(errors, pointer + '.mountPath duplicates ' + mount.mountPath + '.');
      }
      ids.add(mount.id);
      roots.add(mount.root);
      mountPaths.add(mount.mountPath);
      const item = items.get(mount.root);
      if (!item || item.surface !== 'standalone-feature-pack') {
        addError(errors, pointer + '.root must resolve to a standalone-feature-pack surface.');
      }
      const surface = addSurface(result, mount.id, mount.mountPath, [mount.root], items, errors);
      const packId = surface.featurePacks.length === 1 ? surface.featurePacks[0] : null;
      if (!packId) {
        addError(errors, pointer + '.root must install exactly one feature pack.');
      } else {
        const binding = validateStandaloneBinding(mount.binding, pointer + '.binding', packId, tenantResult, catalog, errors);
        surface.bindings.set(packId, binding);
      }
    }
    result.kind = composition.kind;
    return result;
  }
  addError(errors, 'brief.frontend.composition.kind must be console-preset, console-full, console-core, console-modules, or standalone.');
  return result;
}

function validateDomain(domain, errors) {
  const routes = [];
  if (!requireRecord(domain, 'brief.domain', errors)) {
    return routes;
  }
  validateKeys(domain, ['routes'], ['routes'], 'brief.domain', errors);
  if (!Array.isArray(domain.routes)) {
    addError(errors, 'brief.domain.routes must be an array.');
    return routes;
  }
  const ids = new Set();
  const paths = new Set();
  for (let index = 0; index < domain.routes.length; index += 1) {
    const route = domain.routes[index];
    const pointer = 'brief.domain.routes[' + index + ']';
    if (!requireRecord(route, pointer, errors)) {
      continue;
    }
    validateKeys(route, ['id', 'path', 'label', 'resource', 'mode'], ['id', 'path', 'label', 'resource', 'mode'], pointer, errors);
    validateIdentifier(route.id, pointer + '.id', errors);
    validateAbsoluteRoute(route.path, pointer + '.path', errors);
    requireString(route.label, pointer + '.label', errors);
    requireString(route.resource, pointer + '.resource', errors);
    if (!DOMAIN_MODES.has(route.mode)) {
      addError(errors, pointer + '.mode must equal crud.');
    }
    if (ids.has(route.id)) {
      addError(errors, pointer + '.id duplicates ' + route.id + '.');
    }
    if (paths.has(route.path)) {
      addError(errors, pointer + '.path duplicates ' + route.path + '.');
    }
    ids.add(route.id);
    paths.add(route.path);
    routes.push(route);
  }
  return routes;
}

function validateIsolationTenants(acceptance, isolationDocuments, tenantResult, catalog, errors) {
  const result = new Map();
  const databaseIds = new Set();
  if (!Array.isArray(acceptance.isolationTenants)) {
    addError(errors, 'brief.acceptance.isolationTenants must be an array.');
    return result;
  }
  for (let index = 0; index < acceptance.isolationTenants.length; index += 1) {
    const isolation = acceptance.isolationTenants[index];
    const pointer = 'brief.acceptance.isolationTenants[' + index + ']';
    if (!requireRecord(isolation, pointer, errors)) {
      continue;
    }
    validateKeys(
      isolation,
      ['id', 'descriptorPath', 'sessionRef'],
      ['id', 'descriptorPath', 'sessionRef'],
      pointer,
      errors
    );
    validateIdentifier(isolation.id, pointer + '.id', errors);
    validateRelativePath(isolation.descriptorPath, pointer + '.descriptorPath', errors, false);
    validateReference(isolation.sessionRef, pointer + '.sessionRef', errors);
    if (result.has(isolation.id)) {
      addError(errors, pointer + '.id duplicates ' + isolation.id + '.');
      continue;
    }
    const document = isolationDocuments.get(isolation.id);
    if (!document) {
      addError(errors, pointer + ' has no loaded secret-free isolation tenant descriptor.');
      continue;
    }
    const descriptor = validateTenant(document, catalog, errors, 'isolationTenant[' + isolation.id + ']');
    if (descriptor.id && descriptor.id === tenantResult.id) {
      addError(errors, pointer + ' must resolve to a database ID different from tenant.id.');
    }
    if (descriptor.id && databaseIds.has(descriptor.id)) {
      addError(errors, pointer + ' duplicates isolation tenant database ID ' + descriptor.id + '.');
    }
    if (descriptor.id) {
      databaseIds.add(descriptor.id);
    }
    result.set(isolation.id, {
      id: isolation.id,
      descriptorPath: isolation.descriptorPath,
      sessionRef: isolation.sessionRef,
      databaseId: descriptor.id,
      endpointKinds: descriptor.endpointKinds,
      requireCsrfForAuth: descriptor.requireCsrfForAuth
    });
  }
  return result;
}

function validateTenantScope(scope, pointer, tenantId, isolationTenants, errors) {
  if (!requireRecord(scope, pointer, errors)) {
    return null;
  }
  if (scope.kind === 'primary') {
    validateKeys(scope, ['kind', 'databaseId'], ['kind', 'databaseId'], pointer, errors);
    requireString(scope.databaseId, pointer + '.databaseId', errors);
    if (tenantId && scope.databaseId !== tenantId) {
      addError(errors, pointer + '.databaseId must exactly match tenant.id.');
    }
    return {
      kind: 'primary',
      databaseId: scope.databaseId,
      tenantRef: null
    };
  }
  if (scope.kind === 'isolation') {
    validateKeys(scope, ['kind', 'tenantRef', 'databaseId'], ['kind', 'tenantRef', 'databaseId'], pointer, errors);
    requireString(scope.tenantRef, pointer + '.tenantRef', errors);
    requireString(scope.databaseId, pointer + '.databaseId', errors);
    const isolation = isolationTenants.get(scope.tenantRef);
    if (!isolation) {
      addError(errors, pointer + '.tenantRef does not name a declared isolation tenant.');
    } else if (scope.databaseId !== isolation.databaseId) {
      addError(errors, pointer + '.databaseId must exactly match the referenced isolation tenant descriptor.');
    }
    return {
      kind: 'isolation',
      databaseId: scope.databaseId,
      tenantRef: scope.tenantRef
    };
  }
  addError(errors, pointer + '.kind must be primary or isolation.');
  return null;
}

function validateActor(actor, pointer, tenantId, isolationTenants, errors) {
  if (!requireRecord(actor, pointer, errors)) {
    return null;
  }
  if (actor.kind === 'anonymous') {
    validateKeys(actor, ['id', 'kind', 'tenantScope'], ['id', 'kind', 'tenantScope'], pointer, errors);
    validateIdentifier(actor.id, pointer + '.id', errors);
    const tenantScope = validateTenantScope(actor.tenantScope, pointer + '.tenantScope', tenantId, isolationTenants, errors);
    return {
      id: actor.id,
      kind: actor.kind,
      tenantScope
    };
  }
  if (actor.kind === 'account') {
    validateKeys(
      actor,
      ['id', 'kind', 'accountRef', 'tenantScope', 'sessionState'],
      ['id', 'kind', 'accountRef', 'tenantScope', 'sessionState'],
      pointer,
      errors
    );
    validateIdentifier(actor.id, pointer + '.id', errors);
    validateReference(actor.accountRef, pointer + '.accountRef', errors);
    const tenantScope = validateTenantScope(actor.tenantScope, pointer + '.tenantScope', tenantId, isolationTenants, errors);
    if (actor.sessionState !== 'active' && actor.sessionState !== 'revoked') {
      addError(errors, pointer + '.sessionState must be active or revoked.');
    }
    return {
      id: actor.id,
      kind: actor.kind,
      accountRef: actor.accountRef,
      tenantScope,
      sessionState: actor.sessionState
    };
  }
  addError(errors, pointer + '.kind must be anonymous or account.');
  return actor;
}

function validateActors(acceptance, tenantId, isolationTenants, allowEmpty, errors) {
  const actors = new Map();
  if (!Array.isArray(acceptance.actors)) {
    addError(errors, 'brief.acceptance.actors must be an array.');
    return actors;
  }
  if (acceptance.actors.length === 0) {
    if (allowEmpty) {
      return actors;
    }
    addError(errors, 'brief.acceptance.actors must contain explicit actors.');
    return actors;
  }
  for (let index = 0; index < acceptance.actors.length; index += 1) {
    const pointer = 'brief.acceptance.actors[' + index + ']';
    const actor = validateActor(acceptance.actors[index], pointer, tenantId, isolationTenants, errors);
    if (!actor || !isNonEmptyString(actor.id)) {
      continue;
    }
    if (actors.has(actor.id)) {
      addError(errors, pointer + '.id duplicates ' + actor.id + '.');
    }
    actors.set(actor.id, actor);
  }
  return actors;
}

function surfaceMap(composition) {
  const map = new Map();
  for (const surface of composition.surfaces) {
    map.set(surface.id, surface);
  }
  return map;
}

function routeMap(routes) {
  const map = new Map();
  for (const route of routes) {
    map.set(route.id, route);
  }
  return map;
}

function validateTarget(target, pointer, surfaces, routes, errors) {
  if (!requireRecord(target, pointer, errors)) {
    return null;
  }
  if (target.kind === 'surface') {
    validateKeys(target, ['kind', 'surfaceId', 'featurePack'], ['kind', 'surfaceId', 'featurePack'], pointer, errors);
    requireString(target.surfaceId, pointer + '.surfaceId', errors);
    requireString(target.featurePack, pointer + '.featurePack', errors);
    const surface = surfaces.get(target.surfaceId);
    if (!surface) {
      addError(errors, pointer + '.surfaceId does not name an installed frontend surface.');
    } else if (!surface.featurePacks.includes(target.featurePack)) {
      addError(errors, pointer + '.featurePack is not installed on surface ' + target.surfaceId + '.');
    }
    return target;
  }
  if (target.kind === 'domain-route') {
    validateKeys(target, ['kind', 'routeId', 'resource'], ['kind', 'routeId', 'resource'], pointer, errors);
    requireString(target.routeId, pointer + '.routeId', errors);
    requireString(target.resource, pointer + '.resource', errors);
    const route = routes.get(target.routeId);
    if (!route) {
      addError(errors, pointer + '.routeId does not name a declared domain route.');
    } else if (target.resource !== route.resource) {
      addError(errors, pointer + '.resource must match the declared route resource ' + route.resource + '.');
    }
    return target;
  }
  if (target.kind === 'shell') {
    validateKeys(target, ['kind', 'surfaceId'], ['kind', 'surfaceId'], pointer, errors);
    requireString(target.surfaceId, pointer + '.surfaceId', errors);
    const surface = surfaces.get(target.surfaceId);
    if (!surface) {
      addError(errors, pointer + '.surfaceId does not name an installed frontend surface.');
    } else if (surface.isConsole !== true) {
      addError(errors, pointer + '.surfaceId must name a Console surface for a shell target.');
    }
    return target;
  }
  addError(errors, pointer + '.kind must be surface, shell, or domain-route.');
  return target;
}

function requiredCapabilitiesForPack(catalog, packId) {
  if (!Array.isArray(catalog?.featurePackManifests)) {
    return [];
  }
  const manifest = catalog.featurePackManifests.find((candidate) => candidate?.id === packId);
  return Array.isArray(manifest?.capabilities?.required)
    ? manifest.capabilities.required.slice()
    : [];
}

function validatePartialCapabilityPartition(capability, pointer, requiredCapabilities, errors) {
  const partition = capability.requiredCapabilities;
  if (!requireRecord(partition, pointer + '.requiredCapabilities', errors)) {
    return {
      available: new Set(),
      unavailable: new Set()
    };
  }
  validateKeys(
    partition,
    ['available', 'unavailable'],
    ['available', 'unavailable'],
    pointer + '.requiredCapabilities',
    errors
  );
  const available = validateStringSet(
    partition.available,
    pointer + '.requiredCapabilities.available',
    requiredCapabilities,
    [],
    errors
  );
  const unavailable = validateStringSet(
    partition.unavailable,
    pointer + '.requiredCapabilities.unavailable',
    requiredCapabilities,
    [],
    errors
  );
  for (const capabilityId of available) {
    if (unavailable.has(capabilityId)) {
      addError(errors, pointer + '.requiredCapabilities repeats ' + capabilityId + ' as both available and unavailable.');
    }
  }
  for (const capabilityId of requiredCapabilities) {
    if (!available.has(capabilityId) && !unavailable.has(capabilityId)) {
      addError(errors, pointer + '.requiredCapabilities must classify ' + capabilityId + '.');
    }
  }
  if (available.size === 0 || unavailable.size === 0) {
    addError(errors, pointer + '.requiredCapabilities must classify at least one required capability as available and one as unavailable for partial.');
  }
  return {
    available,
    unavailable
  };
}

function cloneEvidenceContract(evidence) {
  return structuredClone(evidence);
}

function emptyCapabilityBindingResult() {
  return {
    proofs: [],
    verificationProfile: null,
    adapterVerification: null
  };
}

function validateConsoleCapabilityRoutes(
  binding,
  pointer,
  surface,
  tenantResult,
  bindingRecord,
  catalog,
  requiredCapabilityStates,
  errors
) {
  validateKeys(
    binding,
    ['kind', 'verificationProfileId', 'routes'],
    ['kind', 'verificationProfileId', 'routes'],
    pointer + '.binding',
    errors
  );
  if (binding.kind !== 'first-party') {
    addError(errors, pointer + '.binding.kind must equal first-party for a Console module.');
    return emptyCapabilityBindingResult();
  }
  requireString(binding.verificationProfileId, pointer + '.binding.verificationProfileId', errors);
  const verificationProfile = Array.isArray(catalog.verificationProfiles)
    ? catalog.verificationProfiles.find((profile) => profile?.id === binding.verificationProfileId)
    : null;
  if (!verificationProfile) {
    addError(errors, pointer + '.binding.verificationProfileId does not name a pinned Blocks verification profile.');
  } else {
    const profileRoots = verificationProfile.appliesTo?.installRoots;
    if (
      Array.isArray(profileRoots) &&
      surface.roots.some((root) => !profileRoots.includes(root))
    ) {
      addError(errors, pointer + '.binding.verificationProfileId does not cover every selected install root.');
    }
  }
  if (!Array.isArray(binding.routes) || binding.routes.length === 0) {
    addError(errors, pointer + '.binding.routes must select source-attested evidence for every available required capability and prerequisite.');
    return emptyCapabilityBindingResult();
  }
  const requirements = new Map();
  if (Array.isArray(bindingRecord.required)) {
    for (const requirement of bindingRecord.required) {
      if (requiredCapabilityStates.available.has(requirement.capability)) {
        requirements.set(requirement.capability, {
          role: 'required',
          record: requirement
        });
      }
    }
  }
  if (Array.isArray(bindingRecord.prerequisites)) {
    for (const prerequisite of bindingRecord.prerequisites) {
      requirements.set(prerequisite.capability, {
        role: 'prerequisite',
        record: prerequisite
      });
    }
  }
  const proofs = [];
  const seen = new Set();
  for (let index = 0; index < binding.routes.length; index += 1) {
    const route = binding.routes[index];
    const routePointer = pointer + '.binding.routes[' + index + ']';
    if (!requireRecord(route, routePointer, errors)) {
      continue;
    }
    validateKeys(
      route,
      ['capability', 'alternativeId', 'endpointKind'],
      ['capability', 'alternativeId', 'endpointKind'],
      routePointer,
      errors
    );
    requireString(route.capability, routePointer + '.capability', errors);
    requireString(route.alternativeId, routePointer + '.alternativeId', errors);
    requireString(route.endpointKind, routePointer + '.endpointKind', errors);
    if (seen.has(route.capability)) {
      addError(errors, routePointer + '.capability duplicates ' + route.capability + '.');
      continue;
    }
    seen.add(route.capability);
    const requirement = requirements.get(route.capability);
    if (!requirement) {
      addError(errors, routePointer + '.capability is not an available required capability or prerequisite for this expectation.');
      continue;
    }
    if (!tenantResult.endpointKinds.includes(route.endpointKind)) {
      addError(errors, routePointer + '.endpointKind is absent from the tenant descriptor.');
    }
    const alternatives = Array.isArray(requirement.record.alternatives)
      ? requirement.record.alternatives
      : [];
    const alternative = alternatives.find((candidate) => {
      return candidate?.id === route.alternativeId;
    });
    if (!alternative) {
      addError(errors, routePointer + ' does not select a source-attested alternative ID for ' + route.capability + '.');
      continue;
    }
    if (!Array.isArray(alternative.endpointKinds) || !alternative.endpointKinds.includes(route.endpointKind)) {
      addError(errors, routePointer + '.endpointKind is not permitted by alternative ' + route.alternativeId + '.');
    }
    if (alternative.verificationProfile !== binding.verificationProfileId) {
      addError(
        errors,
        routePointer + '.alternativeId does not belong to verification profile ' +
        binding.verificationProfileId + '.'
      );
    }
    proofs.push({
      role: requirement.role,
      capability: route.capability,
      alternativeId: alternative.id,
      verificationProfileId: alternative.verificationProfile,
      endpointKind: route.endpointKind,
      evidence: cloneEvidenceContract(alternative.evidence)
    });
  }
  for (const capabilityId of requirements.keys()) {
    if (!seen.has(capabilityId)) {
      addError(errors, pointer + '.binding.routes must include ' + capabilityId + '.');
    }
  }
  return {
    proofs,
    verificationProfile: verificationProfile ? structuredClone(verificationProfile) : null,
    adapterVerification: {
      sources: Array.isArray(bindingRecord.adapterSources)
        ? structuredClone(bindingRecord.adapterSources)
        : [],
      requirements: Array.isArray(bindingRecord.adapterRequirements)
        ? structuredClone(bindingRecord.adapterRequirements)
        : [],
      policy: bindingRecord.adapterRequirementPolicy
        ? structuredClone(bindingRecord.adapterRequirementPolicy)
        : null
    }
  };
}

function validateCapabilityBinding(capability, pointer, surface, tenantResult, catalog, errors, requiredCapabilityStates) {
  const binding = capability.binding;
  if (!requireRecord(binding, pointer + '.binding', errors)) {
    return emptyCapabilityBindingResult();
  }
  if (capability.expected === 'unavailable') {
    validateKeys(binding, ['kind'], ['kind'], pointer + '.binding', errors);
    if (binding.kind !== 'none') {
      addError(errors, pointer + '.binding.kind must equal none when expected is unavailable.');
    }
    return emptyCapabilityBindingResult();
  }
  const standaloneBinding = surface.bindings.get(capability.featurePack);
  if (!standaloneBinding) {
    const bindingRecord = Array.isArray(catalog.consoleModuleBindings)
      ? catalog.consoleModuleBindings.find((candidate) => candidate?.featurePack === capability.featurePack)
      : null;
    if (!bindingRecord) {
      addError(errors, 'The pinned Blocks snapshot has no source-attested Console binding for ' + capability.featurePack + '.');
      return emptyCapabilityBindingResult();
    }
    return validateConsoleCapabilityRoutes(
      binding,
      pointer,
      surface,
      tenantResult,
      bindingRecord,
      catalog,
      requiredCapabilityStates,
      errors
    );
  }
  if (capability.featurePack === 'data') {
    const configRef = standaloneBinding.configRef;
    const transport = standaloneBinding.transport;
    if (transport.kind === 'default' || transport.kind === 'custom-execute') {
      validateKeys(binding, ['kind', 'configRef', 'endpointKind'], ['kind', 'configRef', 'endpointKind'], pointer + '.binding', errors);
      if (binding.kind !== 'host-sheets' || binding.configRef !== configRef || binding.endpointKind !== standaloneBinding.endpointKind) {
        addError(errors, pointer + '.binding must be host-sheets with the mount\'s exact configRef and endpointKind.');
      }
      return emptyCapabilityBindingResult();
    }
    validateKeys(
      binding,
      ['kind', 'configRef', 'endpointKind', 'adapterRef', 'executeRef', 'justification'],
      ['kind', 'configRef', 'endpointKind', 'adapterRef', 'executeRef', 'justification'],
      pointer + '.binding',
      errors
    );
    if (binding.kind !== 'custom-adapter') {
      addError(errors, pointer + '.binding.kind must equal custom-adapter for a custom Data adapter mount.');
    }
    if (
      binding.configRef !== configRef ||
      binding.endpointKind !== standaloneBinding.endpointKind ||
      binding.adapterRef !== transport.adapterRef ||
      binding.executeRef !== transport.executeRef
    ) {
      addError(errors, pointer + '.binding must repeat the mount\'s exact config, adapter, and execute references.');
    }
    requireString(binding.justification, pointer + '.binding.justification', errors);
    return emptyCapabilityBindingResult();
  }
  validateKeys(
    binding,
    ['kind', 'resourcesRef', 'policyRef', 'actionsRef'],
    ['kind', 'resourcesRef', 'policyRef', 'actionsRef'],
    pointer + '.binding',
    errors
  );
  if (binding.kind !== 'host-resources') {
    addError(errors, pointer + '.binding.kind must equal host-resources.');
  }
  if (
    binding.resourcesRef !== standaloneBinding.resourcesRef ||
    binding.policyRef !== standaloneBinding.policyRef ||
    binding.actionsRef !== standaloneBinding.actionsRef
  ) {
    addError(errors, pointer + '.binding must repeat the standalone mount\'s host resource references.');
  }
  return emptyCapabilityBindingResult();
}

function validateCapabilities(acceptance, composition, tenantResult, provenance, catalog, errors) {
  const expectations = new Map();
  const surfaces = surfaceMap(composition);
  if (!Array.isArray(acceptance.capabilities)) {
    addError(errors, 'brief.acceptance.capabilities must be an array.');
    return expectations;
  }
  for (let index = 0; index < acceptance.capabilities.length; index += 1) {
    const capability = acceptance.capabilities[index];
    const pointer = 'brief.acceptance.capabilities[' + index + ']';
    if (!requireRecord(capability, pointer, errors)) {
      continue;
    }
    validateKeys(
      capability,
      ['surfaceId', 'featurePack', 'expected', 'binding', 'reason', 'requiredCapabilities'],
      ['surfaceId', 'featurePack', 'expected', 'binding'],
      pointer,
      errors
    );
    requireString(capability.surfaceId, pointer + '.surfaceId', errors);
    requireString(capability.featurePack, pointer + '.featurePack', errors);
    if (!CAPABILITY_STATES.has(capability.expected)) {
      addError(errors, pointer + '.expected must be ready, partial, or unavailable.');
    }
    if ((capability.expected === 'partial' || capability.expected === 'unavailable') && !isNonEmptyString(capability.reason)) {
      addError(errors, pointer + '.reason is required for partial or unavailable.');
    }
    if (capability.expected === 'ready' && Object.hasOwn(capability, 'reason')) {
      addError(errors, pointer + '.reason is not valid for ready.');
    }
    const requiredCapabilities = requiredCapabilitiesForPack(catalog, capability.featurePack);
    if (requiredCapabilities.length === 0) {
      addError(errors, pointer + '.featurePack has no required capability contract in the pinned Blocks snapshot.');
    }
    let requiredCapabilityStates = {
      available: new Set(),
      unavailable: new Set()
    };
    if (capability.expected === 'partial') {
      requiredCapabilityStates = validatePartialCapabilityPartition(
        capability,
        pointer,
        requiredCapabilities,
        errors
      );
    } else {
      if (Object.hasOwn(capability, 'requiredCapabilities')) {
        addError(errors, pointer + '.requiredCapabilities is valid only when expected is partial.');
      }
      const target = capability.expected === 'ready'
        ? requiredCapabilityStates.available
        : requiredCapabilityStates.unavailable;
      for (const capabilityId of requiredCapabilities) {
        target.add(capabilityId);
      }
    }
    const key = capability.surfaceId + ':' + capability.featurePack;
    if (expectations.has(key)) {
      addError(errors, pointer + ' duplicates capability expectation ' + key + '.');
    }
    let bindingResult = emptyCapabilityBindingResult();
    const surface = surfaces.get(capability.surfaceId);
    if (!surface) {
      addError(errors, pointer + '.surfaceId does not name an installed surface.');
    } else if (!surface.featurePacks.includes(capability.featurePack)) {
      addError(errors, pointer + '.featurePack is not installed on surface ' + capability.surfaceId + '.');
    } else {
      if (
        !surface.bindings.has(capability.featurePack) &&
        provenance.kind === 'preset' &&
        !provenance.featurePacks.includes(capability.featurePack) &&
        capability.expected !== 'unavailable'
      ) {
        addError(
          errors,
          pointer + ' must be unavailable because backend preset ' + provenance.preset + ' does not provision ' + capability.featurePack + '; use custom backend provenance for a separately attested composition.'
        );
      }
      bindingResult = validateCapabilityBinding(
        capability,
        pointer,
        surface,
        tenantResult,
        catalog,
        errors,
        requiredCapabilityStates
      );
    }
    expectations.set(key, {
      surfaceId: capability.surfaceId,
      featurePack: capability.featurePack,
      expected: capability.expected,
      binding: capability.binding,
      requiredCapabilities: {
        available: Array.from(requiredCapabilityStates.available),
        unavailable: Array.from(requiredCapabilityStates.unavailable)
      },
      proofs: bindingResult.proofs,
      verificationProfile: bindingResult.verificationProfile,
      adapterVerification: bindingResult.adapterVerification
    });
  }
  for (const surface of composition.surfaces) {
    for (const packId of surface.featurePacks) {
      const key = surface.id + ':' + packId;
      if (!expectations.has(key)) {
        addError(errors, 'brief.acceptance.capabilities is missing ' + key + '.');
      }
    }
  }
  return expectations;
}

function validateActorReferences(actorIds, pointer, actors, errors) {
  if (!Array.isArray(actorIds) || actorIds.length === 0) {
    addError(errors, pointer + ' must contain at least one actor ID.');
    return [];
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < actorIds.length; index += 1) {
    const actorId = actorIds[index];
    if (!isNonEmptyString(actorId) || !actors.has(actorId)) {
      addError(errors, pointer + '[' + index + '] does not name a declared actor.');
      continue;
    }
    if (seen.has(actorId)) {
      addError(errors, pointer + '[' + index + '] duplicates ' + actorId + '.');
    }
    seen.add(actorId);
    result.push(actors.get(actorId));
  }
  return result;
}

function validateStringSet(values, pointer, allowedValues, requiredValues, errors) {
  if (!Array.isArray(values) || values.length === 0) {
    addError(errors, pointer + ' must be a non-empty array.');
    return new Set();
  }
  const result = new Set();
  const allowed = new Set(allowedValues);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!allowed.has(value)) {
      addError(errors, pointer + '[' + index + '] has unsupported value ' + String(value) + '.');
      continue;
    }
    if (result.has(value)) {
      addError(errors, pointer + '[' + index + '] duplicates ' + value + '.');
    }
    result.add(value);
  }
  for (const required of requiredValues) {
    if (!result.has(required)) {
      addError(errors, pointer + ' must include ' + required + '.');
    }
  }
  return result;
}

function validateRlsActors(semantics, actorValues, tenantId, pointer, errors) {
  const activePrimary = actorValues.filter(
    (actor) => actor.kind === 'account' && actor.sessionState === 'active' && actor.tenantScope?.kind === 'primary' && actor.tenantScope.databaseId === tenantId
  );
  const revokedPrimary = actorValues.filter(
    (actor) => actor.kind === 'account' && actor.sessionState === 'revoked' && actor.tenantScope?.kind === 'primary' && actor.tenantScope.databaseId === tenantId
  );
  const anonymousPrimary = actorValues.filter(
    (actor) => actor.kind === 'anonymous' && actor.tenantScope?.kind === 'primary' && actor.tenantScope.databaseId === tenantId
  );
  const activeCrossTenant = actorValues.filter(
    (actor) => actor.kind === 'account' && actor.sessionState === 'active' && actor.tenantScope?.kind === 'isolation'
  );
  if (semantics === 'same-tenant-owner' && activePrimary.length < 1) {
    addError(errors, pointer + ' requires an active account scoped to tenant.id.');
  }
  if (semantics === 'same-tenant-peer') {
    const accounts = new Set(activePrimary.map((actor) => actor.accountRef));
    if (accounts.size < 2) {
      addError(errors, pointer + ' requires two distinct active accounts scoped to tenant.id.');
    }
  }
  if (semantics === 'anonymous' && (activePrimary.length < 1 || anonymousPrimary.length < 1)) {
    addError(errors, pointer + ' requires an active owner and an anonymous actor scoped to tenant.id.');
  }
  if (semantics === 'revoked-session' && (activePrimary.length < 1 || revokedPrimary.length < 1)) {
    addError(errors, pointer + ' requires an active owner and a revoked account session scoped to tenant.id.');
  }
  if (semantics === 'cross-tenant' && (activePrimary.length < 1 || activeCrossTenant.length < 1)) {
    addError(errors, pointer + ' requires an active owner on tenant.id and an active account scoped to a different tenantId.');
  }
}

function validateRlsExpectations(expectations, pointer, errors) {
  if (!Array.isArray(expectations)) {
    addError(errors, pointer + ' must be an array.');
    return {
      deniedMutation: false,
      operations: new Set()
    };
  }
  const operations = new Set();
  let deniedMutation = false;
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    const itemPointer = pointer + '[' + index + ']';
    if (!requireRecord(expectation, itemPointer, errors)) {
      continue;
    }
    validateKeys(expectation, ['operation', 'outcome'], ['operation', 'outcome'], itemPointer, errors);
    if (!CRUD_OPERATIONS.includes(expectation.operation)) {
      addError(errors, itemPointer + '.operation must be create, read, update, or delete.');
    } else if (operations.has(expectation.operation)) {
      addError(errors, itemPointer + '.operation duplicates ' + expectation.operation + '.');
    } else {
      operations.add(expectation.operation);
    }
    if (expectation.outcome !== 'allow' && expectation.outcome !== 'deny') {
      addError(errors, itemPointer + '.outcome must be allow or deny.');
    }
    if (expectation.outcome === 'deny' && expectation.operation !== 'read') {
      deniedMutation = true;
    }
  }
  for (const operation of CRUD_OPERATIONS) {
    if (!operations.has(operation)) {
      addError(errors, pointer + ' must declare ' + operation + '.');
    }
  }
  return {
    deniedMutation,
    operations
  };
}

function validateScenarios(acceptance, surfaces, routes, actors, tenantId, expectations, errors) {
  const result = {
    surfaceCoverage: new Set(),
    featureCapabilityCoverage: new Map(),
    routeCoverage: new Set(),
    crudCoverage: new Set(),
    rlsCoverage: new Map(),
    usedActorIds: new Set()
  };
  if (!Array.isArray(acceptance.scenarios)) {
    addError(errors, 'brief.acceptance.scenarios must be an array.');
    return result;
  }
  if (acceptance.scenarios.length === 0) {
    const requiresScenarios = routes.size > 0 || Array.from(expectations.values()).some(
      (expectation) => expectation.expected !== 'unavailable'
    );
    if (requiresScenarios) {
      addError(errors, 'brief.acceptance.scenarios must contain live scenarios for every ready/partial pack and domain route.');
    }
    return result;
  }
  const ids = new Set();
  for (let index = 0; index < acceptance.scenarios.length; index += 1) {
    const scenario = acceptance.scenarios[index];
    const pointer = 'brief.acceptance.scenarios[' + index + ']';
    if (!requireRecord(scenario, pointer, errors)) {
      continue;
    }
    if (scenario.kind === 'auth') {
      validateKeys(scenario, ['id', 'kind', 'target', 'actors', 'checks'], ['id', 'kind', 'target', 'actors', 'checks'], pointer, errors);
    } else if (scenario.kind === 'crud') {
      validateKeys(
        scenario,
        ['id', 'kind', 'target', 'actors', 'operations', 'reloadPersistence'],
        ['id', 'kind', 'target', 'actors', 'operations', 'reloadPersistence'],
        pointer,
        errors
      );
    } else if (scenario.kind === 'rls') {
      validateKeys(
        scenario,
        ['id', 'kind', 'target', 'actors', 'semantics', 'expectations', 'unchangedAfterDeniedMutation'],
        ['id', 'kind', 'target', 'actors', 'semantics', 'expectations', 'unchangedAfterDeniedMutation'],
        pointer,
        errors
      );
    } else if (scenario.kind === 'feature') {
      validateKeys(
        scenario,
        ['id', 'kind', 'target', 'actors', 'capabilityChecks', 'observations'],
        ['id', 'kind', 'target', 'actors', 'capabilityChecks'],
        pointer,
        errors
      );
    } else {
      addError(errors, pointer + '.kind must be auth, crud, rls, or feature.');
    }
    validateIdentifier(scenario.id, pointer + '.id', errors);
    if (ids.has(scenario.id)) {
      addError(errors, pointer + '.id duplicates ' + scenario.id + '.');
    }
    ids.add(scenario.id);
    const target = validateTarget(scenario.target, pointer + '.target', surfaces, routes, errors);
    const actorValues = validateActorReferences(scenario.actors, pointer + '.actors', actors, errors);
    for (const actor of actorValues) {
      result.usedActorIds.add(actor.id);
    }
    if (target?.kind === 'surface') {
      result.surfaceCoverage.add(target.surfaceId + ':' + target.featurePack);
    }
    if (target?.kind === 'domain-route') {
      result.routeCoverage.add(target.routeId);
    }
    if (scenario.kind === 'auth') {
      if (target?.kind !== 'surface' || target.featurePack !== 'auth') {
        addError(errors, pointer + '.target must be an installed auth surface.');
      }
      const expectation = target?.kind === 'surface'
        ? expectations.get(target.surfaceId + ':' + target.featurePack)
        : null;
      const expectedCapabilityStates = new Map();
      if (expectation) {
        for (const capabilityId of expectation.requiredCapabilities.available) {
          expectedCapabilityStates.set(capabilityId, 'ready');
        }
        for (const capabilityId of expectation.requiredCapabilities.unavailable) {
          expectedCapabilityStates.set(capabilityId, 'unavailable');
        }
      }
      const seenChecks = new Set();
      if (!Array.isArray(scenario.checks) || scenario.checks.length === 0) {
        addError(errors, pointer + '.checks must cover every required Auth check.');
      } else {
        for (let checkIndex = 0; checkIndex < scenario.checks.length; checkIndex += 1) {
          const check = scenario.checks[checkIndex];
          const checkPointer = pointer + '.checks[' + checkIndex + ']';
          if (!requireRecord(check, checkPointer, errors)) {
            continue;
          }
          validateKeys(check, ['id', 'expected'], ['id', 'expected'], checkPointer, errors);
          if (!AUTH_CHECKS.includes(check.id)) {
            addError(errors, checkPointer + '.id is not a required Auth check.');
            continue;
          }
          if (seenChecks.has(check.id)) {
            addError(errors, checkPointer + '.id duplicates ' + check.id + '.');
          }
          seenChecks.add(check.id);
          const capabilityId = AUTH_CHECK_CAPABILITY.get(check.id);
          const expectedState = expectedCapabilityStates.get(capabilityId);
          if (check.expected !== expectedState) {
            addError(errors, checkPointer + '.expected must equal ' + String(expectedState) + ' for ' + capabilityId + '.');
          }
        }
      }
      for (const checkId of AUTH_CHECKS) {
        if (!seenChecks.has(checkId)) {
          addError(errors, pointer + '.checks must include ' + checkId + '.');
        }
      }
      const readySessionCheck = Array.isArray(scenario.checks) && scenario.checks.some(
        (check) => AUTH_CHECK_CAPABILITY.get(check?.id) === 'auth.sessions' && check.expected === 'ready'
      );
      if (readySessionCheck) {
        const active = actorValues.some(
          (actor) => actor.kind === 'account' && actor.sessionState === 'active' && actor.tenantScope?.kind === 'primary' && actor.tenantScope.databaseId === tenantId
        );
        const revoked = actorValues.some(
          (actor) => actor.kind === 'account' && actor.sessionState === 'revoked' && actor.tenantScope?.kind === 'primary' && actor.tenantScope.databaseId === tenantId
        );
        if (!active || !revoked) {
          addError(errors, pointer + '.actors must include active and revoked primary-tenant accounts when Auth session checks are expected ready.');
        }
      }
    }
    if (scenario.kind === 'feature') {
      if (target?.kind !== 'surface' || target.featurePack === 'auth') {
        addError(errors, pointer + '.target must be an installed non-Auth feature-pack surface.');
      }
      const targetKey = target?.kind === 'surface'
        ? target.surfaceId + ':' + target.featurePack
        : null;
      const expectation = targetKey ? expectations.get(targetKey) : null;
      const requiredExpected = new Map();
      if (expectation) {
        for (const capabilityId of expectation.requiredCapabilities.available) {
          requiredExpected.set(capabilityId, 'ready');
        }
        for (const capabilityId of expectation.requiredCapabilities.unavailable) {
          requiredExpected.set(capabilityId, 'unavailable');
        }
        for (const proof of expectation.proofs) {
          if (proof.role === 'prerequisite') {
            requiredExpected.set(proof.capability, 'ready');
          }
        }
      }
      if (!Array.isArray(scenario.capabilityChecks) || scenario.capabilityChecks.length === 0) {
        addError(errors, pointer + '.capabilityChecks must cover required source-attested capabilities.');
      } else {
        let covered = targetKey ? result.featureCapabilityCoverage.get(targetKey) : null;
        if (!covered && targetKey) {
          covered = new Map();
          result.featureCapabilityCoverage.set(targetKey, covered);
        }
        for (let checkIndex = 0; checkIndex < scenario.capabilityChecks.length; checkIndex += 1) {
          const check = scenario.capabilityChecks[checkIndex];
          const checkPointer = pointer + '.capabilityChecks[' + checkIndex + ']';
          if (!requireRecord(check, checkPointer, errors)) {
            continue;
          }
          validateKeys(check, ['capability', 'expected'], ['capability', 'expected'], checkPointer, errors);
          requireString(check.capability, checkPointer + '.capability', errors);
          if (check.expected !== 'ready' && check.expected !== 'unavailable') {
            addError(errors, checkPointer + '.expected must be ready or unavailable.');
          }
          if (!requiredExpected.has(check.capability)) {
            addError(errors, checkPointer + '.capability is not a required capability for the target expectation.');
          } else if (requiredExpected.get(check.capability) !== check.expected) {
            addError(errors, checkPointer + '.expected must equal ' + requiredExpected.get(check.capability) + '.');
          }
          if (covered?.has(check.capability)) {
            addError(errors, checkPointer + '.capability duplicates coverage for ' + check.capability + '.');
          } else if (covered) {
            covered.set(check.capability, check.expected);
          }
        }
      }
      if (Object.hasOwn(scenario, 'observations')) {
        if (!Array.isArray(scenario.observations) || scenario.observations.length === 0) {
          addError(errors, pointer + '.observations must be a non-empty string array when present.');
        } else {
          for (let observationIndex = 0; observationIndex < scenario.observations.length; observationIndex += 1) {
            requireString(
              scenario.observations[observationIndex],
              pointer + '.observations[' + observationIndex + ']',
              errors
            );
          }
        }
      }
    }
    if (scenario.kind === 'crud') {
      if (target?.kind !== 'domain-route') {
        addError(errors, pointer + '.target must be a domain-route.');
      } else {
        result.crudCoverage.add(target.routeId);
      }
      validateStringSet(scenario.operations, pointer + '.operations', CRUD_OPERATIONS, CRUD_OPERATIONS, errors);
      if (scenario.reloadPersistence !== true) {
        addError(errors, pointer + '.reloadPersistence must be true.');
      }
      const activePrimary = actorValues.some(
        (actor) => actor.kind === 'account' && actor.sessionState === 'active' && actor.tenantScope?.kind === 'primary' && actor.tenantScope.databaseId === tenantId
      );
      if (!activePrimary) {
        addError(errors, pointer + '.actors requires an active account scoped to tenant.id.');
      }
    }
    if (scenario.kind === 'rls') {
      if (target?.kind !== 'domain-route') {
        addError(errors, pointer + '.target must be a domain-route.');
      }
      if (!RLS_SEMANTICS.includes(scenario.semantics)) {
        addError(errors, pointer + '.semantics has an unsupported RLS scope.');
      } else if (target?.kind === 'domain-route') {
        const key = target.routeId + ':' + scenario.semantics;
        if (result.rlsCoverage.has(key)) {
          addError(errors, pointer + ' duplicates RLS coverage ' + key + '.');
        }
        result.rlsCoverage.set(key, scenario);
        validateRlsActors(scenario.semantics, actorValues, tenantId, pointer + '.actors', errors);
      }
      const expectationResult = validateRlsExpectations(scenario.expectations, pointer + '.expectations', errors);
      requireBoolean(scenario.unchangedAfterDeniedMutation, pointer + '.unchangedAfterDeniedMutation', errors);
      if (expectationResult.deniedMutation && scenario.unchangedAfterDeniedMutation !== true) {
        addError(errors, pointer + '.unchangedAfterDeniedMutation must be true when a mutation is expected to be denied.');
      }
    }
  }
  for (const expectation of expectations.values()) {
    if (expectation.expected !== 'unavailable') {
      const key = expectation.surfaceId + ':' + expectation.featurePack;
      if (!result.surfaceCoverage.has(key)) {
        addError(errors, 'A ready or partial capability requires a scenario target for ' + key + '.');
      }
      if (expectation.featurePack !== 'auth') {
        const covered = result.featureCapabilityCoverage.get(key) || new Map();
        for (const capabilityId of expectation.requiredCapabilities.available) {
          if (covered.get(capabilityId) !== 'ready') {
            addError(errors, 'Feature scenario coverage for ' + key + ' is missing required ready capability ' + capabilityId + '.');
          }
        }
        for (const capabilityId of expectation.requiredCapabilities.unavailable) {
          if (covered.get(capabilityId) !== 'unavailable') {
            addError(errors, 'Feature scenario coverage for ' + key + ' is missing required unavailable capability ' + capabilityId + '.');
          }
        }
        for (const proof of expectation.proofs) {
          if (proof.role === 'prerequisite' && covered.get(proof.capability) !== 'ready') {
            addError(errors, 'Feature scenario coverage for ' + key + ' is missing ready prerequisite ' + proof.capability + '.');
          }
        }
      }
    }
  }
  for (const route of routes.values()) {
    if (!result.routeCoverage.has(route.id)) {
      addError(errors, 'Declared domain route ' + route.id + ' has no targeted scenario.');
    }
    if (route.mode === 'crud') {
      if (!result.crudCoverage.has(route.id)) {
        addError(errors, 'CRUD route ' + route.id + ' requires a complete CRUD scenario.');
      }
      for (const semantics of RLS_SEMANTICS) {
        const key = route.id + ':' + semantics;
        if (!result.rlsCoverage.has(key)) {
          addError(errors, 'CRUD route ' + route.id + ' is missing RLS coverage for ' + semantics + '.');
        }
      }
    }
  }
  return result;
}

function visualTargetKey(target) {
  if (target?.kind === 'surface') {
    return 'surface:' + target.surfaceId + ':' + target.featurePack;
  }
  if (target?.kind === 'domain-route') {
    return 'domain-route:' + target.routeId + ':' + target.resource;
  }
  if (target?.kind === 'shell') {
    return 'shell:' + target.surfaceId;
  }
  return 'invalid';
}

function validateViewportDefinitions(viewports, errors) {
  const result = new Map();
  if (!requireRecord(viewports, 'brief.acceptance.visual.viewports', errors)) {
    return result;
  }
  const viewportIds = Object.keys(viewports);
  for (const viewportId of viewportIds) {
    const pointer = 'brief.acceptance.visual.viewports.' + viewportId;
    if (!VIEWPORTS.has(viewportId)) {
      addError(errors, pointer + ' is not a supported viewport ID.');
      continue;
    }
    const viewport = viewports[viewportId];
    if (!requireRecord(viewport, pointer, errors)) {
      continue;
    }
    validateKeys(
      viewport,
      ['width', 'height', 'deviceScaleFactor', 'colorScheme'],
      ['width', 'height', 'deviceScaleFactor', 'colorScheme'],
      pointer,
      errors
    );
    if (!Number.isInteger(viewport.width) || viewport.width < 320 || viewport.width > 4096) {
      addError(errors, pointer + '.width must be an integer from 320 through 4096.');
    }
    if (!Number.isInteger(viewport.height) || viewport.height < 320 || viewport.height > 4096) {
      addError(errors, pointer + '.height must be an integer from 320 through 4096.');
    }
    if (
      typeof viewport.deviceScaleFactor !== 'number' ||
      !Number.isFinite(viewport.deviceScaleFactor) ||
      viewport.deviceScaleFactor < 1 ||
      viewport.deviceScaleFactor > 4
    ) {
      addError(errors, pointer + '.deviceScaleFactor must be a finite number from 1 through 4.');
    }
    if (!COLOR_SCHEMES.has(viewport.colorScheme)) {
      addError(errors, pointer + '.colorScheme must be light or dark.');
    }
    result.set(viewportId, {
      id: viewportId,
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      colorScheme: viewport.colorScheme
    });
  }
  for (const requiredViewport of ['desktop', 'mobile']) {
    if (!result.has(requiredViewport)) {
      addError(errors, 'brief.acceptance.visual.viewports must define ' + requiredViewport + '.');
    }
  }
  return result;
}

function validateVisual(acceptance, surfaces, routes, expectations, errors) {
  if (!requireRecord(acceptance.visual, 'brief.acceptance.visual', errors)) {
    return new Map();
  }
  validateKeys(
    acceptance.visual,
    ['viewports', 'targets'],
    ['viewports', 'targets'],
    'brief.acceptance.visual',
    errors
  );
  const viewportDefinitions = validateViewportDefinitions(acceptance.visual.viewports, errors);
  if (!Array.isArray(acceptance.visual.targets) || acceptance.visual.targets.length === 0) {
    addError(errors, 'brief.acceptance.visual.targets must contain target/viewports/states entries.');
    return viewportDefinitions;
  }
  const seen = new Set();
  const coveredSurfacePacks = new Set();
  const coveredShells = new Set();
  const coveredRoutes = new Set();
  for (let index = 0; index < acceptance.visual.targets.length; index += 1) {
    const visual = acceptance.visual.targets[index];
    const pointer = 'brief.acceptance.visual.targets[' + index + ']';
    if (!requireRecord(visual, pointer, errors)) {
      continue;
    }
    validateKeys(visual, ['target', 'viewports', 'states'], ['target', 'viewports', 'states'], pointer, errors);
    const target = validateTarget(visual.target, pointer + '.target', surfaces, routes, errors);
    const key = visualTargetKey(target);
    if (seen.has(key)) {
      addError(errors, pointer + '.target duplicates ' + key + '.');
    }
    seen.add(key);
    if (target?.kind === 'surface') {
      coveredSurfacePacks.add(target.surfaceId + ':' + target.featurePack);
    }
    if (target?.kind === 'domain-route') {
      coveredRoutes.add(target.routeId);
    }
    if (target?.kind === 'shell') {
      coveredShells.add(target.surfaceId);
    }
    const targetViewports = validateStringSet(
      visual.viewports,
      pointer + '.viewports',
      Array.from(VIEWPORTS),
      ['desktop', 'mobile'],
      errors
    );
    for (const viewportId of targetViewports) {
      if (!viewportDefinitions.has(viewportId)) {
        addError(errors, pointer + '.viewports references undefined viewport ' + viewportId + '.');
      }
    }
    const states = validateStringSet(visual.states, pointer + '.states', Array.from(VISUAL_STATES), [], errors);
    if (target?.kind === 'surface') {
      const expectation = expectations.get(target.surfaceId + ':' + target.featurePack);
      if (expectation?.expected === 'ready' && !states.has('ready')) {
        addError(errors, pointer + '.states must include ready for a ready capability.');
      }
      if (expectation?.expected === 'partial' && !states.has('partial')) {
        addError(errors, pointer + '.states must include partial for a partial capability.');
      }
      if (expectation?.expected === 'unavailable' && !states.has('unavailable')) {
        addError(errors, pointer + '.states must include unavailable for an unavailable capability.');
      }
    }
    if (target?.kind === 'shell' && !states.has('ready')) {
      addError(errors, pointer + '.states must include ready for a Console shell target.');
    }
  }
  for (const surface of surfaces.values()) {
    if (surface.isConsole && !coveredShells.has(surface.id)) {
      addError(errors, 'Console surface ' + surface.id + ' has no shell visual target.');
    }
    for (const packId of surface.featurePacks) {
      const key = surface.id + ':' + packId;
      if (!coveredSurfacePacks.has(key)) {
        addError(errors, 'Installed surface feature pack ' + key + ' has no visual target.');
      }
    }
  }
  for (const route of routes.values()) {
    if (!coveredRoutes.has(route.id)) {
      addError(errors, 'Declared domain route ' + route.id + ' has no visual target.');
    }
  }
  return viewportDefinitions;
}

function validateAcceptance(acceptance, composition, routesArray, tenantResult, provenance, catalog, isolationDocuments, errors) {
  if (!requireRecord(acceptance, 'brief.acceptance', errors)) {
    return null;
  }
  validateKeys(
    acceptance,
    ['capabilities', 'isolationTenants', 'actors', 'scenarios', 'visual'],
    ['capabilities', 'isolationTenants', 'actors', 'scenarios', 'visual'],
    'brief.acceptance',
    errors
  );
  const expectations = validateCapabilities(acceptance, composition, tenantResult, provenance, catalog, errors);
  const isolationTenants = validateIsolationTenants(acceptance, isolationDocuments, tenantResult, catalog, errors);
  const surfaces = surfaceMap(composition);
  const routes = routeMap(routesArray);
  const requiresActors = routes.size > 0 || Array.from(expectations.values()).some(
    (expectation) => expectation.expected !== 'unavailable'
  );
  const actors = validateActors(acceptance, tenantResult.id, isolationTenants, !requiresActors, errors);
  const scenarioCoverage = validateScenarios(
    acceptance,
    surfaces,
    routes,
    actors,
    tenantResult.id,
    expectations,
    errors
  );
  for (const actor of actors.values()) {
    if (!scenarioCoverage.usedActorIds.has(actor.id)) {
      addError(errors, 'brief.acceptance.actors declares unused actor ' + actor.id + '.');
    }
  }
  const usedIsolationTenants = new Set();
  for (const actorId of scenarioCoverage.usedActorIds) {
    const actor = actors.get(actorId);
    if (actor?.tenantScope?.kind === 'isolation') {
      usedIsolationTenants.add(actor.tenantScope.tenantRef);
    }
  }
  for (const isolationTenant of isolationTenants.values()) {
    if (!usedIsolationTenants.has(isolationTenant.id)) {
      addError(
        errors,
        'brief.acceptance.isolationTenants declares unused isolation tenant ' + isolationTenant.id + '.'
      );
    }
  }
  const visualViewports = validateVisual(acceptance, surfaces, routes, expectations, errors);
  const resolvedScenarios = [];
  if (Array.isArray(acceptance.scenarios)) {
    for (const scenario of acceptance.scenarios) {
      if (!isRecord(scenario) || !isNonEmptyString(scenario.id)) {
        continue;
      }
      const assertionIds = [];
      const assertionContracts = [];
      const targetKey = scenario.target?.kind === 'surface'
        ? scenario.target.surfaceId + ':' + scenario.target.featurePack
        : null;
      const targetExpectation = targetKey ? expectations.get(targetKey) : null;
      const proofByCapability = new Map();
      if (Array.isArray(targetExpectation?.proofs)) {
        for (const proof of targetExpectation.proofs) {
          proofByCapability.set(proof.capability, proof);
        }
      }
      const addAssertion = (id, capabilityId = null) => {
        const proof = capabilityId ? proofByCapability.get(capabilityId) : null;
        assertionIds.push(id);
        assertionContracts.push({
          id,
          contract: proof
            ? {
              role: proof.role,
              capability: proof.capability,
              alternativeId: proof.alternativeId,
              verificationProfileId: proof.verificationProfileId,
              endpointKind: proof.endpointKind,
              evidence: cloneEvidenceContract(proof.evidence)
            }
            : null
        });
      };
      if (scenario.kind === 'auth' && Array.isArray(scenario.checks)) {
        for (const check of scenario.checks) {
          addAssertion(
            'auth-check:' + check.id + ':' + check.expected,
            AUTH_CHECK_CAPABILITY.get(check.id)
          );
        }
      } else if (scenario.kind === 'crud' && Array.isArray(scenario.operations)) {
        for (const operation of scenario.operations) {
          addAssertion('operation:' + operation);
        }
        addAssertion('reload-persistence');
      } else if (scenario.kind === 'rls' && Array.isArray(scenario.expectations)) {
        for (const expectation of scenario.expectations) {
          addAssertion('operation:' + expectation.operation + ':' + expectation.outcome);
        }
        if (scenario.unchangedAfterDeniedMutation === true) {
          addAssertion('denied-mutation-unchanged');
        }
      } else if (scenario.kind === 'feature' && Array.isArray(scenario.capabilityChecks)) {
        for (const check of scenario.capabilityChecks) {
          addAssertion(
            'capability:' + check.capability + ':' + check.expected,
            check.expected === 'ready' ? check.capability : null
          );
        }
        if (Array.isArray(scenario.observations)) {
          for (let index = 0; index < scenario.observations.length; index += 1) {
            addAssertion('observation:' + (index + 1));
          }
        }
      }
      resolvedScenarios.push({
        id: scenario.id,
        kind: scenario.kind,
        target: scenario.target,
        actorIds: Array.isArray(scenario.actors) ? scenario.actors.slice() : [],
        assertionIds,
        assertionContracts
      });
    }
  }
  return {
    capabilities: Array.from(expectations.values()).map((expectation) => {
      return {
        surfaceId: expectation.surfaceId,
        featurePack: expectation.featurePack,
        expected: expectation.expected,
        requiredCapabilities: {
          available: expectation.requiredCapabilities.available.slice(),
          unavailable: expectation.requiredCapabilities.unavailable.slice()
        },
        verificationProfile: expectation.verificationProfile
          ? structuredClone(expectation.verificationProfile)
          : null,
        adapterVerification: expectation.adapterVerification
          ? structuredClone(expectation.adapterVerification)
          : null,
        proofs: expectation.proofs.map((proof) => {
          return {
            role: proof.role,
            capability: proof.capability,
            alternativeId: proof.alternativeId,
            verificationProfileId: proof.verificationProfileId,
            endpointKind: proof.endpointKind,
            evidence: cloneEvidenceContract(proof.evidence)
          };
        })
      };
    }),
    isolationTenants: Array.from(isolationTenants.values()),
    actors: Array.from(actors.values()),
    scenarios: resolvedScenarios,
    visualViewports: Array.from(visualViewports.values()),
    visualTargets: Array.isArray(acceptance.visual?.targets)
      ? acceptance.visual.targets.map((visual) => {
        return {
          target: visual.target,
          viewports: Array.isArray(visual.viewports) ? visual.viewports.slice() : [],
          states: Array.isArray(visual.states) ? visual.states.slice() : []
        };
      })
      : []
  };
}

function resolveWorkspace(brief, briefPath, errors) {
  if (!isRecord(brief.app) || !isNonEmptyString(brief.app.workspace)) {
    return null;
  }
  if (!validateRelativePath(brief.app.workspace, 'brief.app.workspace', errors, true)) {
    return null;
  }
  const briefDirectory = path.dirname(briefPath);
  const workspacePath = path.resolve(briefDirectory, brief.app.workspace);
  const relative = path.relative(briefDirectory, workspacePath);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    addError(errors, 'brief.app.workspace must stay within the brief directory.');
    return null;
  }
  if (!fs.existsSync(workspacePath)) {
    addError(errors, 'brief.app.workspace must already exist before validation: ' + workspacePath);
    return workspacePath;
  }
  let stats;
  try {
    stats = fs.statSync(workspacePath);
  } catch (error) {
    addError(errors, 'brief.app.workspace could not be inspected: ' + error.message);
    return workspacePath;
  }
  if (!stats.isDirectory()) {
    addError(errors, 'brief.app.workspace must resolve to a directory.');
  }
  const realBriefDirectory = fs.realpathSync(briefDirectory);
  const realWorkspace = fs.realpathSync(workspacePath);
  const realRelative = path.relative(realBriefDirectory, realWorkspace);
  if (realRelative.startsWith('..' + path.sep) || realRelative === '..' || path.isAbsolute(realRelative)) {
    addError(errors, 'brief.app.workspace must not escape through a symlink.');
  }
  return workspacePath;
}

function arraysIntersect(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function consoleBindingUsesMetaDiscovery(capability, catalog) {
  if (capability?.binding?.kind !== 'first-party' || !Array.isArray(capability.binding.routes)) {
    return false;
  }
  const bindingRecord = Array.isArray(catalog.consoleModuleBindings)
    ? catalog.consoleModuleBindings.find((binding) => binding?.featurePack === capability.featurePack)
    : null;
  const requirements = [];
  if (Array.isArray(bindingRecord?.required)) {
    for (const requirement of bindingRecord.required) {
      requirements.push(requirement);
    }
  }
  if (Array.isArray(bindingRecord?.prerequisites)) {
    for (const prerequisite of bindingRecord.prerequisites) {
      requirements.push(prerequisite);
    }
  }
  return capability.binding.routes.some((route) => {
    const requirement = requirements.find((candidate) => candidate?.capability === route?.capability);
    const alternative = Array.isArray(requirement?.alternatives)
      ? requirement.alternatives.find((candidate) => candidate?.id === route?.alternativeId)
      : null;
    return alternative?.evidence?.type === 'compatible-meta-contract';
  });
}

function runtimeModesForSurface(surface, composition, acceptance, tenantResult, items, catalog) {
  const modes = new Set();
  const surfaceTypes = surface.roots
    .map((root) => items.get(root)?.surface)
    .filter((surfaceType) => isNonEmptyString(surfaceType));
  if (surfaceTypes.includes('standalone-feature-pack')) {
    modes.add('standalone');
    for (const binding of surface.bindings.values()) {
      if (binding?.session?.kind) {
        modes.add(binding.session.kind);
        if (binding.session.kind === 'standalone-auth') {
          modes.add('standalone-auth');
          if (tenantResult.requireCsrfForAuth === true) {
            modes.add('standalone-auth-csrf-required');
          }
        }
      }
    }
  } else {
    modes.add('console');
    modes.add('console-discovery');
    if (Array.isArray(acceptance?.capabilities)) {
      for (const capability of acceptance.capabilities) {
        if (
          capability?.surfaceId === surface.id &&
          consoleBindingUsesMetaDiscovery(capability, catalog)
        ) {
          modes.add('console-meta-discovery');
        }
      }
    }
  }
  if (composition.kind === 'console-core') {
    modes.add('console-core');
  }
  return Array.from(modes);
}

function applicableSourceLimitations(composition, acceptance, tenantResult, catalog, errors, warnings) {
  if (!Array.isArray(catalog?.sourceLimitations)) {
    addError(errors, 'The pinned Blocks snapshot has no sourceLimitations contract.');
    return [];
  }
  const items = itemMapFromCatalog(catalog, errors);
  const applicable = [];
  for (const limitation of catalog.sourceLimitations) {
    const scope = limitation?.appliesTo;
    if (
      !isRecord(limitation) ||
      !isNonEmptyString(limitation.id) ||
      !isRecord(scope) ||
      !['blocking', 'require-mitigation'].includes(limitation.acceptance)
    ) {
      addError(errors, 'The pinned Blocks snapshot contains a malformed source limitation.');
      continue;
    }
    const matchingSurfaces = [];
    const matchingRoots = new Set();
    const matchingPacks = new Set();
    const matchingModes = new Set();
    for (const surface of composition.surfaces) {
      const surfaceTypes = surface.roots
        .map((root) => items.get(root)?.surface)
        .filter((surfaceType) => isNonEmptyString(surfaceType));
      const modes = runtimeModesForSurface(
        surface,
        composition,
        acceptance,
        tenantResult,
        items,
        catalog
      );
      if (
        arraysIntersect(surfaceTypes, scope.surfaces) &&
        arraysIntersect(surface.roots, scope.installRoots) &&
        arraysIntersect(surface.featurePacks, scope.featurePacks) &&
        arraysIntersect(modes, scope.runtimeModes)
      ) {
        matchingSurfaces.push(surface.id);
        for (const root of surface.roots) {
          if (scope.installRoots.includes(root)) {
            matchingRoots.add(root);
          }
        }
        for (const packId of surface.featurePacks) {
          if (scope.featurePacks.includes(packId)) {
            matchingPacks.add(packId);
          }
        }
        for (const mode of modes) {
          if (scope.runtimeModes.includes(mode)) {
            matchingModes.add(mode);
          }
        }
      }
    }
    if (matchingSurfaces.length === 0) {
      continue;
    }
    const mitigationRequirements = [];
    const mitigationRequirementIds = new Set();
    if (!Array.isArray(limitation.mitigationRequirements) || limitation.mitigationRequirements.length === 0) {
      addError(errors, 'Pinned Blocks source limitation ' + limitation.id + ' has no mitigation requirements.');
    } else {
      for (let index = 0; index < limitation.mitigationRequirements.length; index += 1) {
        const requirement = limitation.mitigationRequirements[index];
        const pointer = 'catalog.sourceLimitations[' + limitation.id + '].mitigationRequirements[' + index + ']';
        if (!requireRecord(requirement, pointer, errors)) {
          continue;
        }
        validateKeys(requirement, ['id', 'requirement'], ['id', 'requirement'], pointer, errors);
        validateIdentifier(requirement.id, pointer + '.id', errors);
        requireString(requirement.requirement, pointer + '.requirement', errors);
        if (mitigationRequirementIds.has(requirement.id)) {
          addError(errors, pointer + '.id duplicates ' + requirement.id + '.');
          continue;
        }
        mitigationRequirementIds.add(requirement.id);
        mitigationRequirements.push({
          id: requirement.id,
          requirement: requirement.requirement
        });
      }
    }
    applicable.push({
      id: limitation.id,
      status: limitation.status,
      acceptance: limitation.acceptance,
      failureState: limitation.failureState,
      observedBehavior: limitation.observedBehavior,
      portableRequirement: limitation.portableRequirement,
      mitigationRequirements,
      sourceEvidence: Array.isArray(limitation.sourceEvidence)
        ? limitation.sourceEvidence.map((evidence) => {
          return {
            path: evidence.path,
            sha256: evidence.sha256
          };
        })
        : [],
      surfaceIds: matchingSurfaces,
      installRoots: Array.from(matchingRoots),
      featurePacks: Array.from(matchingPacks),
      runtimeModes: Array.from(matchingModes)
    });
    warnings.push(
      'Pinned Blocks source limitation ' + limitation.id + ' applies to ' + matchingSurfaces.join(', ') + ' and must follow acceptance policy ' + limitation.acceptance + '.'
    );
  }
  return applicable;
}

export function validateBriefDocument(input) {
  const brief = input.brief;
  const tenant = input.tenant;
  const catalog = input.catalog;
  const briefPath = path.resolve(input.briefPath || 'app-brief.json');
  const errors = [];
  const warnings = [];
  const resolved = {
    tenantId: null,
    tenantContract: null,
    tenantProvenance: null,
    compositionKind: null,
    installRoots: [],
    surfaces: [],
    domainRoutes: [],
    workspacePath: null,
    metaContractVersion: catalog?.metaContract?.version || null,
    runtimeLimitations: []
  };
  if (!requireRecord(brief, 'brief', errors)) {
    return { errors, warnings, resolved };
  }
  findRemovedKeys(brief, 'brief', errors);
  validateKeys(brief, ['schemaVersion', 'kind', 'app', 'tenant', 'frontend', 'domain', 'acceptance'], ['schemaVersion', 'kind', 'app', 'tenant', 'frontend', 'domain', 'acceptance'], 'brief', errors);
  if (brief.schemaVersion !== BRIEF_SCHEMA_VERSION) {
    addError(errors, 'brief.schemaVersion must equal ' + BRIEF_SCHEMA_VERSION + '.');
  }
  if (brief.kind !== BRIEF_KIND) {
    addError(errors, 'brief.kind must equal ' + BRIEF_KIND + '.');
  }
  if (requireRecord(brief.app, 'brief.app', errors)) {
    validateKeys(brief.app, ['id', 'name', 'workspace'], ['id', 'name', 'workspace'], 'brief.app', errors);
    validateIdentifier(brief.app.id, 'brief.app.id', errors);
    requireString(brief.app.name, 'brief.app.name', errors);
    resolved.workspacePath = resolveWorkspace(brief, briefPath, errors);
  }
  let provenance = { kind: null, preset: null, frontendPresetRoot: null, featurePacks: null };
  let descriptorPath = null;
  if (requireRecord(brief.tenant, 'brief.tenant', errors)) {
    validateKeys(brief.tenant, ['descriptorPath', 'provenance'], ['descriptorPath', 'provenance'], 'brief.tenant', errors);
    if (validateRelativePath(brief.tenant.descriptorPath, 'brief.tenant.descriptorPath', errors, false)) {
      descriptorPath = path.resolve(path.dirname(briefPath), brief.tenant.descriptorPath);
    }
    provenance = validateProvenance(brief.tenant.provenance, catalog, errors);
  }
  const tenantResult = validateTenant(tenant, catalog, errors);
  resolved.tenantId = tenantResult.id;
  resolved.tenantContract = {
    id: tenantResult.id,
    endpointKinds: tenantResult.endpointKinds.slice(),
    requireCsrfForAuth: tenantResult.requireCsrfForAuth
  };
  resolved.tenantProvenance = provenance;
  if (descriptorPath && input.tenantPath && path.resolve(input.tenantPath) !== descriptorPath) {
    addError(errors, 'The tenant input must exactly match brief.tenant.descriptorPath.');
  }
  let composition = { kind: null, installRoots: [], surfaces: [] };
  if (requireRecord(brief.frontend, 'brief.frontend', errors)) {
    validateKeys(brief.frontend, ['composition'], ['composition'], 'brief.frontend', errors);
    composition = validateComposition(brief.frontend.composition, provenance, tenantResult, catalog, errors);
  }
  const routes = validateDomain(brief.domain, errors);
  const isolationDocuments = input.isolationTenantDocuments instanceof Map
    ? input.isolationTenantDocuments
    : new Map();
  resolved.acceptance = validateAcceptance(
    brief.acceptance,
    composition,
    routes,
    tenantResult,
    provenance,
    catalog,
    isolationDocuments,
    errors
  );
  resolved.compositionKind = composition.kind;
  resolved.installRoots = composition.installRoots.slice();
  resolved.surfaces = composition.surfaces.map((surface) => {
    return {
      id: surface.id,
      mountPath: surface.mountPath,
      roots: surface.roots.slice(),
      featurePacks: surface.featurePacks.slice(),
      surfaceTypes: surface.surfaceTypes.slice(),
      isConsole: surface.isConsole
    };
  });
  resolved.domainRoutes = routes.map((route) => {
    return {
      id: route.id,
      path: route.path,
      resource: route.resource,
      mode: route.mode
    };
  });
  resolved.runtimeLimitations = applicableSourceLimitations(
    composition,
    brief.acceptance,
    tenantResult,
    catalog,
    errors,
    warnings
  );
  return { errors, warnings, resolved };
}

function runGit(blocksSource, argumentsList) {
  return execFileSync('git', ['-C', blocksSource].concat(argumentsList), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function attestFile(role, filePath, expectedSha256, errors, immutableFiles) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    addError(errors, role + ' is missing at ' + absolutePath + '.');
    return null;
  }
  const stats = fs.lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    addError(errors, role + ' must be a regular, non-symlink file at ' + absolutePath + '.');
    return null;
  }
  const actualSha256 = sha256File(absolutePath);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    addError(errors, role + ' SHA-256 mismatch at ' + absolutePath + '.');
  }
  const attestation = {
    role,
    path: absolutePath,
    sha256: actualSha256
  };
  immutableFiles.push(attestation);
  return attestation;
}

const WORKSPACE_ROOT_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules'
]);

function collectWorkspaceEntries(workspacePath, relativeDirectory, entries) {
  const directoryPath = relativeDirectory
    ? path.join(workspacePath, relativeDirectory)
    : workspacePath;
  const directoryEntries = fs.readdirSync(directoryPath, { withFileTypes: true });
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name));
  for (const directoryEntry of directoryEntries) {
    const relativePath = relativeDirectory
      ? path.posix.join(relativeDirectory.split(path.sep).join('/'), directoryEntry.name)
      : directoryEntry.name;
    if (directoryEntry.isDirectory()) {
      if (relativeDirectory === '' && WORKSPACE_ROOT_EXCLUDED_DIRECTORIES.has(directoryEntry.name)) {
        continue;
      }
      if (relativePath === '.constructive/harness') {
        continue;
      }
      collectWorkspaceEntries(workspacePath, relativePath, entries);
      continue;
    }
    const filePath = path.join(workspacePath, relativePath);
    const stats = fs.lstatSync(filePath);
    if (directoryEntry.isSymbolicLink()) {
      const target = fs.readlinkSync(filePath);
      entries.push({
        path: relativePath,
        type: 'symlink',
        mode: stats.mode & 0o777,
        size: Buffer.byteLength(target),
        sha256: sha256Text(target)
      });
      continue;
    }
    if (directoryEntry.isFile()) {
      entries.push({
        path: relativePath,
        type: 'file',
        mode: stats.mode & 0o777,
        size: stats.size,
        sha256: sha256File(filePath)
      });
    }
  }
}

export function computeWorkspaceAttestation(workspacePath) {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return null;
  }
  const entries = [];
  collectWorkspaceEntries(workspacePath, '', entries);
  let gitHead = null;
  try {
    gitHead = runGit(workspacePath, ['rev-parse', 'HEAD']);
  } catch {
    gitHead = null;
  }
  const descriptor = JSON.stringify({
    path: workspacePath,
    entries,
    gitHead
  });
  return {
    path: workspacePath,
    entries,
    fileCount: entries.length,
    gitHead,
    sha256: sha256Text(descriptor)
  };
}

function validateSnapshotAttestations(catalog, catalogPath, selectedRoots, errors, immutableFiles) {
  const catalogDirectory = path.dirname(catalogPath);
  const skillDirectory = path.resolve(catalogDirectory, '..');
  const sourceAttestations = catalog.source?.attestations;
  if (!isRecord(sourceAttestations)) {
    addError(errors, 'The Blocks catalog has no source attestations.');
    return [];
  }
  if (sourceAttestations.algorithm !== 'sha256') {
    addError(errors, 'The Blocks catalog source attestation algorithm must be sha256.');
  }
  if (isRecord(sourceAttestations.registryCatalog)) {
    attestFile(
      'blocks-registry-catalog',
      path.resolve(skillDirectory, sourceAttestations.registryCatalog.path),
      sourceAttestations.registryCatalog.sha256,
      errors,
      immutableFiles
    );
  } else {
    addError(errors, 'The Blocks catalog has no registryCatalog attestation.');
  }
  const planAttestations = Array.isArray(sourceAttestations.installPlans) ? sourceAttestations.installPlans : [];
  const plans = [];
  for (const root of selectedRoots) {
    const attestation = planAttestations.find((candidate) => candidate?.item === root);
    if (!attestation) {
      addError(errors, 'The Blocks catalog has no install-plan attestation for ' + root + '.');
      continue;
    }
    const planPath = path.resolve(skillDirectory, attestation.path);
    const fileAttestation = attestFile('blocks-install-plan:' + root, planPath, attestation.sha256, errors, immutableFiles);
    const plan = readJsonFile(planPath, 'Blocks install plan ' + root, errors);
    if (plan && (plan.kind !== 'constructive.console-kit-install-plan' || plan.item !== root)) {
      addError(errors, 'The attested install plan for ' + root + ' has the wrong kind or item.');
    }
    if (fileAttestation) {
      plans.push({
        root,
        path: fileAttestation.path,
        sha256: fileAttestation.sha256
      });
    }
  }
  return plans;
}

function validateBlocksSource(catalog, catalogPath, blocksSourceInput, errors, immutableFiles) {
  const publicationStatus = catalog.source?.publicationStatus || catalog.release?.status;
  if (publicationStatus !== 'branch-only' && !blocksSourceInput) {
    return null;
  }
  if (!blocksSourceInput) {
    addError(errors, 'The Blocks contract is branch-only; --blocks-source is required before validation can pass or a journal can initialize.');
    return null;
  }
  const blocksSource = path.resolve(blocksSourceInput);
  if (!fs.existsSync(blocksSource) || !fs.statSync(blocksSource).isDirectory()) {
    addError(errors, '--blocks-source must resolve to an existing directory.');
    return null;
  }
  let headCommit = null;
  let branch = null;
  let checkerOutput = '';
  try {
    headCommit = runGit(blocksSource, ['rev-parse', 'HEAD']);
    branch = runGit(blocksSource, ['branch', '--show-current']);
    const trackedStatus = runGit(blocksSource, ['status', '--porcelain=v1', '--untracked-files=no']);
    if (trackedStatus) {
      addError(errors, '--blocks-source must have no tracked worktree changes.');
    }
  } catch (error) {
    addError(errors, '--blocks-source must be a Git worktree: ' + error.message);
    return null;
  }
  const sourceAttestations = catalog.source?.attestations;
  if (Array.isArray(sourceAttestations?.canonicalFiles)) {
    for (const canonical of sourceAttestations.canonicalFiles) {
      attestFile(
        'blocks-source:' + canonical.path,
        path.resolve(blocksSource, canonical.path),
        canonical.sha256,
        errors,
        immutableFiles
      );
    }
  }
  const checkerPath = path.resolve(path.dirname(catalogPath), '..', 'scripts', 'check-blocks-contract.mjs');
  const checkerAttestation = attestFile(
    'blocks-checker',
    checkerPath,
    null,
    errors,
    immutableFiles
  );
  try {
    checkerOutput = execFileSync(
      process.execPath,
      [checkerPath, '--blocks-repo', blocksSource, '--source-preflight'],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch (error) {
    addError(errors, 'The constructive-blocks source checker failed: ' + String(error.stderr || error.message).trim());
  }
  return {
    path: blocksSource,
    headCommit,
    branch,
    checkerPath,
    checkerSha256: checkerAttestation ? checkerAttestation.sha256 : null,
    checkerOutputSha256: checkerOutput ? sha256Text(checkerOutput) : null
  };
}

export function validateBriefFiles(options) {
  const errors = [];
  const warnings = [];
  const immutableFiles = [];
  const briefPath = path.resolve(options.briefPath);
  const catalogPath = CANONICAL_BLOCKS_CATALOG_PATH;
  if (options.catalogPath && path.resolve(options.catalogPath) !== catalogPath) {
    addError(errors, 'The Blocks catalog is fixed to the canonical constructive-blocks sibling skill and cannot be overridden.');
  }
  const brief = readJsonFile(briefPath, 'App brief', errors);
  const catalog = readJsonFile(catalogPath, 'Blocks catalog', errors);
  let tenantPath = options.tenantPath ? path.resolve(options.tenantPath) : null;
  let declaredTenantPath = null;
  let hasDeclaredTenantPath = false;
  if (isRecord(brief?.tenant) && isNonEmptyString(brief.tenant.descriptorPath)) {
    hasDeclaredTenantPath = true;
    if (isSafeRelativePath(brief.tenant.descriptorPath)) {
      declaredTenantPath = resolveBriefOwnedFile(
        path.dirname(briefPath),
        brief.tenant.descriptorPath,
        'brief.tenant.descriptorPath',
        errors
      );
    }
  }
  if (hasDeclaredTenantPath && !declaredTenantPath) {
    tenantPath = null;
  }
  if (tenantPath && declaredTenantPath && tenantPath !== declaredTenantPath) {
    addError(errors, '--tenant must resolve to the exact brief.tenant.descriptorPath; two tenant sources are not allowed.');
  }
  if (!tenantPath) {
    tenantPath = declaredTenantPath;
  }
  const tenant = tenantPath ? readJsonFile(tenantPath, 'Tenant descriptor', errors) : null;
  if (!tenantPath) {
    addError(errors, 'A tenant descriptor path is required.');
  }
  let documentResult = {
    errors: [],
    warnings: [],
    resolved: null
  };
  const isolationTenantDocuments = new Map();
  const isolationTenantFiles = [];
  if (Array.isArray(brief?.acceptance?.isolationTenants)) {
    for (const isolation of brief.acceptance.isolationTenants) {
      if (!isRecord(isolation) || !isNonEmptyString(isolation.id) || !isSafeRelativePath(isolation.descriptorPath) || isolation.descriptorPath === '.') {
        continue;
      }
      const isolationPath = resolveBriefOwnedFile(
        path.dirname(briefPath),
        isolation.descriptorPath,
        'Isolation tenant ' + isolation.id + ' descriptorPath',
        errors
      );
      if (!isolationPath) {
        continue;
      }
      const isolationDocument = readJsonFile(isolationPath, 'Isolation tenant ' + isolation.id, errors);
      if (isolationDocument) {
        isolationTenantDocuments.set(isolation.id, isolationDocument);
        isolationTenantFiles.push({
          id: isolation.id,
          path: isolationPath
        });
      }
    }
  }
  if (brief && catalog && tenant) {
    documentResult = validateBriefDocument({
      brief,
      tenant,
      catalog,
      briefPath,
      tenantPath,
      isolationTenantDocuments
    });
    errors.push.apply(errors, documentResult.errors);
    warnings.push.apply(warnings, documentResult.warnings);
  }
  if (brief) {
    attestFile('brief', briefPath, null, errors, immutableFiles);
  }
  if (tenantPath && tenant) {
    attestFile('tenant', tenantPath, null, errors, immutableFiles);
  }
  for (const isolationFile of isolationTenantFiles) {
    attestFile('isolation-tenant:' + isolationFile.id, isolationFile.path, null, errors, immutableFiles);
  }
  if (catalog) {
    attestFile('blocks-contract', catalogPath, null, errors, immutableFiles);
  }
  let installPlans = [];
  let blocksSource = null;
  if (catalog && documentResult.resolved) {
    installPlans = validateSnapshotAttestations(
      catalog,
      catalogPath,
      documentResult.resolved.installRoots,
      errors,
      immutableFiles
    );
    blocksSource = validateBlocksSource(
      catalog,
      catalogPath,
      options.blocksSource,
      errors,
      immutableFiles
    );
  }
  if (documentResult.resolved && documentResult.resolved.domainRoutes.length > 0) {
    attestFile('meta-guidance:constructive-frontend', META_FRONTEND_GUIDANCE, null, errors, immutableFiles);
    attestFile('meta-guidance:constructive-orm', META_ORM_GUIDANCE, null, errors, immutableFiles);
  }
  const workspace = computeWorkspaceAttestation(documentResult.resolved?.workspacePath);
  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    kind: VALIDATION_KIND,
    ok: errors.length === 0,
    inputs: {
      brief: briefPath,
      tenant: tenantPath,
      catalog: catalogPath,
      blocksSource,
      installPlans,
      immutableFiles,
      workspace
    },
    resolved: documentResult.resolved,
    warnings,
    errors
  };
}

export function writeJsonAtomic(filePath, value) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = absolutePath + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}
