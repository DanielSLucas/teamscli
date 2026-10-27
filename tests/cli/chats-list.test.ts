import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationMember, Person } from '../../src/models.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { setMembers, upsertPeople } from '../../src/store/people.ts';
import { aConversation } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

function seedChats(home: string): void {
  const db = openDatabase(databasePath(home, 'default'));
  upsertConversations(db, [
    aConversation({ id: 'new-group', kind: 'group', title: null, lastMessageAt: '2026-02-01T00:00:00.000Z' }),
    aConversation({ id: 'old-group', kind: 'group', title: 'Project', lastMessageAt: '2026-01-01T00:00:00.000Z' }),
    aConversation({ id: 'chat-1', kind: 'chat', title: null, lastMessageAt: '2026-01-15T00:00:00.000Z' }),
    aConversation({ id: 'system-1', kind: 'system', title: 'System stream', lastMessageAt: '2026-03-01T00:00:00.000Z' }),
  ]);
  const people: Person[] = ['Alice Example', 'Bob Example', 'Carol Example', 'Dana Example', 'Erin Example']
    .map((displayName, index) => ({ id: `person-${index + 1}`, displayName, email: null }));
  upsertPeople(db, people);
  const members: ConversationMember[] = people.map((person) => ({ conversationId: 'new-group', personId: person.id, role: null }));
  setMembers(db, 'new-group', members);
  db.close();
}

test('chats list omits system by default, orders by activity, and summarizes untitled members', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedChats(home);

  const run = await runTestCli(['--store', home, '--read-only', 'chats', 'list']);
  assert.equal(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /System stream/);
  assert.ok(run.stdout.indexOf('new-group') < run.stdout.indexOf('chat-1'));
  assert.ok(run.stdout.indexOf('chat-1') < run.stdout.indexOf('old-group'));
  assert.match(run.stdout, /Alice Example, Bob Example, Carol Example \+2/);
});

test('chats list returns Conversation plus members as JSON and supports type and limit', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedChats(home);

  const run = await runTestCli(['--store', home, '--json', 'chats', 'list', '--type', 'group', '--limit', '1']);
  assert.equal(run.code, 0, run.stdout);
  const [chat] = JSON.parse(run.stdout).data;
  assert.equal(chat.id, 'new-group');
  assert.equal(chat.title, null);
  assert.equal(chat.kind, 'group');
  assert.equal(chat.members.length, 5);
  assert.equal(chat.members[0].displayName, 'Alice Example');

  const system = await runTestCli(['--store', home, '--json', 'chats', 'list', '--type', 'system']);
  assert.deepEqual(JSON.parse(system.stdout).data.map(({ id }: { id: string }) => id), ['system-1']);
});

test('chats list rejects invalid type and limit and reports missing local data', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  const badType = await runTestCli(['--store', home, 'chats', 'list', '--type', 'unknown']);
  assert.equal(badType.code, 2);
  const badLimit = await runTestCli(['--store', home, 'chats', 'list', '--limit', '0']);
  assert.equal(badLimit.code, 2);
  const missing = await runTestCli(['--store', home, 'chats', 'list']);
  assert.equal(missing.code, 5);
  assert.match(missing.stderr, /teamscli sync/);
});
