import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTestCli } from '../helpers/cli.ts';
import { aConversation } from '../helpers/builders.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { upsertPeople } from '../../src/store/people.ts';
import { authenticatedFetch, chatService, env, removeHome, signedInHome } from './message-mutation-setup.ts';

const page = JSON.parse(readFileSync(new URL('../fixtures/teams/calllogs-page.json', import.meta.url), 'utf8'));
const route = { url: `${chatService}/v1/users/ME/conversations/48%3Acalllogs/messages?view=msnp24Equivalent&pageSize=200`, json: page };

async function calls(args: string[], seed = false) {
  const home = signedInHome();
  try {
    if (seed) {
      const db = openDatabase(databasePath(home, 'work'));
      upsertPeople(db, [{ id: '8:orgid:carol', displayName: 'Carol Example', email: null }]);
      upsertConversations(db, [aConversation({ id: '19:group@thread.v2', title: 'Dev team' })]);
      db.close();
    }
    return await runTestCli(['--store', home, '--account', 'work', ...args], { env, fetch: authenticatedFetch([route]).fetch });
  } finally {
    removeHome(home);
  }
}

test('calls list maps call logs newest first and skips recordings', async () => {
  const run = await calls(['--json', 'calls', 'list']);

  assert.equal(run.code, 0, run.stderr);
  const data = JSON.parse(run.stdout).data;
  assert.deepEqual(data.map((call: { id: string }) => call.id), ['1700000000003', '1700000000001', '1700000000004']);
  assert.deepEqual(data[1], {
    id: '1700000000001',
    callId: 'call-a',
    startAt: '2026-01-02T10:00:00.123Z',
    connectAt: '2026-01-02T10:00:04.000Z',
    endAt: '2026-01-02T10:03:07.999Z',
    durationSeconds: 183, // truncated, as the Teams History list shows it
    direction: 'incoming',
    state: 'accepted',
    isGroup: false,
    isVoicemail: false,
    originator: { id: '8:orgid:bob', name: 'Bob Example' },
    target: { id: '8:orgid:self', name: null },
    participants: [],
    chatId: null,
  });
  assert.equal(data[0].isVoicemail, true);
  assert.equal(data[2].durationSeconds, null);
});

test('calls list filters by direction, state and voicemail', async () => {
  const ids = async (...filter: string[]) => JSON.parse((await calls(['--json', 'calls', 'list', ...filter])).stdout).data.map((call: { id: string }) => call.id);

  assert.deepEqual(await ids('--direction', 'incoming'), ['1700000000001', '1700000000004']);
  assert.deepEqual(await ids('--state', 'missed'), ['1700000000004']);
  assert.deepEqual(await ids('--voicemail'), ['1700000000003']);
  assert.deepEqual(await ids('--limit', '1'), ['1700000000003']);
  assert.equal((await calls(['calls', 'list', '--direction', 'sideways'])).code, 2);
});

test('calls list names the other party and group chat from the local store', async () => {
  const run = await calls(['calls', 'list'], true);

  assert.equal(run.code, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.match(lines[1] ?? '', /out\s+voicemail\s+0m06s\s+Carol Example\s+-$/);
  assert.match(lines[2] ?? '', /in\s+accepted\s+3m03s\s+Bob Example\s+-$/);
  assert.match(lines[3] ?? '', /in\s+missed\s+-\s+Dev team \(from Bob Example\)\s+19:group@thread\.v2$/);
});

test('calls list without a local store lists group participants by id', async () => {
  const run = await calls(['calls', 'list', '--state', 'missed']);

  assert.match(run.stdout, /8:orgid:bob, 8:orgid:carol \(from Bob Example\)/);
});
