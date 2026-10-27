import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAD_TOKEN_URL, AUTHZ_ROUTE, fakeJwt, TEST_OID, TEST_TID, tokenResponse } from '../helpers/fake-auth.ts';
import { runTestCli } from '../helpers/cli.ts';
import { fakeFetch, type FakeRoute } from '../helpers/fake-fetch.ts';

const env = { TEAMSCLI_SECRET_STORE: 'file' };
const chatUrl = 'https://chat.example.test/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=1';
const csaUrl = 'https://teams.microsoft.com/api/csa/test/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true';

function tempStore(withLogin: boolean): string {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-doctor-'));
  const account = join(home, 'accounts', 'work');
  mkdirSync(account, { recursive: true });
  if (withLogin) writeFileSync(join(account, 'refresh_token'), 'synthetic-refresh-token', { mode: 0o600 });
  return home;
}

function loggedInRoutes(chatStatus = 200): FakeRoute[] {
  return [
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(fakeJwt({ oid: TEST_OID, tid: TEST_TID }), 'synthetic-rotated-token') },
    AUTHZ_ROUTE,
    { url: chatUrl, status: chatStatus, json: {} },
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse('synthetic-csa-access', 'synthetic-rotated-token') },
    { url: csaUrl, json: {} },
  ];
}

test('doctor reports all checks and validates both Teams services', async () => {
  const home = tempStore(true);
  try {
    const { fetch, calls } = fakeFetch(loggedInRoutes());
    const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'doctor'], { env, fetch });
    assert.equal(run.code, 0, run.stderr);
    const checks = JSON.parse(run.stdout).data as { name: string; ok: boolean; detail: string }[];
    assert.deepEqual(checks.map(({ name, ok }) => [name, ok]), [
      ['node', true], ['store', true], ['secretStore', true], ['login', true], ['chatService', true], ['csa', true],
    ]);
    assert.match(checks[3]?.detail ?? '', new RegExp(`userId: 8:orgid:${TEST_OID}; region: test`));
    assert.deepEqual(calls.filter((call) => call.method === 'GET').map((call) => call.url), [chatUrl, csaUrl]);
    assert.deepEqual(run.stderr.trim().split('\n').map((line) => line.split(':')[0]?.replace(/^OK /, '')), [
      'node', 'store', 'secretStore', 'login', 'chatService', 'csa',
    ]);
    assert.doesNotMatch(run.stdout + run.stderr, /synthetic-(?:refresh|rotated)-token|skypetoken=/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor reports a missing login and skips login and service checks', async () => {
  const home = tempStore(false);
  try {
    const { fetch, calls } = fakeFetch([]);
    const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'doctor'], { env, fetch });
    assert.equal(run.code, 3);
    const checks = JSON.parse(run.stdout).error.details.checks as { name: string; ok: boolean; detail: string }[];
    assert.deepEqual(checks.map(({ name, ok }) => [name, ok]), [
      ['node', true], ['store', true], ['secretStore', false], ['login', false], ['chatService', false], ['csa', false],
    ]);
    assert.match(checks[2]?.detail ?? '', /no saved login/);
    assert.ok(checks.slice(3).every((check) => check.detail.startsWith('skipped:')));
    assert.equal(calls.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor reports a chatService 401 while still checking csa', async () => {
  const home = tempStore(true);
  try {
    const { fetch } = fakeFetch(loggedInRoutes(401));
    const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'doctor'], { env, fetch });
    assert.equal(run.code, 3);
    const checks = JSON.parse(run.stdout).error.details.checks as { name: string; ok: boolean; detail: string }[];
    assert.equal(checks[4]?.ok, false);
    assert.equal(checks[5]?.ok, true);
    assert.doesNotMatch(run.stdout + run.stderr, /\?view=|\?isPrefetch=/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
