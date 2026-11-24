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
