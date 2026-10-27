import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertMessages } from '../../src/store/messages.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

function seededStore(): string {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const db = openDatabase(databasePath(home, 'default'));
  upsertConversations(db, [aConversation({ id: 'chat-1', kind: 'channel' })]);
  upsertMessages(db, [
    aMessage({ conversationId: 'chat-1', id: 'root', text: 'Root text', createdAt: '2026-01-01T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'edited', text: 'Updated text', editedAt: '2026-01-02T00:00:00.000Z', version: 2, createdAt: '2026-01-02T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'reply', parentId: 'root', text: 'Reply text', createdAt: '2026-01-03T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'deleted', content: '', text: '', deletedAt: '2026-01-04T00:00:00.000Z', version: 2, createdAt: '2026-01-04T00:00:00.000Z' }),
  ]);
  db.close();
  return home;
}

test('messages list reads offline, applies filters and renders hour, sender and text', async () => {
  const home = seededStore();
  const run = await runTestCli(['--store', home, 'messages', 'list', '--chat', 'chat-1', '--limit', '3', '--after', '2026-01-01T00:00:00.000Z']);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stdout, [
    '2026-01-02T00:00:00.000Z  Alice Example  Updated text (edited)',
    '2026-01-03T00:00:00.000Z  Alice Example  Reply text',
    '2026-01-04T00:00:00.000Z  Alice Example  [deleted]',
    '',
  ].join('\n'));
});

test('messages show returns the full JSON model and not_found for a missing message', async () => {
  const home = seededStore();
  const shown = await runTestCli(['--store', home, '--json', 'messages', 'show', 'edited', '--chat', 'chat-1']);
  assert.equal(shown.code, 0, shown.stdout);
  assert.deepEqual(JSON.parse(shown.stdout).data, aMessage({ conversationId: 'chat-1', id: 'edited', text: 'Updated text', editedAt: '2026-01-02T00:00:00.000Z', version: 2, createdAt: '2026-01-02T00:00:00.000Z' }));

  const missing = await runTestCli(['--store', home, '--json', 'messages', 'show', 'unknown', '--chat', 'chat-1']);
  assert.equal(missing.code, 5);
  assert.equal(JSON.parse(missing.stdout).error.code, 'not_found');
});

test('messages thread lists the channel root and its replies in chronological order', async () => {
  const home = seededStore();
  const run = await runTestCli(['--store', home, '--json', 'messages', 'thread', 'root', '--channel', 'chat-1']);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(JSON.parse(run.stdout).data.map((message: { id: string }) => message.id), ['root', 'reply']);
});
