#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  STAGES,
  failJournalStage,
  initializeJournal,
  invalidateJournalStages,
  loadJournal,
  mutateJournal,
  passJournalStage,
  startJournalStage,
  summarizeJournal
} from './lib/harness-journal.mjs';

function usage() {
  return [
    'Usage:',
    '  node <builder-skill>/scripts/harness-state.mjs init --validation <validation.json> --state <state.json>',
    '  node <builder-skill>/scripts/harness-state.mjs start --state <state.json> --stage <stage>',
    '  node <builder-skill>/scripts/harness-state.mjs pass --state <state.json> --stage <stage> --evidence <type=relative/path> [--evidence ...]',
    '  node <builder-skill>/scripts/harness-state.mjs fail --state <state.json> --stage <stage> --reason <reason> --evidence <type=relative/path> [--evidence ...]',
    '  node <builder-skill>/scripts/harness-state.mjs invalidate --state <state.json> --stage <stage> --reason <reason>',
    '  node <builder-skill>/scripts/harness-state.mjs status --state <state.json>',
    '',
    'Stages: ' + STAGES.join(', '),
    'Evidence paths are safe workspace-relative files and are stored with type, SHA-256, and size.'
  ].join('\n');
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(usage() + '\n');
    process.exit(0);
  }
  const parsed = {
    command: argv[0],
    validation: '',
    state: '',
    stage: '',
    reason: '',
    evidence: []
  };
  const commandOptions = new Map([
    ['init', new Set(['--validation', '--state'])],
    ['start', new Set(['--state', '--stage'])],
    ['pass', new Set(['--state', '--stage', '--evidence'])],
    ['fail', new Set(['--state', '--stage', '--reason', '--evidence'])],
    ['invalidate', new Set(['--state', '--stage', '--reason'])],
    ['status', new Set(['--state'])]
  ]);
  const allowedOptions = commandOptions.get(parsed.command);
  if (!allowedOptions) {
    throw new Error('Unknown command: ' + parsed.command + '.');
  }
  const valuedOptions = new Set(['--validation', '--state', '--stage', '--reason', '--evidence']);
  const seenScalarOptions = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (!valuedOptions.has(option)) {
      throw new Error('Unknown option: ' + option + '.');
    }
    if (!allowedOptions.has(option)) {
      throw new Error(option + ' is not valid for the ' + parsed.command + ' command.');
    }
    if (option !== '--evidence' && seenScalarOptions.has(option)) {
      throw new Error(option + ' may be provided only once.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for ' + option + '.');
    }
    if (option === '--evidence') {
      parsed.evidence.push(value);
    } else {
      seenScalarOptions.add(option);
      parsed[option.slice(2)] = value;
    }
    index += 1;
  }
  return parsed;
}

function requireValue(value, option) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(option + ' is required.');
  }
}

function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
    requireValue(parsed.state, '--state');
    const statePath = path.resolve(parsed.state);
    if (parsed.command === 'init') {
      requireValue(parsed.validation, '--validation');
      const state = initializeJournal(path.resolve(parsed.validation), statePath);
      process.stdout.write(JSON.stringify(summarizeJournal(state), null, 2) + '\n');
      return;
    }
    if (parsed.command === 'status') {
      const state = loadJournal(statePath);
      process.stdout.write(JSON.stringify(summarizeJournal(state), null, 2) + '\n');
      return;
    }
    requireValue(parsed.stage, '--stage');
    if (parsed.command === 'start') {
      mutateJournal(statePath, (state) => {
        startJournalStage(state, parsed.stage);
      });
    } else if (parsed.command === 'pass') {
      mutateJournal(statePath, (state) => {
        passJournalStage(state, parsed.stage, parsed.evidence);
      });
    } else if (parsed.command === 'fail') {
      requireValue(parsed.reason, '--reason');
      mutateJournal(statePath, (state) => {
        failJournalStage(state, parsed.stage, parsed.reason, parsed.evidence);
      });
    } else if (parsed.command === 'invalidate') {
      requireValue(parsed.reason, '--reason');
      mutateJournal(statePath, (state) => {
        invalidateJournalStages(state, parsed.stage, parsed.reason);
      }, { allowWorkspaceDrift: true });
    } else {
      throw new Error('Unknown command: ' + parsed.command + '.');
    }
    const state = loadJournal(statePath);
    process.stdout.write(JSON.stringify(summarizeJournal(state), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n\n' + usage() + '\n');
    process.exit(2);
  }
}

main();
