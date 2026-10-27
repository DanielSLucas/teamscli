import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCheckpoint, upsertCheckpoint } from '../../src/store/checkpoints.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { getMessage, listMessages, upsertMessages } from '../../src/store/messages.ts';
import { fetchHistory } from '../../src/sync/history.ts';
import { createTeamsClient } from '../../src/teams/client.ts';
import { fakeFetch, TEST_ENDPOINTS, type FakeRoute } from '../helpers/fake-fetch.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';

const CONVERSATION_ID = 'chat-history';
const CUTOFF = '2026-01-02T00:00:00.000Z';
const START_URL = `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${CONVERSATION_ID}/messages?view=msnp24Equivalent&pageSize=200&startTime=1`;
const NOW = () => new Date('2026-01-20T00:00:00.000Z');

function rawMessage(id: string, createdAt: string) {
  return {
    id,
    messagetype: 'Text',
    content: `<p>${id}</p>`,
    conversationid: CONVERSATION_ID,
    from: 'https://chat.example.test/v1/users/ME/contacts/8:orgid:synthetic',
    imdisplayname: 'Synthetic Sender',
    composetime: createdAt,
    version: String(Date.parse(createdAt)),
    properties: {},
  };
}

function setup(routes: FakeRoute[]) {
  const db = openDatabase(':memory:');
  upsertConversations(db, [aConversation({ id: CONVERSATION_ID })]);
  const fake = fakeFetch(routes);
  const client = createTeamsClient({
    fetch: fake.fetch,
    session: { headers: async () => ({}), endpoints: async () => TEST_ENDPOINTS },
    maxRetries: 0,
  });
  const logs: string[] = [];
  return { db, calls: fake.calls, logs, client, log: (line: string) => logs.push(line) };
}

test('fetch walks to the oldest page, idempotently upserts and preserves sync cursors', async () => {
  const page2 = 'https://chat.example.test/history/page-2';
  const page3 = 'https://chat.example.test/history/page-3';
  const routes: FakeRoute[] = [
    { url: START_URL, json: { messages: [rawMessage('newest', '2026-01-04T00:00:00.000Z')], _metadata: { backwardLink: page2 } } },
    { url: page2, json: { messages: [rawMessage('existing', CUTOFF), rawMessage('older', '2026-01-01T00:00:00.000Z')], _metadata: { backwardLink: page3 } } },
    { url: page3, json: { messages: [rawMessage('oldest', '2025-12-31T00:00:00.000Z')], _metadata: {} } },
  ];
  const { db, calls, logs, client, log } = setup(routes);
  const checkpoint = {
    scope: CONVERSATION_ID,
    syncState: 'https://chat.example.test/sync/current',
    backwardLink: 'https://chat.example.test/sync/pending',
    oldestMessageAt: CUTOFF,
    historyComplete: false,
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
  upsertCheckpoint(db, checkpoint);
  upsertMessages(db, [aMessage({
    conversationId: CONVERSATION_ID,
    id: 'existing',
    createdAt: CUTOFF,
    content: '<p>existing</p>',
    text: 'existing',
    version: Date.parse(CUTOFF),
  })]);

  const result = await fetchHistory({
    db, client, endpoints: TEST_ENDPOINTS, conversationId: CONVERSATION_ID, now: NOW, log,
  });

  assert.deepEqual(result, { conversationId: CONVERSATION_ID, pages: 2, messages: 4, historyComplete: true });
  assert.deepEqual(calls.map(({ url }) => url), [START_URL, page2, page3]);
  assert.equal(listMessages(db, { conversationId: CONVERSATION_ID, limit: 10 }).length, 4);
  assert.equal(getMessage(db, CONVERSATION_ID, 'existing')?.text, 'existing');
  assert.deepEqual(getCheckpoint(db, CONVERSATION_ID), {
    ...checkpoint,
    oldestMessageAt: '2025-12-31T00:00:00.000Z',
    historyComplete: true,
    updatedAt: '2026-01-20T00:00:00.000Z',
  });
  assert.ok(logs.length > 0);
  assert.ok(logs.every((line) => !line.includes('<p>')));
});

test('--pages stops after the requested number of older pages, not newer pages', async () => {
  const page2 = 'https://chat.example.test/history/limited-page-2';
  const page3 = 'https://chat.example.test/history/limited-page-3';
  const { db, calls, client, log } = setup([
    { url: START_URL, json: { messages: [rawMessage('newer', '2026-01-03T00:00:00.000Z')], _metadata: { backwardLink: page2 } } },
    { url: page2, json: { messages: [rawMessage('older', '2026-01-01T00:00:00.000Z')], _metadata: { backwardLink: page3 } } },
    { url: page3, json: { messages: [rawMessage('unfetched', '2025-12-31T00:00:00.000Z')], _metadata: {} } },
  ]);
  upsertCheckpoint(db, {
    scope: CONVERSATION_ID,
    syncState: 'https://chat.example.test/sync/current',
    backwardLink: null,
    oldestMessageAt: CUTOFF,
    historyComplete: false,
    updatedAt: CUTOFF,
  });

  const result = await fetchHistory({
    db, client, endpoints: TEST_ENDPOINTS, conversationId: CONVERSATION_ID, before: CUTOFF, pages: 1, now: NOW, log,
  });

  assert.deepEqual(result, { conversationId: CONVERSATION_ID, pages: 1, messages: 2, historyComplete: false });
  assert.deepEqual(calls.map(({ url }) => url), [START_URL, page2]);
  assert.equal(getCheckpoint(db, CONVERSATION_ID)?.historyComplete, false);
  assert.equal(getMessage(db, CONVERSATION_ID, 'newer')?.id, 'newer');
  assert.equal(getMessage(db, CONVERSATION_ID, 'older')?.id, 'older');
  assert.equal(getMessage(db, CONVERSATION_ID, 'unfetched'), null);
});

test('an empty final page ends history even if it includes a backwardLink', async () => {
  const emptyPage = 'https://chat.example.test/history/empty-page';
  const unusedPage = 'https://chat.example.test/history/unused-after-empty';
  const { db, calls, client, log } = setup([
    { url: START_URL, json: { messages: [rawMessage('latest', '2026-01-03T00:00:00.000Z')], _metadata: { backwardLink: emptyPage } } },
    { url: emptyPage, json: { messages: [], _metadata: { backwardLink: unusedPage } } },
    { url: unusedPage, json: { messages: [rawMessage('unreachable', '2025-12-31T00:00:00.000Z')], _metadata: {} } },
  ]);

  const result = await fetchHistory({
    db, client, endpoints: TEST_ENDPOINTS, conversationId: CONVERSATION_ID, now: NOW, log,
  });

  assert.equal(result.historyComplete, true);
  assert.deepEqual(calls.map(({ url }) => url), [START_URL, emptyPage]);
  assert.equal(getCheckpoint(db, CONVERSATION_ID)?.historyComplete, true);
  assert.equal(getMessage(db, CONVERSATION_ID, 'unreachable'), null);
});
