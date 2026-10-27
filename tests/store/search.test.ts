import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { searchMessages } from '../../src/store/search.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import type { Message } from '../../src/models.ts';

function insertMessage(db: DatabaseSync, message: Message): void {
  db.prepare(`
    INSERT INTO messages (conversation_id, id, parent_id, sender_id, sender_name, type, content, text,
      created_at, edited_at, deleted_at, version, client_message_id)
    VALUES (:conversationId, :id, :parentId, :senderId, :senderName, :type, :content, :text,
      :createdAt, :editedAt, :deletedAt, :version, :clientMessageId)
  `).run({ ...message });
}

test('search ignores accents and case and requires all quoted terms', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation()]);
  insertMessage(db, aMessage({ id: '1', text: 'Fechamento Mensal amanhã' }));
  insertMessage(db, aMessage({ id: '2', text: 'Resumo mênsal do fechamento' }));
  insertMessage(db, aMessage({ id: '3', text: 'Fechamento semanal' }));

  assert.deepEqual(searchMessages(db, 'FECHAMENTO mensal', { limit: 20 }).map(({ message }) => message.id), ['1', '2']);
  assert.deepEqual(searchMessages(db, 'mensal fechamento semanal', { limit: 20 }), []);
  db.close();
});

test('query punctuation, quotes, parentheses and FTS operators stay ordinary terms', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation()]);
  insertMessage(db, aMessage({ id: '1', text: 'quoted OR (deadline) today' }));

  assert.deepEqual(searchMessages(db, '"quoted" OR (deadline)', { limit: 20 }).map(({ message }) => message.id), ['1']);
  assert.deepEqual(searchMessages(db, '!!!', { limit: 20 }), []);
  db.close();
});

test('filters by conversation, sender id or case-insensitive sender name, time, and excludes deleted rows', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'c1' }), aConversation({ id: 'c2' })]);
  insertMessage(db, aMessage({ id: '1', conversationId: 'c1', text: 'monthly report', createdAt: '2026-01-01T00:00:00.000Z' }));
  insertMessage(db, aMessage({ id: '2', conversationId: 'c2', text: 'monthly report', senderId: 'sender-2', senderName: 'Bob Example', createdAt: '2026-01-02T00:00:00.000Z' }));
  insertMessage(db, aMessage({ id: '3', conversationId: 'c2', text: 'monthly report', deletedAt: '2026-01-03T00:00:00.000Z' }));
  insertMessage(db, aMessage({ id: '4', conversationId: 'c2', text: 'monthly report', senderId: 'sender-3', senderName: 'ÁLICE Example', createdAt: '2026-01-02T00:00:00.000Z' }));

  const options = { conversationId: 'c2', from: 'BOB', after: '2026-01-01T00:00:00.000Z', before: '2026-01-03T00:00:00.000Z', limit: 20 };
  assert.deepEqual(searchMessages(db, 'monthly report', options).map(({ message }) => message.id), ['2']);
  assert.deepEqual(searchMessages(db, 'monthly report', { ...options, from: 'sender-2' }).map(({ message }) => message.id), ['2']);
  assert.deepEqual(searchMessages(db, 'monthly report', { ...options, from: 'álice' }).map(({ message }) => message.id), ['4']);
  assert.deepEqual(searchMessages(db, 'monthly report', { ...options, conversationId: 'c1' }), []);
  db.close();
});

test('orders matching results by relevance then recency and applies the limit', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation()]);
  insertMessage(db, aMessage({ id: '1', text: 'budget budget budget', createdAt: '2026-01-03T00:00:00.000Z' }));
  insertMessage(db, aMessage({ id: '2', text: 'budget', createdAt: '2026-01-01T00:00:00.000Z' }));
  insertMessage(db, aMessage({ id: '3', text: 'budget', createdAt: '2026-01-02T00:00:00.000Z' }));

  const results = searchMessages(db, 'budget', { limit: 2 });
  assert.deepEqual(results.map(({ message }) => message.id), ['1', '3']);
  assert.ok(results[0]!.rank < results[1]!.rank);
  assert.match(results[0]!.snippet, /\[budget\]/);
  db.close();
});
