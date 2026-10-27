import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Checkpoint } from '../../src/models.ts';
import { getCheckpoint } from '../../src/store/checkpoints.ts';
import { openDatabase } from '../../src/store/database.ts';
import { getConversation, listConversations } from '../../src/store/conversations.ts';
import { getMessage, listMessages } from '../../src/store/messages.ts';
import { listMembers } from '../../src/store/people.ts';
import { runSync } from '../../src/sync/runner.ts';
import { createTeamsClient } from '../../src/teams/client.ts';
import { fakeFetch, fakeSession, TEST_ENDPOINTS, type FakeRoute } from '../helpers/fake-fetch.ts';

type Json = any;
const conversationFixture = JSON.parse(readFileSync(new URL('../fixtures/teams/conversations-page.json', import.meta.url), 'utf8')) as Json;
const lastConversationPage = JSON.parse(readFileSync(new URL('../fixtures/teams/conversations-last-page.json', import.meta.url), 'utf8')) as Json;
const messageFixture = JSON.parse(readFileSync(new URL('../fixtures/teams/messages-page.json', import.meta.url), 'utf8')) as Json;
const csaFixture = JSON.parse(readFileSync(new URL('../fixtures/teams/csa-teams.json', import.meta.url), 'utf8')) as Json;
const LIST_URL = `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`;
const CSA_URL = `${TEST_ENDPOINTS.csa}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`;
const FIXED_NOW = new Date('2026-01-20T00:00:00.000Z');

function messageStartUrl(id: string): RegExp {
  return new RegExp(`^${escapeRegex(TEST_ENDPOINTS.chatService)}/v1/users/ME/conversations/${escapeRegex(encodeURIComponent(id))}/messages\\?view=msnp24Equivalent&pageSize=200&startTime=\\d+$`);
}

function listResponse(conversations: unknown[], syncState: string, backwardLink?: string) {
  return { conversations, _metadata: { syncState, ...(backwardLink ? { backwardLink } : {}) } };
}

function rawConversation(id: string, productThreadType = 'Chat') {
  return { id, threadProperties: { productThreadType, topic: `Title ${id}` }, lastMessage: {} };
}

function rawMessage(id: string, conversationId: string, version = '1768478400000') {
  return {
    id, messagetype: 'Text', content: `<p>${id}</p>`, conversationid: conversationId,
    from: 'https://chat.example.test/v1/users/ME/contacts/8:orgid:person-1',
    imdisplayname: 'Alice Example', composetime: '2026-01-15T12:00:00.000Z', version, properties: {},
  };
}

