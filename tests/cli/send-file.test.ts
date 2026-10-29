import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTestCli } from '../helpers/cli.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { setMembers } from '../../src/store/people.ts';
import { authenticatedFetch, chatService, env, messagePage, removeHome, seed, selfId, signedInHome } from './message-mutation-setup.ts';

const chatId = '19:group-files@thread.v2';
const colleague = '8:orgid:00000000-0000-4000-8000-0000000000c1';
const guest = '8:live:guest-example';
const media = 'https://us-api.asm.skype.com/v1/objects';
const csa = 'https://teams.microsoft.com/api/csa/test/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true';
const drive = 'https://contoso-my.sharepoint.com/_api/v2.0/me/drive';
const folder = 'Arquivos de Chat do Microsoft Teams';

function setup(t: { after: (fn: () => void) => void }, kind: 'group' | 'channel' = 'group') {
  const home = signedInHome();
  t.after(() => removeHome(home));
  seed(home, chatId, kind, []);
  const db = openDatabase(databasePath(home, 'work'));
  try {
    setMembers(db, chatId, [selfId, colleague, guest].map((personId) => ({ conversationId: chatId, personId, role: 'User' })));
  } finally {
    db.close();
  }
  const dir = mkdtempSync(join(tmpdir(), 'teamscli-send-file-'));
  t.after(() => removeHome(dir));
  return { home, dir };
}

const sentMessage = (calls: Array<{ method: string; url: string; body: unknown }>) =>
  calls.find((call) => call.method === 'POST' && call.url === `${chatService}/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`)?.body as Record<string, any>;

test('send file sends an image inline through Teams media', async (t) => {
  const { home, dir } = setup(t);
  writeFileSync(join(dir, 'chart.PNG'), 'png-bytes');
  const fake = authenticatedFetch([
    { method: 'POST', url: media, status: 201, json: { id: '0-wus-d1-synthetic' } },
    { method: 'PUT', url: `${media}/0-wus-d1-synthetic/content/imgpsh`, status: 201 },
    { method: 'POST', url: `${chatService}/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`, status: 201, json: {} },
    { url: messagePage(chatId), json: { messages: [], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'send', 'file', '--chat', chatId, '--file', join(dir, 'chart.PNG'), '--message', 'See **this**'], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  const create = fake.calls.find((call) => call.url === media)!;
  assert.equal(create.headers.authorization, 'skype_token test-skypetoken');
  assert.match(create.headers['user-agent']!, / Teams\//);
  assert.deepEqual(create.body, { type: 'pish/image', permissions: { [chatId]: ['read'] }, filename: 'chart.PNG' });
  assert.equal(fake.calls.find((call) => call.method === 'PUT')?.headers['content-type'], 'application/octet-stream');
  const body = sentMessage(fake.calls);
  assert.equal(body.content, '<p>See <strong>this</strong></p><p><img src="https://us-api.asm.skype.com/v1/objects/0-wus-d1-synthetic/views/imgo" itemtype="http://schema.skype.com/AMSImage" itemscope="png" alt="image" id="x_0-wus-d1-synthetic" itemid="0-wus-d1-synthetic"></p>');
  assert.deepEqual(body.amsreferences, ['0-wus-d1-synthetic']);
  assert.ok(!fake.calls.some((call) => call.url.includes('sharepoint')));
});

test('send file uploads other files to OneDrive and shares them with organization members only', async (t) => {
  const { home, dir } = setup(t);
  writeFileSync(join(dir, 'report.pdf'), 'pdf-bytes');
  const item = `${drive}/items/ITEM1`;
  const fake = authenticatedFetch([
    { url: csa, json: { teams: [{ teamSiteInformation: { sharepointSiteUrl: 'https://contoso.sharepoint.com/sites/Example' } }] } },
    { url: `${drive}/root/children?$select=name,folder&$top=999`, json: { value: [{ name: 'Documents', folder: {} }, { name: folder, folder: {} }] } },
    { method: 'PUT', url: `${drive}/root:/${encodeURIComponent(folder)}/report.pdf:/content?@name.conflictBehavior=rename`, status: 201, json: { id: 'ITEM1' } },
    { method: 'POST', url: `${item}/invite`, json: { value: [] } },
    { url: `${item}?$select=id,name,webUrl,sharepointIds`, json: { id: 'ITEM1', name: 'report.pdf', webUrl: 'https://contoso-my.sharepoint.com/personal/alex_example_com/Documents/report.pdf', sharepointIds: { listItemUniqueId: 'aaaaaaaa-0000-4000-8000-000000000001', siteUrl: 'https://contoso-my.sharepoint.com/personal/alex_example_com' } } },
    { method: 'POST', url: `${chatService}/v1/users/ME/conversations/${encodeURIComponent(chatId)}/messages`, status: 201, json: {} },
    { url: messagePage(chatId), json: { messages: [], _metadata: {} } },
  ]);

  const run = await runTestCli(['--store', home, '--account', 'work', '--json', 'send', 'file', '--chat', chatId, '--file', join(dir, 'report.pdf')], { env, fetch: fake.fetch });

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stderr, /1 chat member\(s\) outside your organization/);
  assert.equal(fake.calls.find((call) => call.method === 'PUT')?.headers['content-type'], 'application/octet-stream');
  assert.deepEqual(fake.calls.find((call) => call.url === `${item}/invite`)?.body, {
    recipients: [{ objectId: '00000000-0000-4000-8000-0000000000c1' }], roles: ['read'], requireSignIn: true, sendInvitation: false,
  });
  const body = sentMessage(fake.calls);
  assert.equal(body.content, '');
  const [file] = JSON.parse(body.properties.files);
  assert.equal(file.fileName, 'report.pdf');
  assert.equal(file.fileType, 'pdf');
  assert.equal(file.itemid, 'aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(file.objectUrl, 'https://contoso-my.sharepoint.com/personal/alex_example_com/Documents/report.pdf');
  assert.equal(file.baseUrl, 'https://contoso-my.sharepoint.com/personal/alex_example_com/');
  assert.equal(file.fileInfo.itemId, 'ITEM1');
});

test('send file refuses channels and unreadable files before calling Teams', async (t) => {
  const { home, dir } = setup(t, 'channel');
  writeFileSync(join(dir, 'a.txt'), 'x');
  const fake = authenticatedFetch([]);

  const channel = await runTestCli(['--store', home, '--account', 'work', 'send', 'file', '--chat', chatId, '--file', join(dir, 'a.txt')], { env, fetch: fake.fetch });
  assert.equal(channel.code, 2);
  assert.match(channel.stderr, /chats, group chats and meetings only/);

  const missing = await runTestCli(['--store', home, '--account', 'work', 'send', 'file', '--chat', chatId, '--file', join(dir, 'missing.txt')], { env, fetch: fake.fetch });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /Could not read --file: ENOENT/);
  assert.ok(!fake.calls.some((call) => call.url.startsWith(chatService)));
});
