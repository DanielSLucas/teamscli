import type { DatabaseSync } from 'node:sqlite';
import type { Checkpoint } from '../models.ts';
import { transaction } from './database.ts';

export function getCheckpoint(db: DatabaseSync, scope: string): Checkpoint | null {
  const row = db.prepare('SELECT * FROM checkpoints WHERE scope = ?').get(scope);
  return row ? toCheckpoint(row) : null;
}

export function listPendingBackfills(db: DatabaseSync): Checkpoint[] {
  return db.prepare('SELECT * FROM checkpoints WHERE backward_link IS NOT NULL ORDER BY scope').all().map(toCheckpoint);
}

export function upsertCheckpoint(db: DatabaseSync, checkpoint: Checkpoint): void {
  transaction(db, () => upsertCheckpointInTransaction(db, checkpoint));
}

/** Caller owns the surrounding transaction. */
export function upsertCheckpointInTransaction(db: DatabaseSync, checkpoint: Checkpoint): void {
  db.prepare(`
    INSERT INTO checkpoints (scope, sync_state, backward_link, oldest_message_at, history_complete, updated_at)
    VALUES (:scope, :syncState, :backwardLink, :oldestMessageAt, :historyComplete, :updatedAt)
    ON CONFLICT (scope) DO UPDATE SET
      sync_state = excluded.sync_state,
      backward_link = excluded.backward_link,
      oldest_message_at = excluded.oldest_message_at,
      history_complete = excluded.history_complete,
      updated_at = excluded.updated_at
  `).run({ ...checkpoint, historyComplete: Number(checkpoint.historyComplete) });
}

function toCheckpoint(row: Record<string, unknown>): Checkpoint {
  return {
    scope: row.scope as string,
    syncState: row.sync_state as string | null,
    backwardLink: row.backward_link as string | null,
    oldestMessageAt: row.oldest_message_at as string | null,
    historyComplete: row.history_complete === 1,
    updatedAt: row.updated_at as string,
  };
}
