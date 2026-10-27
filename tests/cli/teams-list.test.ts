import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertTeams } from '../../src/store/teams.ts';
import { runTestCli } from '../helpers/cli.ts';

test('teams list reads teams from the selected local store', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const db = openDatabase(databasePath(home, 'default'));
  upsertTeams(db, [
    { id: 'team-b', name: 'Beta Team', description: null },
    { id: 'team-a', name: 'Alpha Team', description: 'Example team' },
  ]);
  db.close();

  const run = await runTestCli(['--store', home, '--read-only', '--json', 'teams', 'list']);
  assert.equal(run.code, 0, run.stdout);
  assert.deepEqual(JSON.parse(run.stdout).data, [
    { id: 'team-a', name: 'Alpha Team', description: 'Example team' },
    { id: 'team-b', name: 'Beta Team', description: null },
  ]);
});
