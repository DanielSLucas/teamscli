import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationMember, Person } from '../../src/models.ts';
import { setMembers, listMembers, upsertPeople } from '../../src/store/people.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { aConversation } from '../helpers/builders.ts';

const aPerson = (overrides: Partial<Person> = {}): Person => ({ id: 'person-1', displayName: 'Alice Example', email: 'alice@example.com', ...overrides });
const aMember = (overrides: Partial<ConversationMember> = {}): ConversationMember => ({
  conversationId: 'chat-1', personId: 'person-1', role: null, ...overrides,
});

test('people upsert keeps known values when incoming values are null', () => {
  const db = openDatabase(':memory:');
  upsertPeople(db, [aPerson()]);
  upsertPeople(db, [aPerson({ displayName: null, email: null })]);

  upsertPeople(db, [aPerson({ id: 'unknown', displayName: null, email: null })]);
  const rows = db.prepare('SELECT id, display_name, email FROM people ORDER BY id').all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: 'person-1', display_name: 'Alice Example', email: 'alice@example.com' },
    { id: 'unknown', display_name: null, email: null },
  ]);
  db.close();
});

test('setMembers replaces the conversation set and listMembers includes names', () => {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: 'chat-1' })]);
  upsertPeople(db, [aPerson(), aPerson({ id: 'person-2', displayName: 'Bob Example' }), aPerson({ id: 'person-3', displayName: 'Carol Example' })]);
  setMembers(db, 'chat-1', [aMember(), aMember({ personId: 'person-2', role: 'Admin' })]);
  setMembers(db, 'chat-1', [aMember({ personId: 'person-2', role: 'User' }), aMember({ personId: 'person-3' })]);

  assert.deepEqual(listMembers(db, 'chat-1'), [
    { conversationId: 'chat-1', personId: 'person-2', role: 'User', displayName: 'Bob Example' },
    { conversationId: 'chat-1', personId: 'person-3', role: null, displayName: 'Carol Example' },
  ]);
  db.close();
});
