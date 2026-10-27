import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertMessages } from '../../src/store/messages.ts';
import { shortId } from '../../src/store/resolve.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

function seededStore(): string {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const db = openDatabase(databasePath(home, 'default'));
  upsertConversations(db, [aConversation({ id: 'chat-1', kind: 'channel', title: 'Example channel' })]);
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
  const db = openDatabase(databasePath(home, 'default'));
  upsertMessages(db, [aMessage({
    conversationId: 'chat-1', id: 'edited', text: 'Updated text', content: '<p>Updated text</p>',
    editedAt: '2026-01-02T00:00:00.000Z', version: 2, createdAt: '2026-01-02T00:00:00.000Z',
  })]);
  db.close();
  const run = await runTestCli(['--store', home, 'messages', 'list', '--chat', 'Example channel', '--limit', '3', '--after', '2026-01-01T00:00:00.000Z']);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /Alice Example  Updated text \(edited\)/);
  assert.match(run.stdout, /Alice Example  Reply text/);
  assert.match(run.stdout, /Alice Example  \[deleted\]/);
  assert.doesNotMatch(run.stdout, /2026-01-02T00:00:00\.000Z/);
  assert.doesNotMatch(run.stdout, /<p>|<\/p>/);
});

test('messages show returns the full JSON model and not_found for a missing message', async () => {
  const home = seededStore();
  const shown = await runTestCli(['--store', home, '--json', 'messages', 'show', 'edited', '--chat', shortId('chat-1')]);
  assert.equal(shown.code, 0, shown.stdout);
  assert.deepEqual(JSON.parse(shown.stdout).data, aMessage({ conversationId: 'chat-1', id: 'edited', text: 'Updated text', editedAt: '2026-01-02T00:00:00.000Z', version: 2, createdAt: '2026-01-02T00:00:00.000Z' }));

  const missing = await runTestCli(['--store', home, '--json', 'messages', 'show', 'unknown', '--chat', shortId('chat-1')]);
  assert.equal(missing.code, 5);
  assert.equal(JSON.parse(missing.stdout).error.code, 'not_found');
});

test('messages show renders a compact plain-text detail and reports missing arguments in order', async () => {
  const home = seededStore();
  const db = openDatabase(databasePath(home, 'default'));
  upsertMessages(db, [aMessage({
    conversationId: 'chat-1', id: 'edited', content: '<p>Updated text</p>', text: 'Updated text',
    editedAt: '2026-01-02T00:00:00.000Z', version: 2, createdAt: '2026-01-02T00:00:00.000Z',
  })]);
  db.close();

  const shown = await runTestCli(['--store', home, 'messages', 'show', 'edited', '--chat', 'Example channel']);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stdout, /id\s+edited/);
  assert.match(shown.stdout, /text\s+Updated text \(edited\)/);
  assert.doesNotMatch(shown.stdout, /<p>|<\/p>/);

  for (const [args, expected] of [
    [['messages', 'show'], 'Missing the message ID: pass it after the command.'],
    [['messages', 'show', 'edited'], 'Missing --chat: the chat containing the message (id, short id or name).'],
    [['messages', 'list'], 'Missing --chat: the chat to list (id, short id or name).'],
    [['messages', 'thread'], 'Missing the root message ID: pass it after the command.'],
    [['messages', 'thread', 'root'], 'Missing --channel: the channel to show (id, short id or name).'],
    [['messages', 'search'], 'Missing the search query: pass it after the options.'],
  ] as const) {
    const run = await runTestCli(['--store', home, ...args]);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(run.stderr, 'teamscli: ' + expected + '\n');
  }
});

test('messages thread lists the channel root and its replies in chronological order', async () => {
  const home = seededStore();
  const run = await runTestCli(['--store', home, '--json', 'messages', 'thread', 'root', '--channel', 'Example channel']);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(JSON.parse(run.stdout).data.map((message: { id: string }) => message.id), ['root', 'reply']);
});

test('messages thread uses the plain-text message renderer', async () => {
  const home = seededStore();
  const db = openDatabase(databasePath(home, 'default'));
  upsertMessages(db, [
    aMessage({ conversationId: 'chat-1', id: 'root', text: 'Root text', content: '<p>Root text</p>', createdAt: '2026-01-01T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'reply', parentId: 'root', text: 'Reply text', content: '<p>Reply text</p>', createdAt: '2026-01-03T00:00:00.000Z' }),
  ]);
  db.close();

  const run = await runTestCli(['--store', home, 'messages', 'thread', 'root', '--channel', 'Example channel']);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /Alice Example  Root text/);
  assert.match(run.stdout, /Alice Example  Reply text/);
  assert.doesNotMatch(run.stdout, /<p>|<\/p>/);
});
