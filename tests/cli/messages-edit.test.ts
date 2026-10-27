import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTestCli } from '../helpers/cli.ts';
import { aMessage } from '../helpers/builders.ts';
import { getMessage } from '../../src/store/messages.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { shortId } from '../../src/store/resolve.ts';
import { chatCalls, chatService, authenticatedFetch, env, messagePage, rawMessage, removeHome, seed, selfId, signedInHome } from './message-mutation-setup.ts';

test('messages edit sends escaped rich text and stores the re-fetched message', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-edit';
  const id = '1767261600000';
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId, senderId: selfId })]);
  const endpoint = `${chatService}/v1/users/ME/conversations/${chatId}/messages/${id}`;
  const fake = authenticatedFetch([
    { method: 'PUT', url: endpoint, status: 200, json: {} },
    { url: messagePage(chatId), json: { messages: [rawMessage(chatId, id, { properties: { edittime: 1767261700000 } })], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'edit', id, '--chat', shortId(chatId), '--message', '<script>updated</script>'], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  const result = JSON.parse(run.stdout).data;
  assert.equal(result.editedAt, '2026-01-01T10:01:40.000Z');
  assert.equal(result.text, 'Updated remotely');
  const calls = chatCalls(fake.calls);
  assert.equal(calls[0]?.method, 'PUT');
  const body = calls[0]?.body as Record<string, unknown>;
  assert.equal(body.content, '<p>&lt;script&gt;updated&lt;/script&gt;</p>');
  assert.match(String(body.clientmessageid), /^\d+$/);
  assert.doesNotMatch(String(body.content), /<script/);
  const db = openDatabase(databasePath(home, 'work'));
  try {
    assert.equal(getMessage(db, chatId, id)?.editedAt, result.editedAt);
  } finally {
    db.close();
  }
});

test('messages edit uses the stored channel conversation id for a reply mutation', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const channelId = '19:channel@example.test';
  const id = 'reply-id';
  seed(home, channelId, 'channel', [aMessage({ id, conversationId: channelId, parentId: 'root-id', senderId: selfId })]);
  const endpoint = `${chatService}/v1/users/ME/conversations/${encodeURIComponent(channelId)}/messages/${id}`;
  const fake = authenticatedFetch([
    { method: 'PUT', url: endpoint, status: 200, json: {} },
    { url: messagePage(`${channelId};messageid=root-id`), json: { messages: [rawMessage(channelId, id, { conversationLink: `https://chat.example.test/v1/users/ME/conversations/${channelId};messageid=root-id` })], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'edit', id, '--chat', channelId, '--message', 'Edited reply'], { env, fetch: fake.fetch });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(chatCalls(fake.calls)[0]?.url, endpoint);
  assert.equal(chatCalls(fake.calls)[1]?.url, messagePage(`${channelId};messageid=root-id`));
});

test('messages edit updates local content when the changed message is absent from the first page', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-edit-fallback';
  const id = '1767261600001';
  const original = aMessage({ id, conversationId: chatId, senderId: selfId, version: 1767261600000, content: 'Before', text: 'Before' });
  seed(home, chatId, 'group', [original]);
  const fake = authenticatedFetch([
    { method: 'PUT', url: `${chatService}/v1/users/ME/conversations/${chatId}/messages/${id}`, status: 200, json: {} },
    { url: messagePage(chatId), json: { messages: [], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'edit', id, '--chat', chatId, '--message', '<fallback>'], { env, fetch: fake.fetch });
  assert.equal(run.code, 0, run.stderr);
  const updated = JSON.parse(run.stdout).data;
  assert.equal(updated.content, '<p>&lt;fallback&gt;</p>');
  assert.equal(updated.text, '<fallback>');
  assert.ok(updated.editedAt);
  assert.ok(updated.version > original.version);
});

test('messages edit refuses another sender and a message absent from local data', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  const chatId = 'chat-edit-owner';
  seed(home, chatId, 'group', [aMessage({ id: 'other-id', conversationId: chatId, senderId: '8:orgid:someone-else' })]);
  const fake = authenticatedFetch([]);

  const foreign = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'edit', 'other-id', '--chat', chatId, '--message', 'Synthetic'], { env, fetch: fake.fetch });
  const missing = await runTestCli(['--store', home, '--account', 'work', '--json', 'messages', 'edit', 'missing-id', '--chat', chatId, '--message', 'Synthetic'], { env, fetch: fake.fetch });
  assert.equal(foreign.code, 2);
  assert.equal(JSON.parse(foreign.stdout).error.code, 'usage');
  assert.equal(missing.code, 2);
  assert.equal(JSON.parse(missing.stdout).error.code, 'usage');
  assert.equal(chatCalls(fake.calls).length, 0);
});
