import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamsClient } from '../../src/teams/client.ts';
import { deleteMessage, editText, sendText } from '../../src/teams/send.ts';
import { fakeFetch, fakeSession, TEST_ENDPOINTS } from '../helpers/fake-fetch.ts';
import { aMessage } from '../helpers/builders.ts';

const chatId = 'chat-example';
const channelId = '19:channel@example.test';
const messageUrl = (conversationId: string) => {
  const marker = ';messageid=';
  const separator = conversationId.lastIndexOf(marker);
  const path = separator < 0
    ? encodeURIComponent(conversationId)
    : `${encodeURIComponent(conversationId.slice(0, separator))}${marker}${encodeURIComponent(conversationId.slice(separator + marker.length))}`;
  return `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${path}/messages?view=msnp24Equivalent&pageSize=200`;
};

function rawMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: '1767261600000',
    messagetype: 'RichText/Html',
    content: '<p>Updated</p>',
    conversationid: chatId,
    from: 'https://chat.example.test/v1/users/ME/contacts/8:orgid:synthetic',
    imdisplayname: 'Alex Example',
    composetime: '2026-01-01T10:00:00.000Z',
    version: '1767261700000',
    clientmessageid: '123456789012345678',
    properties: {},
    ...overrides,
  };
}

test('sends a rich text reply to a thread and finds it by clientmessageid', async () => {
  const threadId = `${channelId};messageid=1767261600000`;
  const pageUrl = messageUrl(threadId);
  const fake = fakeFetch([
    { method: 'POST', url: `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)};messageid=1767261600000/messages`, status: 201, json: {} },
    { url: pageUrl, json: { messages: [], _metadata: {} } },
  ]);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await fake.fetch(input, init);
    if ((init?.method ?? 'GET') !== 'GET') return response;
    const clientMessageId = (fake.calls[0]?.body as Record<string, unknown>).clientmessageid;
    return new Response(JSON.stringify({ messages: [rawMessage({ conversationid: channelId, clientmessageid: clientMessageId })], _metadata: {} }));
  };
  const client = createTeamsClient({ fetch, session: fakeSession() });
  const result = await sendText(client, TEST_ENDPOINTS, {
    conversationId: channelId,
    replyTo: '1767261600000',
    text: '<script>alert("x")</script>',
  });

  const body = fake.calls[0]?.body as Record<string, unknown>;
  assert.equal(fake.calls[0]?.method, 'POST');
  assert.equal(body.messagetype, 'RichText/Html');
  assert.equal(body.contenttype, 'text');
  assert.equal('postType' in body, false);
  assert.match(String(body.clientmessageid), /^\d+$/);
  assert.equal(body.content, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(result.message?.id, '1767261600000');
  assert.equal(result.message?.clientMessageId, result.clientMessageId);
  assert.equal(fake.calls[1]?.url, pageUrl);
});

test('edits and soft-deletes a message at its conversation path', async () => {
  const id = '1767261600000';
  const endpoint = `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages/${id}`;
  const fake = fakeFetch([
    { method: 'PUT', url: endpoint, status: 200, json: {} },
    { url: messageUrl(chatId), times: 1, json: { messages: [rawMessage()], _metadata: {} } },
    { method: 'DELETE', url: `${endpoint}?behavior=softDelete`, status: 200, json: {} },
    { url: messageUrl(chatId), json: { messages: [rawMessage({ content: '', version: '1767261800000', properties: { deletetime: 1767261800000 } })], _metadata: {} } },
  ]);
  const client = createTeamsClient({ fetch: fake.fetch, session: fakeSession() });
  const message = aMessage({ id, conversationId: chatId });

  const edited = await editText(client, TEST_ENDPOINTS, message, '<updated>');
  assert.ok(edited);
  assert.equal((fake.calls[0]?.body as Record<string, unknown>).content, '<p>&lt;updated&gt;</p>');
  const editedBody = fake.calls[0]?.body as Record<string, unknown>;
  assert.match(String(editedBody.clientmessageid), /^\d+$/);
  assert.equal(editedBody.messagetype, 'RichText/Html');
  assert.equal((await deleteMessage(client, TEST_ENDPOINTS, message))?.deletedAt, '2026-01-01T10:03:20.000Z');
  assert.deepEqual(fake.calls.map(({ method }) => method), ['PUT', 'GET', 'DELETE', 'GET']);
});
