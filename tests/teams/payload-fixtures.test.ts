// Keeps tests/fixtures/teams/ in step with docs/teams-payloads.md: each fixture carries the fields the mapping relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** Raw Teams JSON. */
type Json = any;

const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`../fixtures/teams/${name}.json`, import.meta.url), 'utf8'));
const linkRoot = (link: string) => link.match(/;messageid=(\d+)$/)?.[1];

test('conversation pages carry paging links and one conversation of each kind', () => {
  const page = fixture('conversations-page');
  assert.match(page._metadata.backwardLink, /^https:\/\//);
  assert.match(page._metadata.syncState, /^https:\/\//);
  for (const c of page.conversations) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.threadProperties.threadType, 'string');
    assert.equal(typeof c.threadProperties.productThreadType, 'string');
    assert.equal(typeof c.lastMessage, 'object');
  }
  assert.deepEqual(
    page.conversations.map((c: Json) => c.threadProperties.productThreadType),
    ['OneToOneChat', 'Chat', 'Meeting', 'TeamsStandardChannel', 'TeamsTeam', 'TeamsPrivateChannel', 'StreamOfNotes'],
  );

  const last = fixture('conversations-last-page');
  assert.deepEqual(last.conversations, []);
  assert.equal(last._metadata.backwardLink, undefined);
  assert.match(last._metadata.syncState, /^https:\/\//);
});

test('message page has a root, a reply, an edited, a deleted and a system message', () => {
  const { messages, _metadata } = fixture('messages-page');
  assert.match(_metadata.syncState, /^https:\/\//);
  for (const m of messages) {
    for (const key of ['id', 'messagetype', 'content', 'conversationid', 'conversationLink', 'from', 'composetime', 'version']) assert.equal(typeof m[key], 'string', key);
  }
  assert.ok(messages.some((m: Json) => linkRoot(m.conversationLink) === m.id), 'root');
  assert.ok(messages.some((m: Json) => linkRoot(m.conversationLink) !== m.id && m.rootMessageId === linkRoot(m.conversationLink)), 'reply');
  assert.ok(messages.some((m: Json) => typeof m.properties?.edittime === 'number'), 'edited');
  assert.ok(messages.some((m: Json) => typeof m.properties?.deletetime === 'number' && m.content === ''), 'deleted');
  assert.ok(messages.some((m: Json) => m.messagetype.startsWith('ThreadActivity/') && m.from.endsWith(m.conversationid)), 'system');
});

test('csa payload lists teams with channels, chats with members and private feeds', () => {
  const { teams, chats, privateFeeds } = fixture('csa-teams');
  for (const team of teams) {
    assert.equal(typeof team.displayName, 'string');
    for (const channel of team.channels) assert.equal(channel.parentTeamId, team.id);
    assert.equal(team.channels.find((c: Json) => c.isGeneral).id, team.id);
  }
  assert.ok(chats.every((c: Json) => Array.isArray(c.members) && c.members.every((m: Json) => typeof m.mri === 'string')));
  assert.ok(privateFeeds.some((f: Json) => f.id === '48:notes'));
});
