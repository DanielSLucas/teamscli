import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationMember, Person } from '../../src/models.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { setMembers, upsertPeople } from '../../src/store/people.ts';
import { upsertMessages } from '../../src/store/messages.ts';
import { shortId } from '../../src/store/resolve.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
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
  upsertPeople(db, [...people, { id: 'self-user', displayName: 'Me Example', email: null }]);
  const members: ConversationMember[] = people.map((person) => ({ conversationId: 'new-group', personId: person.id, role: null }));
  setMembers(db, 'new-group', members);
  setMembers(db, 'chat-1', [
    { conversationId: 'chat-1', personId: 'self-user', role: null },
    { conversationId: 'chat-1', personId: 'person-1', role: null },
  ]);
  db.close();
}

test('chats list omits system by default, orders by activity, and summarizes untitled members', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedChats(home);

  const run = await runTestCli(['--store', home, '--read-only', 'chats', 'list']);
  assert.equal(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /System stream/);
  assert.ok(run.stdout.indexOf(shortId('new-group')) < run.stdout.indexOf(shortId('chat-1')));
  assert.ok(run.stdout.indexOf(shortId('chat-1')) < run.stdout.indexOf(shortId('old-group')));
  assert.doesNotMatch(run.stdout, /new-group|chat-1|old-group/);
  assert.match(run.stdout, /Alice Example, Bob Example, Carol Example \+2/);
  assert.match(run.stdout, /Alice Example, Me Example/);
});

test('chats list returns Conversation plus members as JSON and supports type and limit', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedChats(home);

  const run = await runTestCli(['--store', home, '--json', 'chats', 'list', '--type', 'group', '--limit', '1']);
  assert.equal(run.code, 0, run.stdout);
  const [chat] = JSON.parse(run.stdout).data;
  assert.equal(chat.id, 'new-group');
  assert.equal(chat.shortId, shortId(chat.id));
  assert.equal(chat.title, null);
  assert.equal(chat.kind, 'group');
  assert.equal(chat.members.length, 5);
  assert.equal(chat.members[0].displayName, 'Alice Example');

  const system = await runTestCli(['--store', home, '--json', 'chats', 'list', '--type', 'system']);
  assert.deepEqual(JSON.parse(system.stdout).data.map(({ id }: { id: string }) => id), ['system-1']);
});

test('chats list hides the self member from a one-on-one human title when identity is available', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedChats(home);
  const accountDir = join(home, 'accounts', 'default');
  mkdirSync(accountDir, { recursive: true });
  writeFileSync(join(accountDir, 'account.json'), JSON.stringify({ userId: 'self-user', tenantId: null, region: null, displayName: 'Me Example' }), { mode: 0o600 });

  const human = await runTestCli(['--store', home, 'chats', 'list', '--type', 'chat']);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /Alice Example/);
  assert.doesNotMatch(human.stdout, /Me Example/);

  const json = await runTestCli(['--store', home, '--json', 'chats', 'list', '--type', 'chat']);
  const [chat] = JSON.parse(json.stdout).data;
  assert.equal(chat.title, null);
  assert.equal(chat.members.length, 2);
  assert.equal(chat.shortId, shortId(chat.id));
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

test('chats list --unread keeps only conversations with unread messages and reports the count', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedChats(home);
  const db = openDatabase(databasePath(home, 'default'));
  upsertConversations(db, [aConversation({ id: 'chat-1', kind: 'chat', title: null, readUpTo: '2026-01-15T00:00:00.000Z' })]);
  upsertMessages(db, [
    aMessage({ conversationId: 'chat-1', id: 'a', createdAt: '2026-01-15T00:00:01.000Z' }),
    aMessage({ conversationId: 'chat-1', id: 'b', createdAt: '2026-01-15T00:00:02.000Z' }),
  ]);
  db.close();

  const json = await runTestCli(['--store', home, '--read-only', '--json', 'chats', 'list', '--unread']);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).data.map(({ id, unreadCount, readUpTo }: { id: string; unreadCount: number; readUpTo: string }) => ({ id, unreadCount, readUpTo })), [
    { id: 'chat-1', unreadCount: 2, readUpTo: '2026-01-15T00:00:00.000Z' },
  ]);

  const all = await runTestCli(['--store', home, '--json', 'chats', 'list']);
  assert.equal(JSON.parse(all.stdout).data.find(({ id }: { id: string }) => id === 'new-group').unreadCount, 0);

  const human = await runTestCli(['--store', home, 'chats', 'list', '--unread']);
  assert.match(human.stdout, /unread/);
  assert.match(human.stdout, new RegExp(`${shortId('chat-1')}.*\\b2\\b`));
});
