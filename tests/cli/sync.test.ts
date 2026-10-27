import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAD_TOKEN_URL, AUTHZ_ROUTE, fakeJwt, tokenResponse } from '../helpers/fake-auth.ts';
import { runTestCli } from '../helpers/cli.ts';
import { fakeFetch, type FakeRoute } from '../helpers/fake-fetch.ts';

const env = { TEAMSCLI_SECRET_STORE: 'file' };
const chatService = 'https://chat.example.test';
const csaService = 'https://teams.microsoft.com/api/csa/test';

function signedInHome() {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  mkdirSync(join(home, 'accounts', 'work'), { recursive: true });
  writeFileSync(join(home, 'accounts', 'work', 'refresh_token'), 'fake-refresh-token', { mode: 0o600 });
  return home;
}

const tokenRoutes: FakeRoute = {
  method: 'POST', url: AAD_TOKEN_URL, times: 2,
  json: tokenResponse(fakeJwt({}), 'fake-rotated-refresh-token'),
};

test('sync --help documents --days', async () => {
  const run = await runTestCli(['sync', '--help']);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /--days/);
});

test('sync writes a stable JSON summary and applies --days to the backfill window', async (t) => {
  const home = signedInHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const listUrl = `${chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`;
  const csaUrl = `${csaService}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`;
  const messageUrl = new RegExp(`^${chatService}/v1/users/ME/conversations/chat-cli/messages\\?view=msnp24Equivalent&pageSize=200&startTime=\\d+$`);
  const { fetch, calls } = fakeFetch([
    tokenRoutes,
    AUTHZ_ROUTE,
    { url: listUrl, json: { conversations: [{ id: 'chat-cli', threadProperties: { productThreadType: 'OneToOneChat' } }], _metadata: { syncState: 'https://chat.example.test/conversations/sync' } } },
    { url: csaUrl, json: { teams: [], chats: [], metadata: { hasMoreChats: false, isPartialData: false } } },
    { url: messageUrl, json: { messages: [], _metadata: { syncState: 'https://chat.example.test/messages/sync' } } },
  ]);
  const start = Date.now();
  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'sync', '--days', '14'], { env, fetch });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { ok: true, data: { conversations: 1, conversationsSynced: 1, messages: 0, warnings: [] } });
  assert.match(run.stderr, /Sync 1\/1: chat-cli; 0 messages saved/);
  const requestUrl = calls.find(({ url }) => messageUrl.test(url))?.url;
  assert.ok(requestUrl);
  const startTime = Number(new URL(requestUrl).searchParams.get('startTime'));
  assert.ok(startTime >= start - 14 * 24 * 60 * 60 * 1000 - 1000);
  assert.ok(startTime <= start - 14 * 24 * 60 * 60 * 1000 + 1000);
});

test('sync aborts with auth_required exit code 3 on a Teams 401', async (t) => {
  const home = signedInHome();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const { fetch } = fakeFetch([
    tokenRoutes,
    AUTHZ_ROUTE,
    { url: `${chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`, status: 401 },
  ]);
  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'sync'], { env, fetch });
  assert.equal(run.code, 3);
  assert.equal(JSON.parse(run.stdout).error.code, 'auth_required');
});

test('sync is blocked by --read-only before it reaches fetch', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let calls = 0;
  const run = await runTestCli(['--store', home, '--read-only', '--json', 'sync'], {
    fetch: async () => { calls++; throw new Error('fetch must not run'); },
  });
  assert.equal(run.code, 4);
  assert.equal(JSON.parse(run.stdout).error.code, 'read_only');
  assert.equal(calls, 0);
});
