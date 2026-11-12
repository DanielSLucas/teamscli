import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTeamsClient } from '../../src/teams/client.ts';
import { listMessages, mapMessage, reactionKey, type MessagePage } from '../../src/teams/messages.ts';
import { fakeFetch, fakeSession, TEST_ENDPOINTS } from '../helpers/fake-fetch.ts';

type Json = any;
const fixture = JSON.parse(readFileSync(new URL('../fixtures/teams/messages-page.json', import.meta.url), 'utf8')) as Json;
const channelId = '19:5555eeee6666ffff7777aaaa8888bbbb@thread.tacv2';
const messageIds = fixture.messages.map((message: Json) => message.id);

function makeClient(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  return { client: createTeamsClient({ fetch: fake.fetch, session: fakeSession() }), calls: fake.calls };
}

async function collect(iter: AsyncGenerator<MessagePage>) {
  const pages: MessagePage[] = [];
  for await (const page of iter) pages.push(page);
  return pages;
}

test('maps each message and people from the synthetic page, preserving Teams order', async () => {
  const { client: teams, calls } = makeClient([
    { url: `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent&pageSize=200`, json: fixture },
    { url: fixture._metadata.backwardLink, json: { messages: [], _metadata: { syncState: fixture._metadata.syncState } } },
  ]);

  const pages = await collect(listMessages(teams, TEST_ENDPOINTS, channelId));
  const messages = pages.flatMap((page) => page.messages);
  assert.deepEqual(calls.map((call) => call.url), [
    `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent&pageSize=200`,
    fixture._metadata.backwardLink,
  ]);
  assert.deepEqual(messages.map((message) => message.id), messageIds);
  assert.equal(messages[0]?.parentId, '1768478400000');
  assert.equal(messages[0]?.senderId, '8:orgid:00000000-0000-4000-8000-000000000003');
  assert.equal(messages[0]?.senderName, 'Carol Example');
  assert.equal(messages[0]?.text, 'Count me in & Alice!');
  assert.equal(messages[0]?.createdAt, '2026-01-15T13:00:00.000Z');
  assert.equal(messages[1]?.parentId, null);
  assert.equal(messages[2]?.editedAt, '2026-01-15T12:20:00.000Z');
  assert.equal(messages[3]?.content, '');
  assert.equal(messages[3]?.deletedAt, '2026-01-15T12:26:40.000Z');
  assert.equal(messages[4]?.senderId, null);
  assert.equal(messages[4]?.text, '');
  assert.deepEqual(pages[0]?.people.map((person) => person.id), [
    '8:orgid:00000000-0000-4000-8000-000000000003',
    '8:orgid:00000000-0000-4000-8000-000000000001',
    '8:orgid:00000000-0000-4000-8000-000000000002',
  ]);
  assert.equal(pages[0]?.syncState, fixture._metadata.syncState);
  assert.equal(pages[0]?.backwardLink, fixture._metadata.backwardLink);
  assert.equal(pages[1]?.backwardLink, null);
  assert.equal(pages[1]?.syncState, fixture._metadata.syncState);
});

test('encodes a channel thread id and start time in the first URL', async () => {
  const threadId = `${channelId};messageid=1768478400000`;
  const url = `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)};messageid=1768478400000/messages?view=msnp24Equivalent&pageSize=200&startTime=1`;
  const { client: teams, calls } = makeClient([{ url, json: { messages: [], _metadata: { syncState: `${url}&delta=1` } } }]);

  const pages = await collect(listMessages(teams, TEST_ENDPOINTS, threadId, { startTime: 1 }));
  assert.equal(calls[0]?.url, url);
  assert.equal(pages[0]?.syncState, `${url}&delta=1`);
});

test('uses a saved sync URL verbatim', async () => {
  const syncUrl = fixture._metadata.syncState;
  const { client: teams, calls } = makeClient([{ url: syncUrl, json: { messages: [], _metadata: { syncState: syncUrl } } }]);
  const pages = await collect(listMessages(teams, TEST_ENDPOINTS, channelId, { continuationUrl: syncUrl }));

  assert.equal(calls[0]?.url, syncUrl);
  assert.equal(pages[0]?.syncState, syncUrl);
});

test('keeps 28: app people and ignores thread ids, while malformed mention JSON is harmless', async () => {
  const raw = structuredClone(fixture.messages[0]) as Json;
  raw.from = 'https://chat.example.test/v1/users/ME/contacts/28:app';
  raw.imdisplayname = 'Helper App';
  raw.properties.mentions = JSON.stringify([
    { mri: '19:thread@thread.v2', displayName: 'A conversation' },
    { mri: '28:app', displayName: 'Helper' },
    { mri: '8:orgid:mentioned', displayName: 'Mentioned Person' },
  ]);
  const appMessage = mapMessage(raw);
  assert.equal(appMessage.senderId, '28:app');

  const { client: teams } = makeClient([{ url: `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent&pageSize=200`, json: { messages: [raw], _metadata: {} } }]);
  const pages = await collect(listMessages(teams, TEST_ENDPOINTS, channelId));
  assert.deepEqual(pages[0]?.people, [
    { id: '28:app', displayName: 'Helper App', email: null },
    { id: '8:orgid:mentioned', displayName: 'Mentioned Person', email: null },
  ]);

  raw.properties.mentions = '{bad json';
  const malformedClient = makeClient([
    { url: `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent&pageSize=200`, json: { messages: [raw], _metadata: {} } },
  ]);
  const malformed = await collect(listMessages(malformedClient.client, TEST_ENDPOINTS, channelId));
  assert.equal(malformed[0]?.people.length, 1);
  assert.equal(mapMessage(raw).senderId, '28:app');
});

