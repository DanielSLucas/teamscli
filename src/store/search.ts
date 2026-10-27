import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '../models.ts';

export interface SearchMessagesOptions {
  conversationId?: string;
  from?: string;
  after?: string;
  before?: string;
  limit: number;
}

export interface SearchMessage {
  message: Message;
  snippet: string;
  rank: number;
}

/** Search message text offline; user input is always treated as quoted FTS terms. */
export function searchMessages(db: DatabaseSync, query: string, options: SearchMessagesOptions): SearchMessage[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ');
  const rows = db
    .prepare(`
      SELECT
        m.id, m.conversation_id AS conversationId, m.parent_id AS parentId,
        m.sender_id AS senderId, m.sender_name AS senderName, m.type, m.content, m.text,
        m.created_at AS createdAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt,
        m.version, m.client_message_id AS clientMessageId,
        snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet,
        bm25(messages_fts) AS rank
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      WHERE messages_fts MATCH :match
        AND m.deleted_at IS NULL
        AND (:conversationId IS NULL OR m.conversation_id = :conversationId)
        AND (:from IS NULL OR m.sender_id = :from OR instr(lower(coalesce(m.sender_name, '')), lower(:from)) > 0)
        AND (:after IS NULL OR m.created_at > :after)
        AND (:before IS NULL OR m.created_at < :before)
      ORDER BY rank, m.created_at DESC
      LIMIT :limit
    `)
    .all({
      match,
      conversationId: options.conversationId ?? null,
      from: options.from ?? null,
      after: options.after ?? null,
      before: options.before ?? null,
      limit: options.limit,
    });

  return rows.map((row) => ({
    message: {
      id: row.id as string,
      conversationId: row.conversationId as string,
      parentId: row.parentId as string | null,
      senderId: row.senderId as string | null,
      senderName: row.senderName as string | null,
      type: row.type as string,
      content: row.content as string,
      text: row.text as string,
      createdAt: row.createdAt as string,
      editedAt: row.editedAt as string | null,
      deletedAt: row.deletedAt as string | null,
      version: row.version as number,
      clientMessageId: row.clientMessageId as string | null,
    },
    snippet: row.snippet as string,
    rank: row.rank as number,
  }));
}
