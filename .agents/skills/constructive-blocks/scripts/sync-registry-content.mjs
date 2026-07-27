#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');
const referencesDirectory = path.join(skillDirectory, 'references');
const snapshotPath = path.join(referencesDirectory, 'install-roots.v1.json');
const outputPath = path.join(referencesDirectory, 'registry-content.v1.json');

function fail(message) {
  throw new Error(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail('Unable to read ' + label + ': ' + error.message);
  }
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function blocksRepositoryArgument(argumentsList) {
  let blocksRepository = null;
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] !== '--blocks-repo') {
      fail('Unknown argument ' + argumentsList[index] + '.');
    }
    if (blocksRepository) {
      fail('--blocks-repo may be provided only once.');
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('-')) {
      fail('--blocks-repo requires a path.');
    }
    blocksRepository = path.resolve(value);
    index += 1;
  }
  if (!blocksRepository) {
    fail('--blocks-repo is required.');
  }
  return blocksRepository;
}

function sourceKey(registryItem, sourcePath) {
  return registryItem + '\0' + sourcePath;
}

const blocksRepository = blocksRepositoryArgument(process.argv.slice(2));
const contract = readJson(snapshotPath, 'install-roots contract');
const actualCommit = execFileSync(
  'git',
  ['-C', blocksRepository, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' }
).trim();
if (actualCommit !== contract.source.commit) {
  fail('Blocks HEAD must equal the pinned source commit ' + contract.source.commit + '.');
}
const worktreeStatus = execFileSync(
  'git',
  ['-C', blocksRepository, 'status', '--porcelain=v1', '--untracked-files=all'],
  { encoding: 'utf8' }
).trim();
if (worktreeStatus) {
  fail('Blocks worktree must be clean before regenerating registry content attestations.');
}
execFileSync(
  'pnpm',
  ['--dir', blocksRepository, 'build:registry'],
  { stdio: 'inherit' }
);

const plannedSources = new Map();
for (const attestation of contract.source.attestations.installPlans) {
  const plan = readJson(
    path.join(skillDirectory, attestation.path),
    'install plan ' + attestation.item
  );
  for (const file of plan.composition.files) {
    for (const source of file.sources) {
      const key = sourceKey(source.registryItem, source.path);
      const existing = plannedSources.get(key);
      if (existing && existing.type !== file.type) {
        fail('Planned registry source type conflict for ' + source.registryItem + '/' + source.path + '.');
      }
      if (!existing) {
        plannedSources.set(key, {
          registryItem: source.registryItem,
          path: source.path,
          type: file.type
        });
      }
    }
  }
}

const itemCache = new Map();
const records = [];
const planned = Array.from(plannedSources.values());
planned.sort((left, right) => {
  const leftKey = left.registryItem + '/' + left.path;
  const rightKey = right.registryItem + '/' + right.path;
  return leftKey.localeCompare(rightKey);
});
for (const source of planned) {
  let item = itemCache.get(source.registryItem);
  if (!item) {
    item = readJson(
      path.join(
        blocksRepository,
        'apps',
        'registry',
        'public',
        'r',
        source.registryItem + '.json'
      ),
      'built registry item ' + source.registryItem
    );
    itemCache.set(source.registryItem, item);
  }
  const matches = Array.isArray(item.files)
    ? item.files.filter((candidate) => candidate.path === source.path)
    : [];
  if (
    matches.length !== 1 ||
    matches[0].type !== source.type ||
    typeof matches[0].content !== 'string'
  ) {
    fail('Built registry item is missing exact source ' + source.registryItem + '/' + source.path + '.');
  }
  records.push({
    registryItem: source.registryItem,
    path: source.path,
    type: source.type,
    contentSha256: sha256Text(matches[0].content)
  });
}

const snapshot = {
  schemaVersion: 1,
  kind: 'constructive.blocks-registry-content',
  sourceCommit: contract.source.commit,
  recordCount: records.length,
  records
};
fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
process.stdout.write('Wrote ' + records.length + ' registry content attestations to ' + outputPath + '.\n');