function setup(routes: FakeRoute[]) {
  const db = openDatabase(':memory:');
  const fake = fakeFetch(routes);
  const client = createTeamsClient({ fetch: fake.fetch, session: fakeSession() });
  const logs: string[] = [];
  return {
    db,
    calls: fake.calls,
    logs,
    run: (days = 90) => runSync({ db, client, endpoints: TEST_ENDPOINTS, days, now: () => new Date(FIXED_NOW), log: (line) => logs.push(line) }),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('initial sync pages conversations and backfills messages, then a delta updates edits and deletes', async () => {
  const db = openDatabase(':memory:');
  const channelsAndChats = structuredClone(conversationFixture.conversations) as Json[];
  for (const stream of ['Notifications', 'Mentions', 'CallLogs', 'Threads']) {
    channelsAndChats.push(rawConversation(`48:${stream.toLowerCase()}`, `StreamOf${stream}`));
  }
  const conversationPage = { ...conversationFixture, conversations: channelsAndChats };
  const conversationIds = conversationFixture.conversations.map((conversation: Json) => conversation.id) as string[];
  const channelId = '19:5555eeee6666ffff7777aaaa8888bbbb@thread.tacv2';
  const backfillSyncState = `https://chat.example.test/messages/${encodeURIComponent(channelId)}/sync`;
  const emptyMessageRoutes: FakeRoute[] = conversationIds
    .filter((id) => id !== channelId)
    .map((id) => ({ url: messageStartUrl(id), json: { messages: [], _metadata: { syncState: `https://chat.example.test/messages/${encodeURIComponent(id)}/sync` } } }));
  const deltaState = 'https://chat.example.test/conversations/delta-2';
  const nextListState = 'https://chat.example.test/conversations/delta-3';
  const edited = structuredClone(messageFixture.messages[2]) as Json;
  edited.content = '<p>Pizza is Saturday</p>';
  edited.version = '1768479900000';
  edited.properties.edittime = 1768479900000;
  const deleted = structuredClone(messageFixture.messages[3]) as Json;
  deleted.version = '1768480300000';
  deleted.properties.deletetime = 1768480300000;
  const { fetch, calls } = fakeFetch([
    { url: LIST_URL, json: conversationPage },
    { url: conversationFixture._metadata.backwardLink, json: lastConversationPage },
    { url: CSA_URL, json: csaFixture },
    { url: messageStartUrl(channelId), json: { ...messageFixture, _metadata: { ...messageFixture._metadata, syncState: backfillSyncState } } },
    { url: messageFixture._metadata.backwardLink, json: { messages: [], _metadata: { backwardLink: 'https://chat.example.test/empty-final-unused', syncState: backfillSyncState } } },
    ...emptyMessageRoutes,
    { url: lastConversationPage._metadata.syncState, json: listResponse([conversationFixture.conversations.find((item: Json) => item.id === channelId)], nextListState) },
    { url: CSA_URL, json: csaFixture },
    { url: backfillSyncState, json: { messages: [edited, deleted], _metadata: { syncState: deltaState } } },
  ]);
  const client = createTeamsClient({ fetch, session: fakeSession() });
  const logs: string[] = [];
  const run = () => runSync({ db, client, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: (line) => logs.push(line) });

  const first = await run();
  assert.deepEqual(first, { conversations: 11, conversationsSynced: 7, messages: 5, warnings: [] });
  assert.equal(getCheckpoint(db, 'conversations')?.syncState, lastConversationPage._metadata.syncState);
  assert.equal(getCheckpoint(db, channelId)?.syncState, backfillSyncState);
  assert.equal(getCheckpoint(db, channelId)?.backwardLink, null);
  assert.equal(getCheckpoint(db, channelId)?.oldestMessageAt, '2026-01-15T09:40:00.000Z');
  assert.equal(getConversation(db, '19:1111aaaa2222bbbb3333cccc4444dddd@thread.tacv2')?.title, 'General');
  assert.equal(getConversation(db, channelId)?.lastMessageAt, '2026-01-15T13:00:00.000Z');
  assert.equal(listMembers(db, '19:0a1b2c3d4e5f40718293a4b5c6d7e8f9@thread.v2').length, 3);
  assert.equal(calls.filter(({ url }) => url === messageFixture._metadata.backwardLink).length, 1);
  assert.equal(calls.some(({ url }) => url === 'https://chat.example.test/empty-final-unused'), false);
  assert.ok(calls.some(({ url }) => url.includes(`startTime=${FIXED_NOW.getTime() - 90 * 24 * 60 * 60 * 1000}`)));
  assert.equal(calls.some(({ url }) => url.includes('/48%3Anotifications/messages')), false);
  assert.ok(logs.some((line) => line.includes('Sync 1/7')));
  assert.ok(logs.every((line) => !line.includes('Count me in')));

  const second = await run();
  assert.deepEqual(second, { conversations: 11, conversationsSynced: 1, messages: 2, warnings: [] });
  assert.equal(calls.filter(({ url }) => url === lastConversationPage._metadata.syncState).length, 1);
  assert.equal(calls.filter(({ url }) => url === backfillSyncState).length, 1);
  assert.equal(listMessages(db, { conversationId: channelId, limit: 20 }).length, 5);
  assert.equal(getMessage(db, channelId, '1768479000000')?.text, 'Pizza is Saturday');
  assert.equal(getMessage(db, channelId, '1768479300000')?.deletedAt, '2026-01-15T12:31:40.000Z');
  assert.equal(getCheckpoint(db, channelId)?.syncState, deltaState);
});

test('resumes a failed backfill from the saved backwardLink and safely replays duplicate messages', async () => {
  const id = 'chat-resume';
  const listState = 'https://chat.example.test/conversations/resume-sync';
  const nextListState = 'https://chat.example.test/conversations/resume-next';
  const nextMessagePage = 'https://chat.example.test/messages/resume-next';
  const finalMessageState = 'https://chat.example.test/messages/resume-delta';
  const raw = rawConversation(id);
  const { db, calls, run } = setup([
    { url: LIST_URL, json: listResponse([raw], listState) },
    { url: CSA_URL, json: csaFixture, times: 2 },
    { url: messageStartUrl(id), json: { messages: [rawMessage('m1', id)], _metadata: { backwardLink: nextMessagePage, syncState: 'https://chat.example.test/messages/partial-sync' } }, times: 1 },
    { url: nextMessagePage, status: 500, times: 1 },
    { url: listState, json: listResponse([], nextListState) },
    { url: nextMessagePage, json: { messages: [rawMessage('m1', id), rawMessage('m2', id)], _metadata: { syncState: finalMessageState } } },
  ]);

  const interrupted = await run(7);
  assert.deepEqual(interrupted.warnings, [{ conversationId: id, code: 'remote', status: 500 }]);
  assert.equal(interrupted.messages, 1);
  const pending = getCheckpoint(db, id) as Checkpoint;
  assert.equal(pending.backwardLink, nextMessagePage);
  assert.equal(pending.syncState, null);

  const resumed = await run(7);
  assert.deepEqual(resumed.warnings, []);
  assert.equal(resumed.messages, 2);
  assert.equal(listMessages(db, { conversationId: id, limit: 10 }).length, 2);
  assert.equal(getCheckpoint(db, id)?.backwardLink, null);
  assert.equal(getCheckpoint(db, id)?.syncState, finalMessageState);
  assert.equal(calls.filter(({ url }) => url === nextMessagePage).length, 2);
  assert.ok(calls.some(({ url }) => url === listState));
});

test('a 404 warns for that conversation and continues syncing the rest', async () => {
  const missingId = 'chat-empty-channel';
  const availableId = 'chat-available';
  const { db, calls, run } = setup([
    { url: LIST_URL, json: listResponse([rawConversation(missingId), rawConversation(availableId)], 'https://chat.example.test/conversations/404-sync') },
    { url: CSA_URL, json: csaFixture },
    { url: messageStartUrl(missingId), status: 404 },
    { url: messageStartUrl(availableId), json: { messages: [rawMessage('m1', availableId)], _metadata: { syncState: 'https://chat.example.test/messages/available-sync' } } },
  ]);

  const result = await run();
  assert.deepEqual(result.warnings, [{ conversationId: missingId, code: 'remote', status: 404 }]);
  assert.equal(result.messages, 1);
  assert.ok(calls.some(({ url }) => url.includes(encodeURIComponent(availableId))));
  assert.equal(listMessages(db, { conversationId: availableId, limit: 10 }).length, 1);
});

test('message, people and checkpoint writes roll back together when a page transaction fails', async () => {
  const id = 'chat-atomic';
  const { db, run } = setup([
    { url: LIST_URL, json: listResponse([rawConversation(id)], 'https://chat.example.test/conversations/atomic-sync') },
    { url: CSA_URL, json: { teams: [], chats: [], metadata: {} } },
    { url: messageStartUrl(id), json: { messages: [rawMessage('m1', id)], _metadata: { syncState: 'https://chat.example.test/messages/atomic-sync' } } },
  ]);
  db.exec(`
    CREATE TRIGGER fail_chat_checkpoint BEFORE INSERT ON checkpoints
    WHEN NEW.scope = 'chat-atomic'
    BEGIN SELECT RAISE(ABORT, 'synthetic checkpoint failure'); END
  `);

  await assert.rejects(run(), /synthetic checkpoint failure/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM messages').get()?.count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM people').get()?.count, 0);
  assert.equal(getCheckpoint(db, id), null);
});

test('does not advance the conversation cursor when authentication aborts message sync', async () => {
  const id = 'chat-auth-required';
  const { db, run } = setup([
    { url: LIST_URL, json: listResponse([rawConversation(id)], 'https://chat.example.test/conversations/auth-sync') },
    { url: CSA_URL, json: { teams: [], chats: [], metadata: {} } },
    { url: messageStartUrl(id), status: 401 },
  ]);

  await assert.rejects(run(), (error: any) => error.code === 'auth_required');
  assert.equal(getCheckpoint(db, 'conversations'), null);
  assert.equal(getCheckpoint(db, id), null);
});
