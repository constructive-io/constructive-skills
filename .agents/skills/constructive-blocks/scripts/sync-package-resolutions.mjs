#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');
const referencesDirectory = path.join(skillDirectory, 'references');
const contractPath = path.join(referencesDirectory, 'install-roots.v1.json');
const outputPath = path.join(referencesDirectory, 'package-resolutions.v1.json');
const registryOrigin = 'https://registry.npmjs.org';

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

function expectedExternalPackages(contract) {
  const firstParty = new Set(contract.release.packages.map((entry) => entry.name));
  const names = new Set();
  for (const attestation of contract.source.attestations.installPlans) {
    const plan = readJson(
      path.join(skillDirectory, attestation.path),
      'install plan ' + attestation.item
    );
    for (const dependency of plan.composition.npmDependencies) {
      if (!firstParty.has(dependency.name)) {
        names.add(dependency.name);
      }
    }
  }
  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

async function resolutionForPackage(name) {
  const response = await fetch(registryOrigin + '/' + encodeURIComponent(name), {
    headers: { accept: 'application/vnd.npm.install-v1+json' }
  });
  if (!response.ok) {
    fail('npm registry request failed for ' + name + ' with HTTP ' + response.status + '.');
  }
  const packument = await response.json();
  const version = packument?.['dist-tags']?.latest;
  const release = typeof version === 'string' ? packument?.versions?.[version] : null;
  const integrity = release?.dist?.integrity;
  const resolved = release?.dist?.tarball;
  if (
    typeof version !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) ||
    typeof resolved !== 'string'
  ) {
    fail('npm registry metadata is incomplete for ' + name + '.');
  }
  let url;
  try {
    url = new URL(resolved);
  } catch {
    fail('npm registry returned an invalid tarball URL for ' + name + '.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') {
    fail('npm registry returned a non-canonical tarball URL for ' + name + '.');
  }
  return { name, version, integrity, resolved };
}

const contract = readJson(contractPath, 'install-roots contract');
const names = expectedExternalPackages(contract);
const records = [];
for (const name of names) {
  records.push(await resolutionForPackage(name));
}
const snapshot = {
  schemaVersion: 1,
  kind: 'constructive.blocks-package-resolutions',
  sourceCommit: contract.source.commit,
  registry: registryOrigin,
  recordCount: records.length,
  records
};
fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
const digest = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
process.stdout.write(
  'Wrote ' + records.length + ' external package resolutions with SHA-256 ' + digest + '.\n'
);
