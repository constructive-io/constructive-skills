#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertBlocksSource,
  assertSnapshot,
  collectAttestedExternalPackages,
  collectAttestedRegistrySources,
  pinInspectorInstallCommand,
  projectRegistryCatalog,
  validateSkillArtifacts
} from './check-blocks-contract.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');
const referencesDirectory = path.join(skillDirectory, 'references');
const contractPath = path.join(referencesDirectory, 'install-roots.v1.json');
const registryOrigin = 'https://registry.npmjs.org';

function fail(message) {
  throw new Error(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    fail(`Unable to read ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function writeJson(filePath, value, spacing = 2) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, spacing)}\n`, 'utf8');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function refreshCanonicalSourceLinks(value, canonicalByPath, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    canonicalByPath.has(value.path)
  ) {
    value.sha256 = canonicalByPath.get(value.path);
  }
  for (const child of Object.values(value)) {
    refreshCanonicalSourceLinks(child, canonicalByPath, seen);
  }
}

function run(command, arguments_, label, options = {}) {
  try {
    return execFileSync(command, arguments_, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
  } catch (cause) {
    const stderr = cause && typeof cause === 'object' && typeof cause.stderr === 'string'
      ? cause.stderr.trim()
      : '';
    fail(`${label} failed: ${stderr || (cause instanceof Error ? cause.message : String(cause))}`);
  }
}

function parseJsonCommand(command, arguments_, label) {
  const stdout = run(command, arguments_, label);
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    fail(`${label} did not emit JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function assertCleanPinnedCheckout(contract, blocksRepo) {
  if (!fs.existsSync(blocksRepo)) {
    fail(`Blocks repository does not exist: ${blocksRepo}`);
  }
  const commit = run(
    'git',
    ['-C', blocksRepo, 'rev-parse', 'HEAD'],
    'Resolving Blocks HEAD'
  ).trim();
  if (commit !== contract.source.commit) {
    fail(`Blocks HEAD ${commit} does not match pinned commit ${contract.source.commit}.`);
  }
  const status = run(
    'git',
    ['-C', blocksRepo, 'status', '--porcelain=v1', '--untracked-files=all'],
    'Checking Blocks worktree'
  ).trim();
  if (status.length > 0) {
    fail(`Blocks worktree must be clean before regeneration:\n${status}`);
  }
}

export function parseArguments(arguments_) {
  let blocksRepo = null;
  let check = false;
  let refreshPackageResolutions = false;
  let help = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--blocks-repo') {
      if (blocksRepo !== null) fail('--blocks-repo may be provided only once.');
      const value = arguments_[index + 1];
      if (!value || value.startsWith('-')) fail('--blocks-repo requires a path.');
      blocksRepo = path.resolve(value);
      index += 1;
    } else if (argument === '--check') {
      if (check) fail('--check may be provided only once.');
      check = true;
    } else if (argument === '--refresh-package-resolutions') {
      if (refreshPackageResolutions) {
        fail('--refresh-package-resolutions may be provided only once.');
      }
      refreshPackageResolutions = true;
    } else if (argument === '--help' || argument === '-h') {
      help = true;
    } else {
      fail(`Unknown argument ${argument}.`);
    }
  }
  if (!help && blocksRepo === null) fail('--blocks-repo is required.');
  return { blocksRepo, check, refreshPackageResolutions, help };
}

function usage() {
  return [
    'Regenerate the derived Constructive Blocks skill contract transactionally.',
    '',
    'Usage:',
    '  node sync-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks',
    '  node sync-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks --check',
    '  node sync-blocks-contract.mjs --blocks-repo /absolute/path/to/blocks --refresh-package-resolutions',
    '',
    'The Blocks checkout must be clean and exactly match the already-pinned commit.',
    'Without --check, generated catalog, plans, content, package snapshot, and',
    'attestations replace their checked-in counterparts only after staged validation.',
    '--refresh-package-resolutions explicitly queries npm latest releases; without it,',
    'the existing exact package records are preserved and only their sourceCommit changes.'
  ].join('\n');
}

function inspectorArguments(blocksRepo, arguments_) {
  return ['--dir', blocksRepo, '--silent', 'console-kit:inspect', '--no-build'].concat(arguments_);
}

function expectedRootNames(contract) {
  return contract.source.attestations.installPlans.map((record) => record.item);
}

function exactArray(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} changed. Update the checker invariants before regenerating this contract.`);
  }
}

function registryContent(blocksRepo, contract, plans, catalogItems) {
  const cache = new Map();
  const records = collectAttestedRegistrySources(plans, catalogItems).map((source) => {
    let item = cache.get(source.registryItem);
    if (!item) {
      item = readJson(
        path.join(blocksRepo, 'apps', 'registry', 'public', 'r', `${source.registryItem}.json`),
        `built registry item ${source.registryItem}`
      );
      cache.set(source.registryItem, item);
    }
    const matches = Array.isArray(item.files)
      ? item.files.filter((candidate) => candidate.path === source.path)
      : [];
    if (matches.length !== 1 || matches[0].type !== source.type || typeof matches[0].content !== 'string') {
      fail(`Built registry item is missing exact source ${source.registryItem}/${source.path}.`);
    }
    return {
      registryItem: source.registryItem,
      path: source.path,
      type: source.type,
      contentSha256: sha256Text(matches[0].content)
    };
  });
  return {
    schemaVersion: 1,
    kind: 'constructive.blocks-registry-content',
    sourceCommit: contract.source.commit,
    recordCount: records.length,
    records
  };
}

function preservedPackageResolutions(contract, packageRequirements) {
  const current = readJson(
    path.join(referencesDirectory, 'package-resolutions.v1.json'),
    'current package resolutions'
  );
  const byName = new Map(current.records?.map((record) => [record.name, record]));
  const records = packageRequirements.map(({ name, exactVersion }) => {
    const record = byName.get(name);
    if (!record) {
      fail(`Package ${name} is newly required. Re-run with --refresh-package-resolutions to resolve it.`);
    }
    if (exactVersion !== null && record.version !== exactVersion) {
      fail(
        `Package ${name} must resolve ${exactVersion}. Re-run with --refresh-package-resolutions.`
      );
    }
    return record;
  });
  return {
    schemaVersion: 1,
    kind: 'constructive.blocks-package-resolutions',
    sourceCommit: contract.source.commit,
    registry: registryOrigin,
    recordCount: records.length,
    records
  };
}

async function refreshedPackageResolutions(contract, packageRequirements) {
  const records = [];
  for (const { name, exactVersion } of packageRequirements) {
    const response = await fetch(`${registryOrigin}/${encodeURIComponent(name)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' }
    });
    if (!response.ok) fail(`npm registry request failed for ${name} with HTTP ${response.status}.`);
    const packument = await response.json();
    const version = exactVersion ?? packument?.['dist-tags']?.latest;
    const release = typeof version === 'string' ? packument?.versions?.[version] : null;
    const integrity = release?.dist?.integrity;
    const resolved = release?.dist?.tarball;
    if (
      typeof version !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) ||
      typeof resolved !== 'string'
    ) {
      fail(`npm registry metadata is incomplete for ${name}.`);
    }
    const url = new URL(resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') {
      fail(`npm registry returned a non-canonical tarball URL for ${name}.`);
    }
    records.push({ name, version, integrity, resolved });
  }
  return {
    schemaVersion: 1,
    kind: 'constructive.blocks-package-resolutions',
    sourceCommit: contract.source.commit,
    registry: registryOrigin,
    recordCount: records.length,
    records
  };
}

function stagedContract(blocksRepo, stageReferences, contract, liveItems, plans, catalog, content, packages) {
  const result = structuredClone(contract);
  result.items = liveItems;
  result.registry.catalog.itemCount = catalog.itemCount;
  if (!result.registry.catalog.projection.includes('meta.constructive')) {
    result.registry.catalog.projection.push('meta.constructive');
  }
  for (const packageRecord of result.release.packages) {
    const manifestPath = path.join(blocksRepo, packageRecord.manifestSource.path);
    const manifest = readJson(manifestPath, `package manifest ${packageRecord.name}`);
    if (manifest.name !== packageRecord.name || typeof manifest.version !== 'string') {
      fail(`Package manifest identity drifted for ${packageRecord.name}.`);
    }
    packageRecord.version = manifest.version;
    packageRecord.manifestSource.sha256 = sha256File(manifestPath);
  }
  const attestations = result.source.attestations;
  attestations.aggregateRegistry.sha256 = sha256File(
    path.join(blocksRepo, attestations.aggregateRegistry.path)
  );
  for (const record of attestations.canonicalFiles) {
    record.sha256 = sha256File(path.join(blocksRepo, record.path));
  }
  refreshCanonicalSourceLinks(
    result,
    new Map(attestations.canonicalFiles.map((record) => [record.path, record.sha256]))
  );

  writeJson(path.join(stageReferences, 'registry-catalog.v1.json'), catalog, 0);
  writeJson(path.join(stageReferences, 'registry-content.v1.json'), content);
  writeJson(path.join(stageReferences, 'package-resolutions.v1.json'), packages);
  for (const record of attestations.installPlans) {
    writeJson(
      path.join(stageReferences, record.path.slice('references/'.length)),
      plans.get(record.item),
      0
    );
  }

  attestations.registryCatalog.sha256 = sha256File(
    path.join(stageReferences, attestations.registryCatalog.path.slice('references/'.length))
  );
  attestations.registryContent.sha256 = sha256File(
    path.join(stageReferences, attestations.registryContent.path.slice('references/'.length))
  );
  attestations.packageResolutions.sha256 = sha256File(
    path.join(stageReferences, attestations.packageResolutions.path.slice('references/'.length))
  );
  for (const record of attestations.installPlans) {
    record.sha256 = sha256File(path.join(stageReferences, record.path.slice('references/'.length)));
  }
  writeJson(path.join(stageReferences, 'install-roots.v1.json'), result);
  return result;
}

function replacementPaths(contract) {
  return [
    'references/registry-catalog.v1.json',
    'references/registry-content.v1.json',
    'references/package-resolutions.v1.json'
  ].concat(contract.source.attestations.installPlans.map((record) => record.path))
    .concat(['references/install-roots.v1.json']);
}

export function changedReplacementPaths(stageRoot, contract, currentRoot = skillDirectory) {
  return replacementPaths(contract).filter((relativePath) => {
    const staged = path.join(stageRoot, relativePath);
    const current = path.join(currentRoot, relativePath);
    return (
      !fs.existsSync(staged) ||
      !fs.existsSync(current) ||
      !fs.readFileSync(staged).equals(fs.readFileSync(current))
    );
  });
}

function replaceTransaction(stageRoot, contract, validate) {
  const transactionRoot = fs.mkdtempSync(path.join(skillDirectory, '.sync-blocks-contract-'));
  const backupRoot = path.join(transactionRoot, 'backup');
  const replaced = [];
  try {
    for (const relativePath of replacementPaths(contract)) {
      const target = path.join(skillDirectory, relativePath);
      const staged = path.join(stageRoot, relativePath);
      const backup = path.join(backupRoot, relativePath);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(target, backup);
      try {
        fs.renameSync(staged, target);
      } catch (cause) {
        fs.renameSync(backup, target);
        throw cause;
      }
      replaced.push({ target, backup });
    }
    validate();
  } catch (cause) {
    for (const replacement of replaced.reverse()) {
      if (fs.existsSync(replacement.target)) fs.rmSync(replacement.target);
      if (fs.existsSync(replacement.backup)) fs.renameSync(replacement.backup, replacement.target);
    }
    throw cause;
  } finally {
    fs.rmSync(transactionRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const contract = readJson(contractPath, 'install-roots contract');
  assertSnapshot(contract);
  assertCleanPinnedCheckout(contract, options.blocksRepo);
  run('pnpm', ['--dir', options.blocksRepo, 'build:registry'], 'Building Blocks registry', {
    inherit: true
  });

  const liveList = parseJsonCommand(
    'pnpm',
    inspectorArguments(options.blocksRepo, ['--list']),
    'Reading Blocks install roots'
  );
  const normalizedLiveItems = liveList.items.map((item) => ({
    ...item,
    installCommand: pinInspectorInstallCommand(item.installCommand, item.name)
  }));
  const rootNames = expectedRootNames(contract);
  exactArray(
    normalizedLiveItems.map((item) => item.name).sort(),
    rootNames.slice().sort(),
    'Inspectable Blocks install-root set'
  );

  const plans = new Map();
  for (const name of rootNames) {
    const plan = parseJsonCommand(
      'pnpm',
      inspectorArguments(options.blocksRepo, ['--item', name, '--compact']),
      `Reading Blocks install plan ${name}`
    );
    plan.install.command = pinInspectorInstallCommand(plan.install.command, name);
    plans.set(name, plan);
  }
  const aggregateRegistry = readJson(
    path.join(options.blocksRepo, 'apps', 'registry', 'registry.json'),
    'built aggregate registry'
  );
  const catalog = projectRegistryCatalog(aggregateRegistry);
  const content = registryContent(options.blocksRepo, contract, plans, catalog.items);
  const packageNames = collectAttestedExternalPackages(contract, plans, catalog.items);
  const packages = options.refreshPackageResolutions
    ? await refreshedPackageResolutions(contract, packageNames)
    : preservedPackageResolutions(contract, packageNames);

  const stageRoot = fs.mkdtempSync(path.join(skillDirectory, '.sync-blocks-contract-stage-'));
  try {
    const stageReferences = path.join(stageRoot, 'references');
    fs.cpSync(referencesDirectory, stageReferences, { recursive: true });
    const nextContract = stagedContract(
      options.blocksRepo,
      stageReferences,
      contract,
      normalizedLiveItems,
      plans,
      catalog,
      content,
      packages
    );
    assertSnapshot(nextContract);
    const stagedArtifacts = validateSkillArtifacts(nextContract, stageRoot);
    assertBlocksSource(nextContract, stagedArtifacts, options.blocksRepo);

    if (options.check) {
      const drifted = changedReplacementPaths(stageRoot, contract);
      if (drifted.length > 0) {
        fail(`Blocks contract regeneration drifted:\n${drifted.join('\n')}`);
      }
      process.stdout.write(
        `Blocks contract regeneration is current: ${catalog.itemCount} registry items, ${plans.size} install plans, ${content.recordCount} content attestations.\n`
      );
      return;
    }
    replaceTransaction(stageRoot, contract, () => {
      const written = readJson(contractPath, 'written install-roots contract');
      assertSnapshot(written);
      const writtenArtifacts = validateSkillArtifacts(written);
      assertBlocksSource(written, writtenArtifacts, options.blocksRepo);
    });
    process.stdout.write(
      `Regenerated Blocks contract: ${catalog.itemCount} registry items, ${plans.size} install plans, ${content.recordCount} content attestations.\n`
    );
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  });
}
