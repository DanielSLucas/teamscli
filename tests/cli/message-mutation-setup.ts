import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAD_TOKEN_URL, AUTHZ_ROUTE, fakeJwt, TEST_OID, TEST_TID, tokenResponse } from '../helpers/fake-auth.ts';
import { fakeFetch, type FakeRoute } from '../helpers/fake-fetch.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { upsertMessages } from '../../src/store/messages.ts';

export const env = { TEAMSCLI_SECRET_STORE: 'file' };
export const chatService = 'https://chat.example.test';
export const selfId = `8:orgid:${TEST_OID}`;

export function signedInHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-mutation-'));
  mkdirSync(join(home, 'accounts', 'work'), { recursive: true });
  writeFileSync(join(home, 'accounts', 'work', 'refresh_token'), 'synthetic-refresh-value', { mode: 0o600 });
  return home;
}

export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

export function seed(home: string, conversationId: string, kind: 'group' | 'channel', messages: ReturnType<typeof aMessage>[]): void {
  const db = openDatabase(databasePath(home, 'work'));
  try {
    upsertConversations(db, [aConversation({ id: conversationId, kind })]);
    upsertMessages(db, messages);
  } finally {
    db.close();
  }
}

export function authenticatedFetch(routes: FakeRoute[]) {
  const fake = fakeFetch([
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(fakeJwt({ oid: TEST_OID, tid: TEST_TID }), 'synthetic-rotated-value') },
    AUTHZ_ROUTE,
    ...routes,
  ]);
  return { fetch: fake.fetch, calls: fake.calls };
}

export function messagePage(conversationId: string): string {
  const marker = ';messageid=';
  const separator = conversationId.lastIndexOf(marker);
  const path = separator < 0
    ? encodeURIComponent(conversationId)
    : `${encodeURIComponent(conversationId.slice(0, separator))}${marker}${encodeURIComponent(conversationId.slice(separator + marker.length))}`;
  return `${chatService}/v1/users/ME/conversations/${path}/messages?view=msnp24Equivalent&pageSize=200`;
}

export function rawMessage(conversationId: string, id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    messagetype: 'RichText/Html',
    content: '<p>Updated remotely</p>',
    conversationid: conversationId,
    from: `https://chat.example.test/v1/users/ME/contacts/${selfId}`,
    imdisplayname: 'Alex Example',
    composetime: '2026-01-01T10:00:00.000Z',
    version: '1767261700000',
    clientmessageid: '123456789012345678',
    properties: {},
    ...overrides,
  };
}

export function chatCalls(calls: ReturnType<typeof fakeFetch>['calls']) {
  return calls.filter(({ url }) => url.startsWith(chatService));
}
