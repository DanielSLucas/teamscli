import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '../../src/models.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-search-'));
  try {
    await run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function insertMessage(db: DatabaseSync, message: Message): void {
  db.prepare(`
    INSERT INTO messages (conversation_id, id, parent_id, sender_id, sender_name, type, content, text,
      created_at, edited_at, deleted_at, version, client_message_id)
    VALUES (:conversationId, :id, :parentId, :senderId, :senderName, :type, :content, :text,
      :createdAt, :editedAt, :deletedAt, :version, :clientMessageId)
  `).run({ ...message });
}

function createSearchData(home: string): void {
  const db = openDatabase(databasePath(home, 'default'));
  upsertConversations(db, [aConversation({ id: 'chat-1', title: 'Example chat' })]);
  insertMessage(db, aMessage({
    id: '1',
    conversationId: 'chat-1',
    senderName: 'Alice Example',
    text: 'Fechamento Mensal confirmado',
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  insertMessage(db, aMessage({
    id: '2',
    conversationId: 'chat-1',
    senderName: 'Bob Example',
    text: 'Fechamento Mensal revisado',
    createdAt: '2026-01-02T00:00:00.000Z',
  }));
  db.close();
}

test('messages search runs in-process read-only with filters and stable JSON results', async () => {
  await withHome(async (home) => {
    createSearchData(home);
    const run = await runTestCli([
      '--store', home,
      '--read-only',
      '--json',
      'messages', 'search', 'fechamento mensal',
      '--chat', 'chat-1',
      '--from', 'ALICE',
      '--after', '2025-12-31T23:59:59-00:00',
      '--before', '2026-01-02T00:00:00Z',
      '--limit', '1',
    ]);

    assert.equal(run.code, 0, run.stderr);
    const data = JSON.parse(run.stdout).data;
    assert.equal(data.length, 1);
    assert.equal(data[0].message.id, '1');
    assert.match(data[0].snippet, /\[Fechamento\]/i);
    assert.equal(typeof data[0].rank, 'number');
    assert.equal(Object.keys(data[0]).sort().join(','), 'message,rank,snippet');
  });
});

test('human output shows conversation, time, sender and snippet', async () => {
  await withHome(async (home) => {
    createSearchData(home);
    const run = await runTestCli(['--store', home, 'messages', 'search', 'fechamento', '--from', 'alice']);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /conversation\s+time\s+sender\s+snippet/);
    assert.match(run.stdout, /chat-1/);
    assert.match(run.stdout, /2026-01-01T00:00:00\.000Z/);
    assert.match(run.stdout, /Alice Example/);
    assert.match(run.stdout, /\[Fechamento\]/i);
  });
});

test('empty query and invalid options are usage errors', async () => {
  await withHome(async (home) => {
    const empty = await runTestCli(['--store', home, 'messages', 'search', '']);
    assert.equal(empty.code, 2);
    assert.match(empty.stderr, /search query/i);

    const limit = await runTestCli(['--store', home, 'messages', 'search', 'hello', '--limit', '0']);
    assert.equal(limit.code, 2);
    assert.match(limit.stderr, /positive integer/i);

    const time = await runTestCli(['--store', home, 'messages', 'search', 'hello', '--after', 'not-a-date']);
    assert.equal(time.code, 2);
    assert.match(time.stderr, /ISO 8601/i);
  });
});
