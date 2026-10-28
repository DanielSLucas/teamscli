import type { DatabaseSync } from 'node:sqlite';
import type { Conversation, ConversationKind } from '../models.ts';
import { transaction } from './database.ts';

// Reference repository: plain functions taking `db`, models in and out, SQL kept here.

export function upsertConversations(db: DatabaseSync, conversations: Conversation[]): void {
  const statement = db.prepare(`
    INSERT INTO conversations (id, kind, title, team_id, last_message_at, read_up_to)
    VALUES (:id, :kind, :title, :teamId, :lastMessageAt, :readUpTo)
    ON CONFLICT (id) DO UPDATE SET
      kind = excluded.kind,
      title = coalesce(excluded.title, conversations.title),
      -- The conversation list may not know the team; keep what the teams sync stored.
      team_id = coalesce(excluded.team_id, conversations.team_id),
      last_message_at = coalesce(excluded.last_message_at, conversations.last_message_at),
      -- Not monotonic: "Mark as unread" in Teams moves it back.
      read_up_to = coalesce(excluded.read_up_to, conversations.read_up_to)
  `);
  transaction(db, () => {
    for (const conversation of conversations) statement.run({ ...conversation });
  });
}

export function getConversation(db: DatabaseSync, id: string): Conversation | null {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  return row ? toConversation(row) : null;
}

export interface ConversationFilter {
  kind?: ConversationKind;
  teamId?: string;
}

/** Most recent activity first; conversations without messages last. */
export function listConversations(db: DatabaseSync, { kind, teamId }: ConversationFilter = {}): Conversation[] {
  const rows = db
    .prepare(`
      SELECT * FROM conversations
      WHERE (:kind IS NULL OR kind = :kind) AND (:teamId IS NULL OR team_id = :teamId)
      ORDER BY last_message_at IS NULL, last_message_at DESC, id
    `)
    .all({ kind: kind ?? null, teamId: teamId ?? null });
  return rows.map(toConversation);
}

function toConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row.id as string,
    kind: row.kind as ConversationKind,
    title: row.title as string | null,
    teamId: row.team_id as string | null,
    lastMessageAt: row.last_message_at as string | null,
    readUpTo: row.read_up_to as string | null,
  };
}
