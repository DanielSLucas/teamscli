import type { DatabaseSync } from 'node:sqlite';
import type { Message, MessageFile, Quote, Reaction } from '../models.ts';

/** Columns for `toMessage` from `messages m`; resolves forwarded sender and reaction user names at read time, since people are learned after messages. */
export const MESSAGE_COLUMNS = `m.*, (SELECT display_name FROM people WHERE id = m.forwarded_from_id) AS forwarded_from_name,
  (SELECT json_group_object(p.id, p.display_name) FROM people p WHERE p.id IN (
    SELECT json_extract(u.value, '$.id') FROM json_each(m.reactions) r, json_each(r.value, '$.users') u)) AS reaction_names`;
import { transaction } from './database.ts';

export interface MessageFilter {
  conversationId: string;
  limit: number;
  before?: string;
  after?: string;
}

export interface HistoryCoverage {
  id: string;
  title: string | null;
  messages: number;
  oldestMessageAt: string | null;
  newestMessageAt: string | null;
  historyComplete: boolean;
  syncStatePresent: boolean;
}

/** Coverage for synchronized conversations, or for one requested local conversation. */
export function listHistoryCoverage(db: DatabaseSync, conversationId?: string): HistoryCoverage[] {
  return db.prepare(`
    SELECT c.id, c.title, count(m.id) AS messages,
      min(m.created_at) AS oldest_message_at, max(m.created_at) AS newest_message_at,
      coalesce(cp.history_complete, 0) AS history_complete,
      (cp.sync_state IS NOT NULL) AS sync_state_present
    FROM conversations c
    LEFT JOIN checkpoints cp ON cp.scope = c.id
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE (:conversationId IS NOT NULL AND c.id = :conversationId)
       OR (:conversationId IS NULL AND cp.scope IS NOT NULL)
    GROUP BY c.id
    ORDER BY c.title IS NULL, c.title COLLATE NOCASE, c.id
  `).all({ conversationId: conversationId ?? null }).map((row) => ({
    id: row.id as string,
    title: row.title as string | null,
    messages: row.messages as number,
    oldestMessageAt: row.oldest_message_at as string | null,
    newestMessageAt: row.newest_message_at as string | null,
    historyComplete: row.history_complete === 1,
    syncStatePresent: row.sync_state_present === 1,
  }));
}

export function upsertMessages(db: DatabaseSync, messages: Message[]): void {
  transaction(db, () => upsertMessagesInTransaction(db, messages));
}

