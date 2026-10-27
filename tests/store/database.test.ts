import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { migrations, openDatabase, transaction } from '../../src/store/database.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import type { Message } from '../../src/models.ts';

const tempPath = () => join(mkdtempSync(join(tmpdir(), 'teamscli-')), 'accounts', 'test', 'messages.db');

// Messages have no repository yet; tests write rows directly to exercise the schema.
function insertMessage(db: DatabaseSync, m: Message) {
  db.prepare(`
    INSERT INTO messages (conversation_id, id, parent_id, sender_id, sender_name, type, content, text,
      created_at, edited_at, deleted_at, version, client_message_id)
    VALUES (:conversationId, :id, :parentId, :senderId, :senderName, :type, :content, :text,
      :createdAt, :editedAt, :deletedAt, :version, :clientMessageId)
  `).run({ ...m });
}

const search = (db: DatabaseSync, query: string) =>
  db.prepare('SELECT m.id FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ? ORDER BY m.id').all(query).map((row) => row.id);

test('migrations are numbered 1..N', () => {
  assert.deepEqual(migrations().map((m) => m.version), migrations().map((_, i) => i + 1));
});

test('a writable open creates the file, applies migrations once and uses WAL', () => {
  const path = tempPath();
  const latest = migrations().at(-1)?.version;
  for (let i = 0; i < 2; i++) {
    const db = openDatabase(path);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, latest);
    assert.equal(db.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
    db.close();
  }
});

test('a read-only open never creates nor writes', () => {
  assert.throws(() => openDatabase(tempPath(), { readOnly: true }), { code: 'not_found' });

  const path = tempPath();
  openDatabase(path).close();
  const db = openDatabase(path, { readOnly: true });
  assert.throws(() => upsertConversations(db, [aConversation()]));
  db.close();
});

test('a database from a newer version is refused', () => {
  const path = tempPath();
  const db = openDatabase(path);
  db.exec('PRAGMA user_version = 999');
  db.close();
  assert.throws(() => openDatabase(path), { code: 'usage' });
});

test('transaction rolls back on error', () => {
  const db = openDatabase(':memory:');
  assert.throws(() =>
    transaction(db, () => {
      db.prepare("INSERT INTO teams (id, name) VALUES ('t1', 'Team')").run();
      throw new Error('boom');
    }),
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM teams').get()?.n, 0);
});

test('message keys are per conversation and require a known conversation', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'c1' }), aConversation({ id: 'c2' })]);
  insertMessage(db, aMessage({ conversationId: 'c1', id: '100' }));
  insertMessage(db, aMessage({ conversationId: 'c2', id: '100' }));
  assert.throws(() => insertMessage(db, aMessage({ conversationId: 'c1', id: '100' })), /UNIQUE/);
  assert.throws(() => insertMessage(db, aMessage({ conversationId: 'missing', id: '1' })), /FOREIGN KEY/);
});

test('full-text index ignores accents and follows edits and deletes', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'c1' })]);
  insertMessage(db, aMessage({ conversationId: 'c1', id: '1', text: 'Fechamento mênsal amanhã' }));
  insertMessage(db, aMessage({ conversationId: 'c1', id: '2', text: 'Outro assunto' }));
  assert.deepEqual(search(db, 'mensal'), ['1']);

  db.prepare("UPDATE messages SET text = 'Fechamento adiado' WHERE id = '1'").run();
  assert.deepEqual(search(db, 'mensal'), []);
  assert.deepEqual(search(db, 'adiado'), ['1']);

  db.prepare("DELETE FROM messages WHERE id = '1'").run();
  assert.deepEqual(search(db, 'adiado'), []);
});
