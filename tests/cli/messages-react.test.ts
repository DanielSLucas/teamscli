import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTestCli } from '../helpers/cli.ts';
import { aMessage } from '../helpers/builders.ts';
import { chatCalls, chatService, authenticatedFetch, env, messagePage, rawMessage, removeHome, seed, selfId, signedInHome } from './message-mutation-setup.ts';

const chatId = 'chat-react';
const id = '1767261600000';
const endpoint = `${chatService}/v1/users/ME/conversations/${chatId}/messages/${id}/properties?name=emotions`;

test('messages react puts the reaction key and stores the re-fetched reactions', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId })]);
  const emotions = [{ key: 'fire', users: [{ mri: selfId, time: 1767261700000, value: '1767261700000' }] }];
  const fake = authenticatedFetch([
    { method: 'PUT', url: endpoint, status: 200, json: 200 },
    { url: messagePage(chatId), json: { messages: [rawMessage(chatId, id, { properties: { emotions } })], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'react', id, '--chat', chatId, '--emoji', '🔥'], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).data.reactions, [{ key: 'fire', emoji: '🔥', users: [{ id: selfId, name: null, reactedAt: '2026-01-01T10:01:40.000Z' }] }]);
  const put = chatCalls(fake.calls)[0];
  assert.equal(put?.method, 'PUT');
  assert.equal(put?.url, endpoint);
  assert.equal((put?.body as { emotions: { key: string } }).emotions.key, 'fire');
});

test('messages react --remove deletes the key and updates local state when the message is not on the first page', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const reactions = [{ key: 'like', emoji: '👍', users: [{ id: selfId, name: null, reactedAt: '2026-01-01T10:00:00.000Z' }] }];
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId, reactions })]);
  const fake = authenticatedFetch([
    { method: 'DELETE', url: endpoint, status: 200, json: null },
    { url: messagePage(chatId), json: { messages: [], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'react', id, '--chat', chatId, '--remove'], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).data.reactions, []);
  const call = chatCalls(fake.calls)[0];
  assert.equal(call?.method, 'DELETE');
  assert.deepEqual(call?.body, { emotions: { key: 'like' } });
});

test('messages react rejects an unknown emoji before calling Teams', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId })]);
  const fake = authenticatedFetch([]);

  const run = await runTestCli(['--store', home, '--account', 'work', 'messages', 'react', id, '--chat', chatId, '--emoji', 'not-an-emoji'], { env, fetch: fake.fetch });

  assert.equal(run.code, 2);
  assert.match(run.stderr, /Unknown --emoji/);
  assert.equal(chatCalls(fake.calls).length, 0);
});
