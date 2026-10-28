import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertTeams } from '../../src/store/teams.ts';
import { shortId } from '../../src/store/resolve.ts';
import { aConversation } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

test('channels list filters by team and includes team names', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const db = openDatabase(databasePath(home, 'default'));
  upsertTeams(db, [
    { id: 'team-a', name: 'Alpha Team', description: null },
    { id: 'team-b', name: 'Beta Team', description: null },
  ]);
  upsertConversations(db, [
    aConversation({ id: 'channel-a', kind: 'channel', title: 'Announcements', teamId: 'team-a' }),
    aConversation({ id: 'channel-b', kind: 'channel', title: 'General', teamId: 'team-b' }),
    aConversation({ id: 'group-1', kind: 'group', title: 'Example group' }),
  ]);
  db.close();

  const filtered = await runTestCli(['--store', home, '--read-only', '--json', 'channels', 'list', '--team', 'team-a']);
  assert.equal(filtered.code, 0, filtered.stdout);
  assert.deepEqual(JSON.parse(filtered.stdout).data, [{
    id: 'channel-a',
    kind: 'channel',
    title: 'Announcements',
    teamId: 'team-a',
    lastMessageAt: '2026-01-01T10:00:00.000Z',
    readUpTo: null,
    shortId: shortId('channel-a'),
    teamName: 'Alpha Team',
  }]);

  const all = await runTestCli(['--store', home, 'channels', 'list']);
  assert.equal(all.code, 0, all.stderr);
  assert.match(all.stdout, /shortId/);
  assert.match(all.stdout, new RegExp(shortId('channel-a')));
  assert.match(all.stdout, /Alpha Team/);
  assert.match(all.stdout, /Beta Team/);
  assert.doesNotMatch(all.stdout, /channel-a|channel-b/);
  assert.doesNotMatch(all.stdout, /Example group/);
});