test('does not index system event or media XML content', () => {
  const raw = structuredClone(fixture.messages[4]) as Json;
  for (const type of ['Event/Call', 'RichText/Media_CallRecording']) {
    assert.equal(mapMessage({ ...raw, messagetype: type }).text, '');
  }
});

test('lets the client 404 remote error through for an empty channel', async () => {
  const url = `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages?view=msnp24Equivalent&pageSize=200`;
  const { client: teams } = makeClient([{ url, status: 404 }]);
  await assert.rejects(collect(listMessages(teams, TEST_ENDPOINTS, channelId)), (error: any) => {
    assert.equal(error.code, 'remote');
    assert.deepEqual(error.details, { status: 404 });
    return true;
  });
});

test('inline images and attached files become placeholders in text', () => {
  const raw = {
    id: '1', messagetype: 'RichText/Html', conversationid: '19:chat@thread.v2', composetime: '2026-01-15T12:00:00.0000000Z', version: '1768478400000',
    content: '<p>See this <img itemscope="png" src="https://example.asm.skype.com/v1/objects/0-x/views/imgo" itemtype="http://schema.skype.com/AMSImage" alt="image"></p>',
    properties: { files: JSON.stringify([{ fileName: 'report.pdf', fileType: 'pdf', objectUrl: 'https://example.sharepoint.com/report.pdf' }, { fileName: 'broken' }]) },
  };
  const message = mapMessage(raw);
  assert.equal(message.text, 'See this [image] [file: report.pdf]');
  assert.deepEqual(message.files, [{ name: 'report.pdf', type: 'pdf', url: 'https://example.sharepoint.com/report.pdf' }]);

  const deleted = mapMessage({ ...raw, content: '', properties: { ...raw.properties, deletetime: 1768478500000 } });
  assert.deepEqual([deleted.text, deleted.files], ['', []]);
  assert.deepEqual(mapMessage({ ...raw, properties: { files: 'not json' } }).files, []);
});

test('maps the original sender and time of a forwarded message', () => {
  const raw = structuredClone(fixture.messages[0]) as Json;
  raw.properties.originalMessageContext = { originalSender: '8:orgid:original', originalSentTime: '2026-10-26T20:44:00.12Z', messageId: 1 };
  assert.deepEqual(mapMessage(raw).forwardedFrom, { senderId: '8:orgid:original', senderName: null, sentAt: '2026-10-26T20:44:00.120Z' });

  raw.properties.originalMessageContext = { originalSender: '8:orgid:original', originalSentTime: 'not a time' };
  assert.equal(mapMessage(raw).forwardedFrom?.sentAt, null);
  delete raw.properties.originalMessageContext;
  assert.equal(mapMessage(raw).forwardedFrom, null);
});

test('reactions map to emoji and drop keys left with no users', () => {
  const raw = {
    id: 'r1', messagetype: 'Text', content: 'hi', conversationid: 'chat-1', composetime: '2026-01-01T10:00:00.000Z', version: '1',
    properties: {
      emotions: [
        { key: 'heart', users: [{ mri: '8:orgid:person-1', time: 1767261600000, value: '1767261600000' }] },
        { key: 'like', users: [] },
        { key: 'parrot;0-example-object', users: [{ mri: '8:orgid:person-2', time: 1767261600000 }] },
      ],
    },
  };
  assert.deepEqual(mapMessage(raw).reactions, [
    { key: 'heart', emoji: '❤️', users: [{ id: '8:orgid:person-1', name: null, reactedAt: '2026-01-01T10:00:00.000Z' }] },
    { key: 'parrot;0-example-object', emoji: null, users: [{ id: '8:orgid:person-2', name: null, reactedAt: '2026-01-01T10:00:00.000Z' }] },
  ]);
  assert.deepEqual(mapMessage({ ...raw, properties: {} }).reactions, []);
});

test('reaction keys accept Teams keys, emoji with or without the variation selector, and custom emoji', () => {
  assert.equal(reactionKey('fire'), 'fire');
  assert.equal(reactionKey('👍'), 'like');
  assert.equal(reactionKey('❤'), 'heart');
  assert.equal(reactionKey('❤️'), 'heart');
  assert.equal(reactionKey('parrot;0-example-object'), 'parrot;0-example-object');
  assert.equal(reactionKey('not-an-emoji'), null);
});

test('a reply quote is mapped apart from the reply text', () => {
  const content = '<blockquote itemscope itemtype="http://schema.skype.com/Reply" itemid="1767261500000">'
    + '<strong itemprop="mri" itemid="8:orgid:person-1">Alice Example</strong><span itemprop="time" itemid="1767261500000"></span>'
    + '<p itemprop="preview">the original &amp; question</p></blockquote>\n<p>the answer</p>';
  const message = mapMessage({ id: 'q1', messagetype: 'RichText/Html', content, conversationid: 'chat-1', composetime: '2026-01-01T10:00:00.000Z', version: '1' });
  assert.equal(message.text, 'the answer');
  assert.deepEqual(message.quote, { id: '1767261500000', senderId: '8:orgid:person-1', senderName: 'Alice Example', text: 'the original & question' });
  assert.equal(mapMessage({ ...message, messagetype: 'Text', content: 'plain', conversationid: 'chat-1', composetime: '2026-01-01T10:00:00.000Z', version: '1' }).quote, null);
});
