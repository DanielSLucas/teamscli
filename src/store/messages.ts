import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '../models.ts';
import { transaction } from './database.ts';

export interface MessageFilter {
  conversationId: string;
  limit: number;
  before?: string;
  after?: string;
}

export function upsertMessages(db: DatabaseSync, messages: Message[]): void {
  transaction(db, () => upsertMessagesInTransaction(db, messages));
}

/** Caller owns the surrounding transaction. */
export function upsertMessagesInTransaction(db: DatabaseSync, messages: Message[]): void {
  const statement = db.prepare(`
    INSERT INTO messages (conversation_id, id, parent_id, sender_id, sender_name, type, content, text,
      created_at, edited_at, deleted_at, version, client_message_id)
    VALUES (:conversationId, :id, :parentId, :senderId, :senderName, :type, :content, :text,
      :createdAt, :editedAt, :deletedAt, :version, :clientMessageId)
    ON CONFLICT (conversation_id, id) DO UPDATE SET
      parent_id = excluded.parent_id,
      sender_id = excluded.sender_id,
      sender_name = excluded.sender_name,
      type = excluded.type,
      content = excluded.content,
      text = excluded.text,
      created_at = excluded.created_at,
      edited_at = excluded.edited_at,
      deleted_at = excluded.deleted_at,
      version = excluded.version,
      client_message_id = excluded.client_message_id
    WHERE excluded.version >= messages.version
  `);
  for (const message of messages) statement.run({ ...message });
}

export function oldestMessageAt(db: DatabaseSync, conversationId: string): string | null {
  const row = db.prepare('SELECT min(created_at) AS oldest FROM messages WHERE conversation_id = ?').get(conversationId);
  return row?.oldest as string | null;
}

/** Returns the most recent matching messages in chronological order. */
export function listMessages(db: DatabaseSync, { conversationId, limit, before, after }: MessageFilter): Message[] {
  const rows = db
    .prepare(`
      SELECT * FROM (
        SELECT * FROM messages
        WHERE conversation_id = :conversationId
          AND (:before IS NULL OR created_at < :before)
          AND (:after IS NULL OR created_at > :after)
        ORDER BY created_at DESC, id DESC
        LIMIT :limit
      )
      ORDER BY created_at, id
    `)
    .all({ conversationId, limit, before: before ?? null, after: after ?? null });
  return rows.map(toMessage);
}

export function getMessage(db: DatabaseSync, conversationId: string, id: string): Message | null {
  const row = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id = ?').get(conversationId, id);
  return row ? toMessage(row) : null;
}

/** Returns a root and its direct replies in chronological order. */
export function listThread(db: DatabaseSync, conversationId: string, rootId: string): Message[] {
  const rows = db
    .prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ? AND (id = ? OR parent_id = ?)
      ORDER BY created_at, id
    `)
    .all(conversationId, rootId, rootId);
  return rows.map(toMessage);
}

export function toMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    parentId: row.parent_id as string | null,
    senderId: row.sender_id as string | null,
    senderName: row.sender_name as string | null,
    type: row.type as string,
    content: row.content as string,
    text: row.text as string,
    createdAt: row.created_at as string,
    editedAt: row.edited_at as string | null,
    deletedAt: row.deleted_at as string | null,
    version: row.version as number,
    clientMessageId: row.client_message_id as string | null,
  };
}
