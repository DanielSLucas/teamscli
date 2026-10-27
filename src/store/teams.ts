import type { DatabaseSync } from 'node:sqlite';
import type { Team } from '../models.ts';
import { transaction } from './database.ts';

export function upsertTeams(db: DatabaseSync, teams: Team[]): void {
  const statement = db.prepare(`
    INSERT INTO teams (id, name, description)
    VALUES (:id, :name, :description)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description
  `);
  transaction(db, () => {
    for (const team of teams) statement.run({ ...team });
  });
}

export function listTeams(db: DatabaseSync): Team[] {
  return db
    .prepare('SELECT id, name, description FROM teams ORDER BY name COLLATE NOCASE, id')
    .all()
    .map(toTeam);
}

export function getTeam(db: DatabaseSync, id: string): Team | null {
  const row = db.prepare('SELECT id, name, description FROM teams WHERE id = ?').get(id);
  return row ? toTeam(row) : null;
}

function toTeam(row: Record<string, unknown>): Team {
  return { id: row.id as string, name: row.name as string, description: row.description as string | null };
}
