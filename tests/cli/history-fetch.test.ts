import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAD_TOKEN_URL, AUTHZ_ROUTE, fakeJwt, TEST_OID, TEST_TID, tokenResponse } from '../helpers/fake-auth.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';
import { aConversation } from '../helpers/builders.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertCheckpoint } from '../../src/store/checkpoints.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { runTestCli } from '../helpers/cli.ts';

const env = { TEAMSCLI_SECRET_STORE: 'file' };

test('history fetch help documents the cutoff and page limit', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const run = await runTestCli(['--store', store, 'history', 'fetch', '--help']);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /--before ISO/);
  assert.match(run.stdout, /--pages N/);
});

test('history fetch is blocked by --read-only before using the session or fetch', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  let calls = 0;
  const run = await runTestCli(['--store', store, '--read-only', '--json', 'history', 'fetch', '--chat', 'chat-test'], {
    fetch: async () => { calls++; throw new Error('fetch must not run'); },
  });

  assert.equal(run.code, 4);
  assert.equal(JSON.parse(run.stdout).error.code, 'read_only');
  assert.equal(calls, 0);
});

test('history fetch names the missing chat and describes chat lookup', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const run = await runTestCli(['--store', store, 'history', 'fetch']);
  assert.equal(run.code, 2);
  assert.equal(run.stderr, 'teamscli: Missing --chat: the chat to fetch older messages for (id, short id or name).\n');
});

test('history fetch rejects a chat that is not in the local store before using the session', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  let calls = 0;
  const run = await runTestCli(['--store', store, '--json', 'history', 'fetch', '--chat', 'chat-missing'], {
    fetch: async () => { calls++; throw new Error('fetch must not run'); },
  });

  assert.equal(run.code, 5);
  assert.equal(JSON.parse(run.stdout).error.code, 'not_found');
  assert.equal(calls, 0);
});

test('history fetch accepts a conversation name', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'accounts', 'work'), { recursive: true });
  writeFileSync(join(home, 'accounts', 'work', 'refresh_token'), 'synthetic-refresh-value', { mode: 0o600 });
  const id = 'chat-history';
  const db = openDatabase(databasePath(home, 'work'));
  upsertConversations(db, [aConversation({ id, title: 'Older chat' })]);
  upsertCheckpoint(db, {
    scope: id, syncState: null, backwardLink: null, oldestMessageAt: null,
    historyComplete: true, updatedAt: '2026-01-01T00:00:00.000Z',
  });
  db.close();
  const { fetch } = fakeFetch([
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(fakeJwt({ oid: TEST_OID, tid: TEST_TID }), 'synthetic-rotated-value') },
    AUTHZ_ROUTE,
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'history', 'fetch', '--chat', 'Older chat'], { env, fetch });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).data, { conversationId: id, pages: 0, messages: 0, historyComplete: true });
});
