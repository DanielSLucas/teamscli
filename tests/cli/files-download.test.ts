import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runTestCli } from '../helpers/cli.ts';
import { aMessage } from '../helpers/builders.ts';
import { AAD_TOKEN_URL } from '../helpers/fake-auth.ts';
import { authenticatedFetch, env, removeHome, seed, signedInHome } from './message-mutation-setup.ts';

const chatId = 'chat-files';
const id = '1767261600000';
const imageUrl = 'https://us-api.asm.skype.com/v1/objects/0-wus-d1-synthetic/views/imgo';
const fileUrl = 'https://contoso-my.sharepoint.com/personal/alice_example_com/Documents/report.pdf';
const sharesUrl = `https://contoso-my.sharepoint.com/_api/v2.0/shares/u!${Buffer.from(fileUrl).toString('base64url')}/driveItem`;
const imageHtml = (src: string) => `<p>Look <img src="${src}" itemtype="http://schema.skype.com/AMSImage" alt="image"></p>`;

test('files download saves inline images and attached files with the right credentials', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId, content: imageHtml(imageUrl), files: [{ name: '../report.pdf', type: 'pdf', url: fileUrl }] })]);
  const fake = authenticatedFetch([
    { url: imageUrl, json: 'png-bytes', headers: { 'content-type': 'image/png' } },
    { url: sharesUrl, json: { '@content.downloadUrl': 'https://contoso-my.sharepoint.com/download.aspx?tempauth=synthetic' } },
    { url: 'https://contoso-my.sharepoint.com/download.aspx?tempauth=synthetic', json: 'pdf-bytes', headers: { 'content-type': 'application/pdf' } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'files', 'download', id, '--chat', chatId], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  const dir = join(home, 'accounts', 'work', 'media', id);
  assert.deepEqual(JSON.parse(run.stdout).data, [
    { path: join(dir, 'image-1.png'), bytes: 11, contentType: 'image/png' },
    { path: join(dir, 'report.pdf'), bytes: 11, contentType: 'application/pdf' },
  ]);
  assert.equal(readFileSync(join(dir, 'report.pdf'), 'utf8'), '"pdf-bytes"');
  assert.equal(statSync(join(dir, 'report.pdf')).mode & 0o777, 0o600);
  assert.equal(fake.calls.find((call) => call.url === imageUrl)?.headers.authorization, 'skype_token test-skypetoken');
  assert.match(String(fake.calls.find((call) => call.url === sharesUrl)?.headers.authorization), /^Bearer /);
  assert.ok(fake.calls.some((call) => call.url === AAD_TOKEN_URL && String(call.body).includes(encodeURIComponent('https://contoso-my.sharepoint.com/.default'))));

  const again = await runTestCli(['--store', home, '--account', 'work', 'files', 'download', id, '--chat', chatId], { env, fetch: fake.fetch });
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /already exists/);
});

test('files download never sends credentials to a host taken from untrusted content', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId, content: imageHtml('https://evil.example.com/v1/objects/x/views/imgo') })]);
  const fake = authenticatedFetch([]);

  const run = await runTestCli(['--store', home, '--account', 'work', 'files', 'download', id, '--chat', chatId], { env, fetch: fake.fetch });

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /unexpected host/);
  assert.ok(!fake.calls.some((call) => call.url.includes('evil.example.com')));
});

test('files download reports a message without attachments', async (t) => {
  const home = signedInHome();
  t.after(() => removeHome(home));
  seed(home, chatId, 'group', [aMessage({ id, conversationId: chatId })]);

  const run = await runTestCli(['--store', home, '--account', 'work', 'files', 'download', id, '--chat', chatId], { env, fetch: authenticatedFetch([]).fetch });

  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /no images or files/);
});
