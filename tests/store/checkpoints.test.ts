import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCheckpoint, listPendingBackfills, upsertCheckpoint } from '../../src/store/checkpoints.ts';
import { openDatabase } from '../../src/store/database.ts';

test('upserts checkpoints and lists only interrupted backfills', () => {
  const db = openDatabase(':memory:');
  const pending = {
    scope: 'chat-1', syncState: null, backwardLink: 'https://chat.example.test/page-2',
    oldestMessageAt: '2026-01-01T00:00:00.000Z', historyComplete: false, updatedAt: '2026-01-02T00:00:00.000Z',
  };
  upsertCheckpoint(db, pending);
  upsertCheckpoint(db, { ...pending, scope: 'chat-2', backwardLink: null, syncState: 'https://chat.example.test/delta' });

  assert.deepEqual(getCheckpoint(db, 'chat-1'), pending);
  assert.deepEqual(listPendingBackfills(db), [pending]);

  const complete = { ...pending, backwardLink: null, syncState: 'https://chat.example.test/final', updatedAt: '2026-01-03T00:00:00.000Z' };
  upsertCheckpoint(db, complete);
  assert.deepEqual(getCheckpoint(db, 'chat-1'), complete);
  assert.deepEqual(listPendingBackfills(db), []);
  assert.equal(getCheckpoint(db, 'missing'), null);
});
