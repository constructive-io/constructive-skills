#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateBriefFiles } from './lib/brief-contract.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, '..');

function usage() {
  return [
    'Usage:',
    '  node <builder-skill>/scripts/check.mjs --blocks-source <pinned-blocks-worktree>',
    '',
    'Runs logic/security tests and validates the canonical brief through the branch-only Blocks source preflight.'
  ].join('\n');
}

function parseArguments(argv) {
  let blocksSource = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(usage() + '\n');
      process.exit(0);
    }
    if (argument !== '--blocks-source') {
      throw new Error('Unknown option: ' + argument + '.');
    }
    if (blocksSource) {
      throw new Error('--blocks-source may be provided only once.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('--blocks-source requires a path.');
    }
    blocksSource = path.resolve(value);
    index += 1;
  }
  if (!blocksSource) {
    throw new Error('--blocks-source is required while Blocks is branch-only.');
  }
  return blocksSource;
}

function run(command, argumentsList) {
  execFileSync(command, argumentsList, {
    cwd: skillDirectory,
    encoding: 'utf8',
    stdio: 'inherit'
  });
}

function main() {
  let blocksSource;
  try {
    blocksSource = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n\n' + usage() + '\n');
    process.exit(2);
  }
  run(process.execPath, ['--test', 'scripts/validate-brief.test.mjs', 'scripts/harness-state.test.mjs']);
  const report = validateBriefFiles({
    briefPath: path.join(skillDirectory, 'fixtures', 'app-brief.template.json'),
    catalogPath: path.resolve(skillDirectory, '..', 'constructive-blocks', 'references', 'install-roots.v1.json'),
    tenantPath: '',
    blocksSource
  });
  if (!report.ok) {
    throw new Error('Canonical brief validation failed:\n' + report.errors.join('\n'));
  }
  const blocksSourceReport = report.inputs.blocksSource;
  process.stdout.write(
    'Pinned Blocks source preflight passed at ' + blocksSourceReport.headCommit + '.\n' +
    'Builder check OK: ' + report.resolved.installRoots.length + ' install root' +
    (report.resolved.installRoots.length === 1 ? '' : 's') + ', ' +
    report.resolved.acceptance.scenarios.length + ' executable scenarios, ' +
    report.resolved.runtimeLimitations.length + ' open source limitation' +
    (report.resolved.runtimeLimitations.length === 1 ? '' : 's') + '.\n'
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exit(1);
}
