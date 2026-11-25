import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./devnet-check.sh', import.meta.url));

test('authenticated checks stop before HTTP when the platform token is missing', (t) => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'constructive-headless-'));
  t.after(() => rmSync(fixtureDir, { recursive: true, force: true }));

  const curlMarker = join(fixtureDir, 'curl-called');
  writeFileSync(
    join(fixtureDir, 'curl'),
    '#!/usr/bin/env bash\nprintf called > "$CURL_MARKER"\n',
    { mode: 0o700 },
  );

  for (const command of ['whoami', 'databases']) {
    const result = spawnSync('bash', [script, command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureDir}${delimiter}${process.env.PATH}`,
        CONSTRUCTIVE_DEVNET_PLATFORM_TOKEN: '',
        CURL_MARKER: curlMarker,
      },
    });

    assert.ifError(result.error);
    assert.equal(existsSync(curlMarker), false, `${command} started curl without a token`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Inject the devnet platform credential/);
  }
});

test('endpoint overrides in the environment take precedence over devnet.env.example', (t) => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'constructive-headless-override-'));
  t.after(() => rmSync(fixtureDir, { recursive: true, force: true }));

  writeFileSync(
    join(fixtureDir, 'curl'),
    [
      '#!/usr/bin/env bash',
      'endpoint="${!#}"',
      'if [[ "$endpoint" != "$EXPECTED_ENDPOINT" ]]; then',
      '  printf "unexpected endpoint: %s\\n" "$endpoint" >&2',
      '  exit 9',
      'fi',
      'printf \'%s\\n\' \'{"data":{"databases":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}\'',
    ].join('\n'),
    { mode: 0o700 },
  );

  const customEndpoint = 'https://custom-api.example/graphql';
  const result = spawnSync('bash', [script, 'databases'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixtureDir}${delimiter}${process.env.PATH}`,
      CONSTRUCTIVE_DEVNET_API_ENDPOINT: customEndpoint,
      CONSTRUCTIVE_DEVNET_PLATFORM_TOKEN: 'test-token',
      EXPECTED_ENDPOINT: customEndpoint,
    },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    nodes: [],
    pageInfo: { hasNextPage: false, endCursor: null },
  });
});
