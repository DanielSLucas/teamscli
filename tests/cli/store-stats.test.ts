import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { aConversation } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

test('store stats reports counts for the selected account', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const db = openDatabase(databasePath(home, 'work'));
  upsertConversations(db, [aConversation({ id: 'c1' }), aConversation({ id: 'c2' })]);
  db.close();

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'store', 'stats']);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(JSON.parse(run.stdout).data, {
    account: 'work',
    path: databasePath(home, 'work'),
    conversations: 2,
    messages: 0,
    people: 0,
    oldestMessageAt: null,
    newestMessageAt: null,
  });
});

test('store stats without local data is not_found and creates nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const run = await runTestCli(['--store', home, 'store', 'stats']);
  assert.equal(run.code, 5);
  assert.match(run.stderr, /teamscli sync/);
  assert.equal(existsSync(join(home, 'accounts')), false);
});
