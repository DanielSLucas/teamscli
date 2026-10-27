import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError } from '../../src/errors.ts';
import { runDoctor } from '../../src/auth/doctor.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';

test('an unsupported Node version skips all dependent checks', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-doctor-'));
  const messages: string[] = [];
  try {
    await assert.rejects(
      runDoctor({
        account: 'work',
        home,
        nodeVersion: '23.0.0',
        fetch: fakeFetch([]).fetch,
        createSecretStore: () => {
          throw new Error('must not inspect secrets');
        },
        log: (message) => messages.push(message),
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, 'usage');
        assert.deepEqual((error.details as { checks: { name: string; ok: boolean }[] }).checks.map(({ name, ok }) => [name, ok]), [
          ['node', false], ['store', false], ['secretStore', false], ['login', false], ['chatService', false], ['csa', false],
        ]);
        return true;
      },
    );
    assert.equal(messages.length, 6);
    assert.match(messages[0] ?? '', /^FAIL node:/);
    assert.match(messages[1] ?? '', /^SKIP store:/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
