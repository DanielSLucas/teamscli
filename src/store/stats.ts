import type { DatabaseSync } from 'node:sqlite';

export interface StoreStats {
  conversations: number;
  messages: number;
  people: number;
  oldestMessageAt: string | null;
  newestMessageAt: string | null;
}

export function storeStats(db: DatabaseSync): StoreStats {
  return db
    .prepare(`
      SELECT
        (SELECT count(*) FROM conversations) AS conversations,
        (SELECT count(*) FROM messages) AS messages,
        (SELECT count(*) FROM people) AS people,
        (SELECT min(created_at) FROM messages) AS oldestMessageAt,
        (SELECT max(created_at) FROM messages) AS newestMessageAt
    `)
    .get() as unknown as StoreStats;
}
