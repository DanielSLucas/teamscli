import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aConversation, aMessage } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertCheckpoint } from '../../src/store/checkpoints.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertMessages } from '../../src/store/messages.ts';
import { shortId } from '../../src/store/resolve.ts';

function seedStore(home: string): void {
  const db = openDatabase(databasePath(home, 'default'));
  upsertConversations(db, [
    aConversation({ id: 'chat-synced', title: 'Synced chat' }),
    aConversation({ id: 'chat-unsynced', title: 'Unsynced chat' }),
  ]);
  upsertMessages(db, [
    aMessage({ conversationId: 'chat-synced', id: 'm1', createdAt: '2026-01-01T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-synced', id: 'm2', createdAt: '2026-01-02T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-unsynced', id: 'm3', createdAt: '2026-01-03T00:00:00.000Z' }),
  ]);
  upsertCheckpoint(db, {
    scope: 'chat-synced',
    syncState: 'https://chat.example.test/sync-state',
    backwardLink: null,
    oldestMessageAt: '2026-01-01T00:00:00.000Z',
    historyComplete: true,
    updatedAt: '2026-01-04T00:00:00.000Z',
  });
  db.close();
}

test('history coverage lists synchronized conversations and filters a requested chat', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  seedStore(store);

  const all = await runTestCli(['--store', store, '--json', 'history', 'coverage']);
  assert.equal(all.code, 0, all.stderr);
  const [synced] = JSON.parse(all.stdout).data;
  assert.deepEqual(synced, {
    id: 'chat-synced',
    title: 'Synced chat',
    messages: 2,
    oldestMessageAt: '2026-01-01T00:00:00.000Z',
    newestMessageAt: '2026-01-02T00:00:00.000Z',
    historyComplete: true,
    syncStatePresent: true,
  });
  assert.doesNotMatch(all.stdout, /sync-state/);

  const one = await runTestCli(['--store', store, '--json', 'history', 'coverage', '--chat', 'Unsynced chat']);
  assert.equal(one.code, 0, one.stderr);
  assert.deepEqual(JSON.parse(one.stdout).data, [{
    id: 'chat-unsynced',
    title: 'Unsynced chat',
    messages: 1,
    oldestMessageAt: '2026-01-03T00:00:00.000Z',
    newestMessageAt: '2026-01-03T00:00:00.000Z',
    historyComplete: false,
    syncStatePresent: false,
  }]);

  const byShortId = await runTestCli(['--store', store, '--json', 'history', 'coverage', '--chat', shortId('chat-synced')]);
  assert.equal(byShortId.code, 0, byShortId.stderr);
  assert.equal(JSON.parse(byShortId.stdout).data[0].id, 'chat-synced');
});
