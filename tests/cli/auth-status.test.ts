import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAD_TOKEN_URL, AUTHZ_ROUTE, fakeJwt, TEST_OID, TEST_TID, tokenResponse } from '../helpers/fake-auth.ts';
import { runTestCli } from '../helpers/cli.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';

const env = { TEAMSCLI_SECRET_STORE: 'file' };

for (const [flags, saved] of [[[], 'rotated-refresh'], [['--read-only'], 'saved-refresh']] as const) {
  test(`auth status ${flags.join(' ') || '(default)'} renews the login and leaves ${saved} saved`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
    mkdirSync(join(home, 'accounts', 'work'), { recursive: true });
    writeFileSync(join(home, 'accounts', 'work', 'refresh_token'), 'saved-refresh', { mode: 0o600 });
    const { fetch } = fakeFetch([{ method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(fakeJwt({ oid: TEST_OID, tid: TEST_TID }), 'rotated-refresh') }, AUTHZ_ROUTE]);

    const run = await runTestCli(['--store', home, '--account', 'work', ...flags, '--json', 'auth', 'status'], { env, fetch });
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(JSON.parse(run.stdout).data, { name: 'work', userId: `8:orgid:${TEST_OID}`, tenantId: TEST_TID, region: 'test', displayName: null, secretStore: 'file' });
    assert.equal(readFileSync(join(home, 'accounts', 'work', 'refresh_token'), 'utf8'), saved);
  });
}

test('auth status without a login exits with auth_required', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const run = await runTestCli(['--store', home, '--json', 'auth', 'status'], { env });
  assert.equal(run.code, 3);
  assert.equal(JSON.parse(run.stdout).error.code, 'auth_required');
});
