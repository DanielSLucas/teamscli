import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTestCli } from '../helpers/cli.ts';
import { aMessage } from '../helpers/builders.ts';
import { getMessage } from '../../src/store/messages.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { chatCalls, chatService, authenticatedFetch, env, messagePage, rawMessage, removeHome, seed, selfId, signedInHome } from './message-mutation-setup.ts';

test('messages delete soft-deletes and stores the re-fetched message', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-delete';
  const id = '1767261600000';
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId, senderId: selfId })]);
  const endpoint = `${chatService}/v1/users/ME/conversations/${chatId}/messages/${id}`;
  const fake = authenticatedFetch([
    { method: 'DELETE', url: `${endpoint}?behavior=softDelete`, status: 200, json: {} },
    { url: messagePage(chatId), json: { messages: [rawMessage(chatId, id, { content: '', version: '1767261700000', properties: { deletetime: 1767261700000 } })], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'delete', id, '--chat', 'Example group', '-y'], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout).data;
  assert.equal(result.deletedAt, '2026-01-01T10:01:40.000Z');
  assert.equal(result.content, '');
  const calls = chatCalls(fake.calls);
  assert.equal(calls[0]?.method, 'DELETE');
  assert.equal(calls[0]?.url, `${endpoint}?behavior=softDelete`);
  const db = openDatabase(databasePath(home, 'work'));
  try {
    assert.equal(getMessage(db, chatId, id)?.deletedAt, result.deletedAt);
  } finally {
    db.close();
  }
});

test('messages delete uses the stored channel conversation id for a reply mutation', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const channelId = '19:channel@example.test';
  const id = 'reply-id';
  seed(home, channelId, 'channel', [aMessage({ id, conversationId: channelId, parentId: 'root-id', senderId: selfId })]);
  const endpoint = `${chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages/${id}?behavior=softDelete`;
  const fake = authenticatedFetch([
    { method: 'DELETE', url: endpoint, status: 200, json: {} },
    { url: messagePage(`${channelId};messageid=root-id`), json: { messages: [rawMessage(channelId, id, { content: '', conversationLink: `https://chat.example.test/v1/users/ME/conversations/${channelId};messageid=root-id`, properties: { deletetime: 1767261700000 } })], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'delete', id, '--chat', channelId, '--yes'], { env, fetch: fake.fetch });
  assert.equal(run.code, 0, run.stderr);
  const calls = chatCalls(fake.calls);
  assert.equal(calls[0]?.url, endpoint);
  assert.equal(calls[1]?.url, messagePage(`${channelId};messageid=root-id`));
});

test('messages delete updates local state if the deleted message is absent from the first page', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-delete-fallback';
  const id = '1767261600001';
  const original = aMessage({ id, conversationId: chatId, senderId: selfId, version: 1767261600000 });
  seed(home, chatId, 'group', [original]);
  const fake = authenticatedFetch([
    { method: 'DELETE', url: `${chatService}/v1/users/ME/conversations/${chatId}/messages/${id}?behavior=softDelete`, status: 200, json: {} },
    { url: messagePage(chatId), json: { messages: [], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'delete', id, '--chat', chatId, '--yes'], { env, fetch: fake.fetch });
  assert.equal(run.code, 0, run.stderr);
  const updated = JSON.parse(run.stdout).data;
  assert.equal(updated.content, '');
  assert.equal(updated.text, '');
  assert.equal(updated.deletedAt, '2026-01-02T03:04:05.000Z');
  assert.ok(updated.version > original.version);
});

test('messages delete renders a plain-text detail and reports missing inputs in order', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-delete-human';
  const id = 'delete-human-id';
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId, senderId: selfId })]);
  const fake = authenticatedFetch([
    { method: 'DELETE', url: `${chatService}/v1/users/ME/conversations/${chatId}/messages/${id}?behavior=softDelete`, status: 200, json: {} },
    { url: messagePage(chatId), json: { messages: [rawMessage(chatId, id, { content: '', properties: { deletetime: 1767261700000 } })], _metadata: {} } },
  ]);

  const deleted = await runTestCli(['--store', home, '--account', 'work', 'messages', 'delete', id, '--chat', chatId, '-y'], { env, fetch: fake.fetch });
  assert.equal(deleted.code, 0, deleted.stderr);
  assert.match(deleted.stdout, /text\s+\[deleted\]/);
  assert.doesNotMatch(deleted.stdout, /<p>|<\/p>/);

  for (const [args, expected] of [
    [['messages', 'delete'], 'Missing the message ID: pass it after the command.'],
    [['messages', 'delete', id], 'Missing --chat: the chat containing the message (id, short id or name).'],
    [['messages', 'delete', id, '--chat', chatId], 'Missing --yes: confirm deleting the message.'],
  ] as const) {
    const run = await runTestCli(['--store', home, ...args]);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(run.stderr, 'teamscli: ' + expected + '\n');
  }
});

test('messages delete requires --yes and refuses another sender', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-delete-owner';
  seed(home, chatId, 'group', [aMessage({ id: 'other-id', conversationId: chatId, senderId: '8:orgid:someone-else' })]);
  let calls = 0;
  const noConfirm = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'delete', 'other-id', '--chat', chatId], {
    fetch: async () => { calls++; throw new Error('unexpected fetch'); },
  });
  assert.equal(noConfirm.code, 2);
  assert.equal(JSON.parse(noConfirm.stdout).error.code, 'usage');
  assert.equal(calls, 0);

  const fake = authenticatedFetch([]);
  const foreign = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'delete', 'other-id', '--chat', chatId, '--yes'], { env, fetch: fake.fetch });
  assert.equal(foreign.code, 2);
  assert.equal(JSON.parse(foreign.stdout).error.code, 'usage');
  assert.equal(chatCalls(fake.calls).length, 0);
});
