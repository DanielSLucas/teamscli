import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTeam, listTeams, upsertTeams } from '../../src/store/teams.ts';
import { openDatabase } from '../../src/store/database.ts';
import type { Team } from '../../src/models.ts';

const aTeam = (overrides: Partial<Team> = {}): Team => ({ id: 'team-1', name: 'Example Team', description: null, ...overrides });

test('team upsert inserts and updates; list order is stable by name', () => {
  const db = openDatabase(':memory:');
  upsertTeams(db, [aTeam({ id: 'z', name: 'Zulu' }), aTeam({ id: 'a', name: 'Alpha' })]);
  upsertTeams(db, [aTeam({ id: 'a', name: 'Beta', description: 'Updated' })]);

  assert.deepEqual(listTeams(db), [aTeam({ id: 'a', name: 'Beta', description: 'Updated' }), aTeam({ id: 'z', name: 'Zulu' })]);
  assert.equal(getTeam(db, 'a')?.name, 'Beta');
  assert.equal(getTeam(db, 'missing'), null);
  db.close();
});
