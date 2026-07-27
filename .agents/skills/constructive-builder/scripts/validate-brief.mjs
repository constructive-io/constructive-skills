#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  ensureSafeWorkspaceDirectory,
  validateBriefFiles,
  writeJsonAtomic
} from './lib/brief-contract.mjs';

function usage() {
  return [
    'Usage:',
    '  node <builder-skill>/scripts/validate-brief.mjs <app-brief.json> --blocks-source <pinned-blocks-worktree> [options]',
    '',
    'Options:',
    '  --tenant <tenant-database.json>    Provide the tenant descriptor; it must match tenant.descriptorPath.',
    '  --blocks-source <directory>        Required while the Blocks release is branch-only.',
    '  --output <validation.json>         Atomically write the journal-ready validation report.',
    '',
    'The command never provisions or repairs a tenant backend.'
  ].join('\n');
}

function parseArguments(argv) {
  const parsed = {
    briefPath: '',
    tenantPath: '',
    blocksSource: '',
    outputPath: ''
  };
  const options = new Map([
    ['--tenant', 'tenantPath'],
    ['--blocks-source', 'blocksSource'],
    ['--output', 'outputPath']
  ]);
  const seenOptions = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(usage() + '\n');
      process.exit(0);
    }
    if (options.has(argument)) {
      if (seenOptions.has(argument)) {
        throw new Error(argument + ' may be provided only once.');
      }
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for ' + argument + '.');
      }
      seenOptions.add(argument);
      parsed[options.get(argument)] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error('Unknown option: ' + argument + '.');
    }
    if (parsed.briefPath) {
      throw new Error('Only one app brief path may be provided.');
    }
    parsed.briefPath = argument;
  }
  if (!parsed.briefPath) {
    throw new Error('An app brief path is required.');
  }
  return parsed;
}

function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error.message + '\n\n' + usage() + '\n');
    process.exit(2);
  }
  const report = validateBriefFiles(parsed);
  if (parsed.outputPath) {
    const outputPath = path.resolve(parsed.outputPath);
    try {
      if (!report.resolved?.workspacePath) {
        throw new Error('A valid workspace is required before writing a validation report.');
      }
      ensureSafeWorkspaceDirectory(
        report.resolved.workspacePath,
        path.dirname(outputPath),
        '.constructive/harness'
      );
      writeJsonAtomic(outputPath, report);
    } catch (error) {
      process.stderr.write(error.message + '\n');
      process.exit(2);
    }
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

main();
