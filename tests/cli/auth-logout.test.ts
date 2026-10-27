import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTestCli } from '../helpers/cli.ts';

const env = { TEAMSCLI_SECRET_STORE: 'file' };

test('auth logout removes only the selected account login, and repeats safely', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  for (const account of ['work', 'home']) {
    mkdirSync(join(home, 'accounts', account), { recursive: true });
    writeFileSync(join(home, 'accounts', account, 'refresh_token'), `${account}-refresh`);
  }

  for (let i = 0; i < 2; i++) {
    const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'auth', 'logout'], { env });
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(JSON.parse(run.stdout).data, { name: 'work', signedIn: false });
  }
  assert.equal(existsSync(join(home, 'accounts', 'work', 'refresh_token')), false);
  assert.equal(existsSync(join(home, 'accounts', 'home', 'refresh_token')), true);
  assert.equal((await runTestCli(['--read-only', 'auth', 'logout'], { env })).code, 4);
});
