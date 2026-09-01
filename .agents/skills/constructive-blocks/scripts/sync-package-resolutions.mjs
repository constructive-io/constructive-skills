#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseNpmPackageRequirement } from './check-blocks-contract.mjs';

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
  const requirements = new Map();
  for (const attestation of contract.source.attestations.installPlans) {
    const plan = readJson(
      path.join(skillDirectory, attestation.path),
      'install plan ' + attestation.item
    );
    for (const dependency of plan.composition.npmDependencies) {
      const requirement = parseNpmPackageRequirement(dependency.name);
      if (firstParty.has(requirement.name)) continue;
      if (requirement.requested !== null && requirement.exactVersion === null) {
        fail(
          'External package ' + requirement.name +
          ' uses unsupported non-exact requirement ' + requirement.requested + '.'
        );
      }
      const versions = requirements.get(requirement.name) ?? new Set();
      versions.add(requirement.exactVersion);
      requirements.set(requirement.name, versions);
    }
  }
  return Array.from(requirements, ([name, versions]) => {
    const exactVersions = Array.from(versions).filter((version) => version !== null);
    if (new Set(exactVersions).size > 1) {
      fail('Package ' + name + ' has conflicting exact requirements.');
    }
    return { name, exactVersion: exactVersions[0] ?? null };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

async function resolutionForPackage(name, exactVersion) {
  const response = await fetch(registryOrigin + '/' + encodeURIComponent(name), {
    headers: { accept: 'application/vnd.npm.install-v1+json' }
  });
  if (!response.ok) {
    fail('npm registry request failed for ' + name + ' with HTTP ' + response.status + '.');
  }
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
const requirements = expectedExternalPackages(contract);
const records = [];
for (const { name, exactVersion } of requirements) {
  records.push(await resolutionForPackage(name, exactVersion));
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
