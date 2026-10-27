import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Checkpoint } from '../../src/models.ts';
import { getCheckpoint } from '../../src/store/checkpoints.ts';
import { openDatabase } from '../../src/store/database.ts';
import { getConversation, listConversations } from '../../src/store/conversations.ts';
import { getMessage, listMessages } from '../../src/store/messages.ts';
import { listMembers } from '../../src/store/people.ts';
import { type SyncEvent } from '../../src/sync/events.ts';
import { runSync, runSyncFollow } from '../../src/sync/runner.ts';
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

function rawEventMessage(id: string, conversationId: string, version: string, composetime: string, properties: Record<string, unknown> = {}) {
  return {
    ...rawMessage(id, conversationId, version),
    content: properties.deletetime === undefined ? `<p>${id}</p>` : '',
    composetime,
    properties,
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

test('emits ordered message changes after writes and ignores a repeated version', async () => {
  const id = 'chat-events';
  const listState1 = 'https://chat.example.test/conversations/events-1';
  const listState2 = 'https://chat.example.test/conversations/events-2';
  const listState3 = 'https://chat.example.test/conversations/events-3';
  const messageState1 = 'https://chat.example.test/messages/events-1';
  const messageState2 = 'https://chat.example.test/messages/events-2';
  const messageState3 = 'https://chat.example.test/messages/events-3';
  const titleChanged = rawConversation(id);
  titleChanged.threadProperties.topic = 'Changed title';
  const sameTitle = structuredClone(titleChanged);
  const m1 = rawEventMessage('m1', id, '100', '2026-01-01T10:00:00.000Z');
  const m2 = rawEventMessage('m2', id, '200', '2026-01-02T10:00:00.000Z');
  const m1Deleted = rawEventMessage('m1', id, '150', '2026-01-01T10:00:00.000Z', { deletetime: 1768479000000 });
  const m2Edited = rawEventMessage('m2', id, '250', '2026-01-02T10:00:00.000Z', { edittime: 1768479900000 });
  const m3 = rawEventMessage('m3', id, '300', '2026-01-03T10:00:00.000Z');
  const emptyCsa = { teams: [], chats: [], metadata: {} };
  const fake = fakeFetch([
    { url: LIST_URL, json: listResponse([rawConversation(id)], listState1) },
    { url: CSA_URL, json: emptyCsa, times: 3 },
    { url: messageStartUrl(id), json: { messages: [m2, m1], _metadata: { syncState: messageState1 } } },
    { url: listState1, json: listResponse([titleChanged], listState2) },
    { url: messageState1, json: { messages: [m3, m1Deleted, m2Edited], _metadata: { syncState: messageState2 } } },
    { url: listState2, json: listResponse([sameTitle], listState3) },
    { url: messageState2, json: { messages: [m2Edited], _metadata: { syncState: messageState3 } } },
  ]);
  const db = openDatabase(':memory:');
  const client = createTeamsClient({ fetch: fake.fetch, session: fakeSession() });
  const events: SyncEvent[] = [];
  const run = () => runSync({
    db, client, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    emit: (event) => {
      if (event.type.startsWith('message.')) {
        const message = event.data as Json;
        assert.deepEqual(getMessage(db, message.conversationId, message.id), message);
      }
      if (event.type === 'conversation.updated') assert.deepEqual(getConversation(db, event.data.id), event.data);
      events.push(event);
    },
  });

  await run();
  assert.deepEqual(events.filter(({ type }) => type === 'message.new').map(({ data }) => (data as Json).id), ['m1', 'm2']);
  assert.equal(events[0]?.type, 'conversation.updated');
  assert.equal((events.find(({ type }) => type === 'message.new')?.data as Json).id, 'm1');
  assert.equal((events.at(-1)?.data as Json).phase, 'done');

  events.length = 0;
  await run();
  assert.deepEqual(events.filter(({ type }) => type.startsWith('message.')).map(({ type, data }) => [type, (data as Json).id]), [
    ['message.deleted', 'm1'], ['message.edited', 'm2'], ['message.new', 'm3'],
  ]);
  const deleted = events.find(({ type }) => type === 'message.deleted')?.data as Json;
  assert.equal(deleted.content, '');
  assert.equal(deleted.text, '');
  assert.ok(events.some(({ type }) => type === 'conversation.updated'));

  events.length = 0;
  await run();
  assert.equal(events.some(({ type }) => type.startsWith('message.')), false);
  assert.equal(events.some(({ type }) => type === 'conversation.updated'), false);
  db.close();
});

test('follow runs two passes, emits done for each, and stops through its AbortSignal', async () => {
  const listState1 = 'https://chat.example.test/conversations/follow-1';
  const listState2 = 'https://chat.example.test/conversations/follow-2';
  const emptyCsa = { teams: [], chats: [], metadata: {} };
  const fake = fakeFetch([
    { url: LIST_URL, json: listResponse([], listState1) },
    { url: listState1, json: listResponse([], listState2) },
    { url: CSA_URL, json: emptyCsa, times: 2 },
  ]);
  const db = openDatabase(':memory:');
  const client = createTeamsClient({ fetch: fake.fetch, session: fakeSession() });
  const controller = new AbortController();
  const events: SyncEvent[] = [];
  const sleeps: number[] = [];
  const result = await runSyncFollow({
    db, client, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    intervalSeconds: 1, signal: controller.signal, emit: (event) => events.push(event),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length === 2) controller.abort();
    },
  });

  assert.equal(fake.calls.filter(({ url }) => url === LIST_URL || url === listState1).length, 2);
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(events.filter(({ type, data }) => type === 'sync.progress' && (data as Json).phase === 'done').length, 2);
  assert.deepEqual(result.warnings, []);
  db.close();
});

