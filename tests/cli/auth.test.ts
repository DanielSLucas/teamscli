import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAD_DEVICECODE_URL, AAD_TOKEN_URL, AUTHZ_ROUTE, fakeJwt, TEST_OID, TEST_TID, tokenResponse } from '../helpers/fake-auth.ts';
import { runTestCli } from '../helpers/cli.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';

const SPACES_TOKEN = fakeJwt({ oid: TEST_OID, tid: TEST_TID });
const env = { TEAMSCLI_SECRET_STORE: 'file' };

function signIn() {
  return fakeFetch([
    { method: 'POST', url: AAD_DEVICECODE_URL, json: { device_code: 'test-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://example.test/devicelogin', expires_in: 900, interval: 0 } },
    { method: 'POST', url: AAD_TOKEN_URL, status: 400, json: { error: 'authorization_pending' }, times: 1 },
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(SPACES_TOKEN, 'login-refresh') },
    AUTHZ_ROUTE,
  ]);
}

test('auth shows the code on stderr, checks Teams and saves the login', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const { fetch } = signIn();
  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'auth'], { env, fetch });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).data, { name: 'work', userId: `8:orgid:${TEST_OID}`, tenantId: TEST_TID, region: 'test', secretStore: 'file' });
  assert.match(run.stderr, /https:\/\/example\.test\/devicelogin.*ABCD-EFGH/);
  for (const secret of ['login-refresh', SPACES_TOKEN, 'test-skypetoken', 'test-device-code']) {
    assert.ok(!run.stdout.includes(secret) && !run.stderr.includes(secret), 'output leaks a secret');
  }
  assert.equal(readFileSync(join(home, 'accounts', 'work', 'refresh_token'), 'utf8'), 'login-refresh');
});

test('auth saves nothing when Teams rejects the login', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const { fetch } = fakeFetch([
    { method: 'POST', url: AAD_DEVICECODE_URL, json: { device_code: 'd', user_code: 'ABCD-EFGH', verification_uri: 'https://example.test/devicelogin', interval: 0 } },
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(SPACES_TOKEN, 'login-refresh') },
    { method: 'POST', url: AUTHZ_ROUTE.url, status: 401 },
  ]);
  const run = await runTestCli(['--store', home, 'auth'], { env, fetch });
  assert.equal(run.code, 3);
  assert.equal(existsSync(join(home, 'accounts', 'default', 'refresh_token')), false);
});

test('auth is refused under --read-only', async () => {
  const run = await runTestCli(['--read-only', 'auth'], { env });
  assert.equal(run.code, 4);
});
