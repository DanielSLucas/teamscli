import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CliError } from '../errors.ts';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export interface OpenOptions {
  /** Never writes: no file creation, no migration. Use it for every command with `mutates: false`. */
  readOnly?: boolean;
}

/**
 * Opens an account database (or `:memory:` in tests), in WAL mode with a busy timeout so a
 * running sync and other commands can share it. Writable opens create the file and apply
 * pending migrations; read-only opens fail if the file is missing or not migrated.
 */
export function openDatabase(path: string, { readOnly = false }: OpenOptions = {}): DatabaseSync {
  const memory = path === ':memory:';
  if (readOnly && !memory && !existsSync(path)) {
    throw new CliError('not_found', 'No local data for this account yet. Run "teamscli sync" first.');
  }
  if (!readOnly && !memory) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const db = new DatabaseSync(path, { readOnly, timeout: 5000, enableForeignKeyConstraints: true });
  try {
    const current = userVersion(db);
    const pending = migrations().filter((migration) => migration.version > current);
    const latest = migrations().at(-1)?.version ?? 0;
    if (current > latest) {
      throw new CliError('usage', 'The local data was written by a newer teamscli. Upgrade teamscli.');
    }
    if (readOnly) {
      if (pending.length > 0) throw new CliError('usage', 'The local data needs an upgrade. Run "teamscli sync" first.');
    } else {
      if (!memory) db.exec('PRAGMA journal_mode = WAL');
      for (const migration of pending) {
        transaction(db, () => {
          db.exec(migration.sql);
          db.exec(`PRAGMA user_version = ${migration.version}`);
        });
      }
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Runs `fn` in one write transaction; rolls back if it throws. Not reentrant. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** `migrations/NNN_name.sql`, applied in order; NNN becomes `PRAGMA user_version`. */
export function migrations(): { version: number; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => ({ version: Number.parseInt(file, 10), sql: readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8') }));
}

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
}
