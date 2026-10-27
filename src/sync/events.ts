import type { ErrorCode } from '../errors.ts';
import type { Conversation, Message } from '../models.ts';

// `--events` contract, documented in docs/events.md. Adding fields or event types is not breaking;
// renaming, removing or changing the meaning of a field is, and bumps `v` in cli/output.ts eventLine.

export interface SyncProgressData {
  /** `conversations`: listing conversations; `messages`: one conversation applied; `done`: a pass finished. */
  phase: 'conversations' | 'messages' | 'done';
  /** The conversation just applied (`messages` phase); null otherwise. */
  conversationId: string | null;
  /** Conversations handled so far in this pass. */
  conversationsDone: number;
  /** Conversations to handle in this pass; null while unknown. */
  conversationsTotal: number | null;
  /** Messages written to the store so far in this pass. */
  messages: number;
}

export interface SyncErrorData {
  code: ErrorCode;
  message: string;
  /** The conversation that failed; null when the failure is not about one conversation. */
  conversationId: string | null;
  /** True when the sync stops after this event; false when it skips or retries and goes on. */
  fatal: boolean;
}

export type SyncEvent =
  | { type: 'message.new'; data: Message }
  | { type: 'message.edited'; data: Message }
  | { type: 'message.deleted'; data: Message }
  | { type: 'conversation.updated'; data: Conversation }
  | { type: 'sync.progress'; data: SyncProgressData }
  | { type: 'sync.error'; data: SyncErrorData };

export type MessageEventType = 'message.new' | 'message.edited' | 'message.deleted';

/** Writes one event through `ctx.emit` (a no-op without `--events`). */
export function emitEvent(emit: (type: string, data: unknown) => void, event: SyncEvent): void {
  emit(event.type, event.data);
}

/**
 * Which event, if any, storing `after` produces, given the stored row `before` (null if absent).
 * Mirrors upsertMessages: an equal or older version changes nothing. A newer version that is not
 * an edit or a delete (reactions also bump `version`) emits nothing in v1.
 */
export function classifyMessageChange(before: Message | null, after: Message): MessageEventType | null {
  if (before === null) return after.deletedAt === null ? 'message.new' : null;
  if (after.version <= before.version || before.deletedAt !== null) return null;
  if (after.deletedAt !== null) return 'message.deleted';
  if (after.editedAt !== before.editedAt || after.content !== before.content) return 'message.edited';
  return null;
}
