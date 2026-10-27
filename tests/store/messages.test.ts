import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/store/database.ts';
import { getMessage, listMessages, listThread, upsertMessages } from '../../src/store/messages.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';

test('upsert is idempotent and an older version cannot regress a message', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'chat-1' })]);
  const current = aMessage({ conversationId: 'chat-1', id: 'm1', text: 'Edited', version: 2 });
  upsertMessages(db, [current, current]);
  upsertMessages(db, [aMessage({ conversationId: 'chat-1', id: 'm1', text: 'Old', version: 1 })]);

  assert.equal(db.prepare('SELECT count(*) AS count FROM messages').get()?.count, 1);
  assert.equal(getMessage(db, 'chat-1', 'm1')?.text, 'Edited');
  assert.equal(getMessage(db, 'missing', 'm1'), null);
});

test('upsert updates the FTS index on edits and stores soft deletes', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'chat-1' })]);
  upsertMessages(db, [aMessage({ conversationId: 'chat-1', id: 'm1', text: 'Initial phrase', senderName: 'Alice Example', version: 1 })]);
  upsertMessages(db, [aMessage({ conversationId: 'chat-1', id: 'm1', content: 'Changed', text: 'Changed phrase', senderName: null, editedAt: '2026-01-02T00:00:00.000Z', version: 2 })]);

  const search = (term: string) => db.prepare('SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?').all(term);
  assert.equal(search('Initial').length, 0);
  assert.equal(search('Changed').length, 1);
  assert.equal(getMessage(db, 'chat-1', 'm1')?.senderName, 'Alice Example');

  upsertMessages(db, [aMessage({ conversationId: 'chat-1', id: 'm1', content: '', text: '', senderName: null, editedAt: null, deletedAt: '2026-01-03T00:00:00.000Z', version: 3 })]);
  assert.equal(getMessage(db, 'chat-1', 'm1')?.content, '');
  const deleted = getMessage(db, 'chat-1', 'm1');
  assert.equal(deleted?.senderName, 'Alice Example');
  assert.equal(deleted?.editedAt, '2026-01-02T00:00:00.000Z');
  assert.equal(deleted?.deletedAt, '2026-01-03T00:00:00.000Z');
});

test('upsert rejects an unknown conversation through the foreign key', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => upsertMessages(db, [aMessage({ conversationId: 'missing' })]), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM conversations').get()?.count, 0);
});

test('list returns the newest matching page in chronological order and thread includes root and replies', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'chat-1' })]);
  upsertMessages(db, [
    aMessage({ conversationId: 'chat-1', id: 'm3', createdAt: '2026-01-03T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'reply-late', parentId: 'root', createdAt: '2026-01-04T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'm1', createdAt: '2026-01-01T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'root', createdAt: '2026-01-02T00:00:00.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'reply-early', parentId: 'root', createdAt: '2026-01-03T12:00:00.000Z' }),
  ]);

  assert.deepEqual(listMessages(db, { conversationId: 'chat-1', limit: 2 }).map((message) => message.id), ['reply-early', 'reply-late']);
  assert.deepEqual(listMessages(db, { conversationId: 'chat-1', limit: 5, after: '2026-01-02T00:00:00.000Z', before: '2026-01-04T00:00:00.000Z' }).map((message) => message.id), ['m3', 'reply-early']);
  assert.deepEqual(listThread(db, 'chat-1', 'root').map((message) => message.id), ['root', 'reply-early', 'reply-late']);
});
