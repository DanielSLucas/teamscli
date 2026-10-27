import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getConversation, listConversations, upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { aConversation } from '../helpers/builders.ts';

test('upsert inserts, then updates in place', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'c1', title: 'Old' })]);
  upsertConversations(db, [aConversation({ id: 'c1', title: 'New' })]);
  assert.equal(listConversations(db).length, 1);
  assert.equal(getConversation(db, 'c1')?.title, 'New');
  assert.equal(getConversation(db, 'missing'), null);
});

test('upsert keeps a known team when the update does not carry one', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'ch', kind: 'channel', teamId: 'team-1' })]);
  upsertConversations(db, [aConversation({ id: 'ch', kind: 'channel', teamId: null })]);
  assert.equal(getConversation(db, 'ch')?.teamId, 'team-1');
});

test('list filters by kind and team, most recent first, silent ones last', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [
    aConversation({ id: 'old', lastMessageAt: '2026-01-01T00:00:00.000Z' }),
    aConversation({ id: 'silent', lastMessageAt: null }),
    aConversation({ id: 'new', lastMessageAt: '2026-02-01T00:00:00.000Z' }),
    aConversation({ id: 'ch', kind: 'channel', teamId: 'team-1' }),
  ]);
  assert.deepEqual(listConversations(db, { kind: 'group' }).map((c) => c.id), ['new', 'old', 'silent']);
  assert.deepEqual(listConversations(db, { teamId: 'team-1' }).map((c) => c.id), ['ch']);
});
