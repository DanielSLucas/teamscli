import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTeamsClient } from '../../src/teams/client.ts';
import { fetchMembers, listConversations, mapConversation } from '../../src/teams/conversations.ts';
import { fakeFetch, fakeSession, TEST_ENDPOINTS } from '../helpers/fake-fetch.ts';

type Json = any;

const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`../fixtures/teams/${name}.json`, import.meta.url), 'utf8'));

function client(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  return { client: createTeamsClient({ fetch: fake.fetch, session: fakeSession() }), calls: fake.calls };
}

test('lists conversation pages through the final empty page and preserves Teams links', async () => {
  const first = fixture('conversations-page');
  const last = fixture('conversations-last-page');
  const firstUrl = `${TEST_ENDPOINTS.chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`;
  const { client: teams, calls } = client([
    { url: firstUrl, json: first },
    { url: first._metadata.backwardLink, json: last },
  ]);

  const pages = [];
  for await (const page of listConversations(teams, TEST_ENDPOINTS)) pages.push(page);

  assert.deepEqual(pages.map((page) => page.conversations.length), [7, 0]);
  assert.equal(pages[1]?.syncState, last._metadata.syncState);
  assert.deepEqual(calls.map((call) => call.url), [firstUrl, first._metadata.backwardLink]);
});

test('starts from a saved Teams link verbatim', async () => {
  const first = fixture('conversations-page');
  const last = fixture('conversations-last-page');
  const savedLink = first._metadata.backwardLink;
  const { client: teams, calls } = client([{ url: savedLink, json: last }]);

  const pages = [];
  for await (const page of listConversations(teams, TEST_ENDPOINTS, savedLink)) pages.push(page);

  assert.equal(calls[0]?.url, savedLink);
  assert.equal(pages[0]?.syncState, last._metadata.syncState);
});

test('maps every conversation kind and normalizes timestamps', () => {
  const capturedShapes = fixture('conversations-page').conversations as Json[];
  const additional = fixture('conversations-mapping').conversations as Json[];
  const mapped = [...capturedShapes, ...additional].map(mapConversation);

  assert.deepEqual(mapped.map(({ id, kind, teamId }) => ({ id, kind, teamId })), [
    { id: capturedShapes[0].id, kind: 'chat', teamId: null },
    { id: capturedShapes[1].id, kind: 'group', teamId: null },
    { id: capturedShapes[2].id, kind: 'meeting', teamId: null },
    { id: capturedShapes[3].id, kind: 'channel', teamId: capturedShapes[3].threadProperties.spaceId },
    { id: capturedShapes[4].id, kind: 'channel', teamId: capturedShapes[4].id },
    { id: capturedShapes[5].id, kind: 'channel', teamId: '19:1111aaaa2222bbbb3333cccc4444dddd@thread.tacv2' },
    { id: capturedShapes[6].id, kind: 'system', teamId: null },
    { id: additional[0].id, kind: 'system', teamId: null },
    { id: additional[1].id, kind: 'system', teamId: null },
    { id: additional[2].id, kind: 'system', teamId: null },
    { id: additional[3].id, kind: 'system', teamId: null },
    { id: additional[4].id, kind: 'system', teamId: null },
    { id: additional[5].id, kind: 'channel', teamId: null },
  ]);
  assert.equal(mapped[1]?.title, 'Lunch Club');
  assert.equal(mapped[2]?.title, 'Weekly Sync');
  assert.equal(mapped[2]?.lastMessageAt, null);
  assert.equal(mapped[6]?.lastMessageAt, null);
  assert.equal(mapped[7]?.lastMessageAt, '2026-01-15T13:00:00.123Z');  assert.equal(mapped[0]?.readUpTo, '2026-01-15T12:00:00.000Z');
  assert.equal(mapped[1]?.readUpTo, null);
});

test('fetches thread members using an encoded conversation id', async () => {
  const payload = fixture('thread-members');
  const conversationId = payload.id;
  const url = `${TEST_ENDPOINTS.chatService}/v1/threads/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`;
  const { client: teams, calls } = client([{ url, json: payload }]);

  assert.deepEqual(await fetchMembers(teams, TEST_ENDPOINTS, conversationId), [
    { conversationId, personId: '8:orgid:00000000-0000-4000-8000-000000000021', role: 'Admin' },
    { conversationId, personId: '8:live:example-member', role: 'User' },
  ]);
  assert.equal(calls[0]?.url, url);
});

test('returns an empty roster when thread members are missing or null', async () => {
  const conversationId = '19:example@thread.v2';
  const url = `${TEST_ENDPOINTS.chatService}/v1/threads/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`;

  for (const json of [{ id: conversationId }, { id: conversationId, members: null }]) {
    const { client: teams } = client([{ url, json }]);
    assert.deepEqual(await fetchMembers(teams, TEST_ENDPOINTS, conversationId), []);
  }
});