test('follow backs off after 429 using Retry-After and reports an auth failure as fatal', async () => {
  const emptyCsa = { teams: [], chats: [], metadata: {} };
  const throttled = fakeFetch([
    { url: LIST_URL, status: 429, headers: { 'retry-after': '5' }, times: 4 },
    { url: LIST_URL, json: listResponse([], 'https://chat.example.test/conversations/after-429') },
    { url: CSA_URL, json: emptyCsa },
  ]);
  const db = openDatabase(':memory:');
  const client = createTeamsClient({ fetch: throttled.fetch, session: fakeSession(), sleep: async () => {} });
  const controller = new AbortController();
  const events: SyncEvent[] = [];
  const sleeps: number[] = [];
  await runSyncFollow({
    db, client, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    intervalSeconds: 30, signal: controller.signal, emit: (event) => events.push(event),
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length === 2) controller.abort();
    },
  });
  assert.deepEqual(sleeps, [5000, 30000]);
  assert.equal(throttled.calls.filter(({ url }) => url === LIST_URL).length, 5);
  const warning = events.find(({ type, data }) => type === 'sync.error' && (data as Json).code === 'rate_limited');
  assert.equal((warning?.data as Json).fatal, false);
  db.close();

  const authDb = openDatabase(':memory:');
  const authFake = fakeFetch([{ url: LIST_URL, status: 401 }]);
  const authClient = createTeamsClient({ fetch: authFake.fetch, session: fakeSession() });
  const authController = new AbortController();
  const authEvents: SyncEvent[] = [];
  await assert.rejects(runSyncFollow({
    db: authDb, client: authClient, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    intervalSeconds: 30, signal: authController.signal, emit: (event) => authEvents.push(event), sleep: async () => {},
  }), (error: any) => error.code === 'auth_required');
  const fatal = authEvents.find(({ type }) => type === 'sync.error');
  assert.equal((fatal?.data as Json).code, 'auth_required');
  assert.equal((fatal?.data as Json).fatal, true);
  authDb.close();
});

test('follow warns and retries remote failures, and caps repeated rate-limit backoff', async () => {
  const emptyCsa = { teams: [], chats: [], metadata: {} };
  const remoteFake = fakeFetch([
    { url: LIST_URL, status: 500, times: 1 },
    { url: LIST_URL, json: listResponse([], 'https://chat.example.test/conversations/after-remote') },
    { url: CSA_URL, json: emptyCsa },
  ]);
  const remoteDb = openDatabase(':memory:');
  const remoteClient = createTeamsClient({ fetch: remoteFake.fetch, session: fakeSession() });
  const remoteController = new AbortController();
  const remoteEvents: SyncEvent[] = [];
  const remoteSleeps: number[] = [];
  await runSyncFollow({
    db: remoteDb, client: remoteClient, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    intervalSeconds: 30, signal: remoteController.signal, emit: (event) => remoteEvents.push(event),
    sleep: async (ms) => {
      remoteSleeps.push(ms);
      if (remoteSleeps.length === 2) remoteController.abort();
    },
  });
  assert.deepEqual(remoteSleeps, [30000, 30000]);
  assert.equal(remoteFake.calls.filter(({ url }) => url === LIST_URL).length, 2);
  const remoteWarning = remoteEvents.find(({ type, data }) => type === 'sync.error' && (data as Json).code === 'remote');
  assert.equal((remoteWarning?.data as Json).fatal, false);
  assert.equal(remoteEvents.filter(({ type, data }) => type === 'sync.progress' && (data as Json).phase === 'done').length, 1);
  remoteDb.close();

  const throttled = fakeFetch([{ url: LIST_URL, status: 429, headers: { 'retry-after': '0' }, times: 40 }]);
  const db = openDatabase(':memory:');
  const client = createTeamsClient({ fetch: throttled.fetch, session: fakeSession(), sleep: async () => {} });
  const controller = new AbortController();
  const sleeps: number[] = [];
  await runSyncFollow({
    db, client, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    intervalSeconds: 30, signal: controller.signal, emit: () => {},
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length === 10) controller.abort();
    },
  });
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000]);
  db.close();
});

test('a signal during a message page preserves that page and its resume checkpoint', async () => {
  const id = 'chat-signal';
  const nextPage = 'https://chat.example.test/messages/signal-next';
  const controller = new AbortController();
  const fake = fakeFetch([
    { url: LIST_URL, json: listResponse([rawConversation(id)], 'https://chat.example.test/conversations/signal') },
    { url: CSA_URL, json: { teams: [], chats: [], metadata: {} } },
    { url: messageStartUrl(id), json: { messages: [rawMessage('m1', id)], _metadata: { backwardLink: nextPage, syncState: 'https://chat.example.test/messages/signal-partial' } } },
  ]);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input).includes('/messages?')) controller.abort();
    return fake.fetch(input, init);
  };
  const db = openDatabase(':memory:');
  const client = createTeamsClient({ fetch, session: fakeSession() });
  const events: SyncEvent[] = [];
  await runSync({
    db, client, endpoints: TEST_ENDPOINTS, days: 90, now: () => new Date(FIXED_NOW), log: () => {},
    emit: (event) => events.push(event), signal: controller.signal,
  });

  assert.equal(getMessage(db, id, 'm1')?.id, 'm1');
  assert.equal(getCheckpoint(db, id)?.backwardLink, nextPage);
  assert.equal(getCheckpoint(db, 'conversations'), null);
  assert.equal(fake.calls.some(({ url }) => url === nextPage), false);
  assert.equal(events.some(({ type, data }) => type === 'sync.progress' && (data as Json).phase === 'done'), false);
  db.close();
});