/** Caller owns the surrounding transaction. */
export function upsertMessagesInTransaction(db: DatabaseSync, messages: Message[]): void {
  const statement = db.prepare(`
    INSERT INTO messages (conversation_id, id, parent_id, sender_id, sender_name, type, content, text,
      created_at, edited_at, deleted_at, version, client_message_id, files, forwarded_from_id, forwarded_sent_at, reactions, quote)
    VALUES (:conversationId, :id, :parentId, :senderId, :senderName, :type, :content, :text,
      :createdAt, :editedAt, :deletedAt, :version, :clientMessageId, :files, :forwardedFromId, :forwardedSentAt, :reactions, :quote)
    ON CONFLICT (conversation_id, id) DO UPDATE SET
      parent_id = excluded.parent_id,
      sender_id = excluded.sender_id,
      sender_name = coalesce(excluded.sender_name, messages.sender_name),
      type = excluded.type,
      content = excluded.content,
      text = excluded.text,
      created_at = excluded.created_at,
      edited_at = coalesce(excluded.edited_at, messages.edited_at),
      deleted_at = excluded.deleted_at,
      version = excluded.version,
      client_message_id = excluded.client_message_id,
      files = excluded.files,
      forwarded_from_id = excluded.forwarded_from_id,
      forwarded_sent_at = excluded.forwarded_sent_at,
      reactions = excluded.reactions,
      quote = excluded.quote
    WHERE excluded.version >= messages.version
  `);
  for (const { forwardedFrom, reactions, quote, ...message } of messages) {
    statement.run({
      ...message,
      files: JSON.stringify(message.files),
      forwardedFromId: forwardedFrom?.senderId ?? null,
      forwardedSentAt: forwardedFrom?.sentAt ?? null,
      quote: quote ? JSON.stringify(quote) : null,
      reactions: JSON.stringify(reactions.map(({ users, ...reaction }) => ({ ...reaction, users: users.map(({ id, reactedAt }) => ({ id, reactedAt })) }))),
    });
  }
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
        SELECT ${MESSAGE_COLUMNS} FROM messages m
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

// Unread: after the conversation's read horizon, not sent by the user, and something a person would read.
// shortcut: chats, group chats and meetings only; channels need their horizon validated first.
const UNREAD = `
  m.conversation_id = c.id
  AND c.kind IN ('chat', 'group', 'meeting')
  AND m.created_at > c.read_up_to
  AND m.deleted_at IS NULL
  AND m.type IN ('Text', 'RichText/Html', 'RichText/Media_Card')
  AND (:selfId IS NULL OR m.sender_id IS NOT :selfId)
`;

/** Unread message count per conversation; conversations with none are absent. */
export function countUnread(db: DatabaseSync, selfId: string | null): Map<string, number> {
  const rows = db
    .prepare(`SELECT m.conversation_id AS id, count(*) AS unread FROM messages m, conversations c WHERE ${UNREAD} GROUP BY m.conversation_id`)
    .all({ selfId });
  return new Map(rows.map((row) => [row.id as string, Number(row.unread)]));
}

/** Like `listMessages`, restricted to unread messages, across all conversations when `conversationId` is omitted. */
export function listUnreadMessages(
  db: DatabaseSync,
  { conversationId, selfId, limit, before, after }: Omit<MessageFilter, 'conversationId'> & { conversationId?: string; selfId: string | null },
): Message[] {
  const rows = db
    .prepare(`
      SELECT * FROM (
        SELECT ${MESSAGE_COLUMNS} FROM messages m, conversations c
        WHERE ${UNREAD}
          AND (:conversationId IS NULL OR m.conversation_id = :conversationId)
          AND (:before IS NULL OR m.created_at < :before)
          AND (:after IS NULL OR m.created_at > :after)
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT :limit
      )
      ORDER BY created_at, id
    `)
    .all({ conversationId: conversationId ?? null, selfId, limit, before: before ?? null, after: after ?? null });
  return rows.map(toMessage);
}

export function getMessage(db: DatabaseSync, conversationId: string, id: string): Message | null {
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m WHERE conversation_id = ? AND id = ?`).get(conversationId, id);
  return row ? toMessage(row) : null;
}

/** Returns a root and its direct replies in chronological order. */
export function listThread(db: DatabaseSync, conversationId: string, rootId: string): Message[] {
  const rows = db
    .prepare(`
      SELECT ${MESSAGE_COLUMNS} FROM messages m
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
    files: JSON.parse(row.files as string) as MessageFile[],
    forwardedFrom: typeof row.forwarded_from_id === 'string'
      ? { senderId: row.forwarded_from_id, senderName: (row.forwarded_from_name as string | null | undefined) ?? null, sentAt: row.forwarded_sent_at as string | null }
      : null,
    reactions: toReactions(row),
    quote: typeof row.quote === 'string' ? JSON.parse(row.quote) as Quote : null,
  };
}

function toReactions(row: Record<string, unknown>): Reaction[] {
  const names = JSON.parse((row.reaction_names as string | null | undefined) ?? '{}') as Record<string, string | null>;
  const stored = JSON.parse(row.reactions as string) as { key: string; emoji: string | null; users: { id: string; reactedAt: string | null }[] }[];
  return stored.map((reaction) => ({ ...reaction, users: reaction.users.map((user) => ({ ...user, name: names[user.id] ?? null })) }));
}
