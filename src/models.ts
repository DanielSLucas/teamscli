// Domain types shared by teams/, store/, sync/ and cli/. Field names are also the `--json` keys.
// Unknown values are null; timestamps are ISO 8601 UTC strings (see docs/conventions.md).

/** A signed-in identity. Each account has its own directory and database. */
export interface Account {
  /** Local name chosen by the user (`--account`). */
  name: string;
  /** The user's MRI, e.g. `8:orgid:<object id>`. */
  userId: string | null;
  tenantId: string | null;
  /** Teams region discovered at login, e.g. `amer`. */
  region: string | null;
}

/**
 * - chat: one-on-one
 * - group: group chat
 * - meeting: meeting chat
 * - channel: team channel (has `teamId`)
 * - system: Teams-internal streams such as notes (`48:notes`), call logs and mentions
 */
export type ConversationKind = 'chat' | 'group' | 'meeting' | 'channel' | 'system';

export interface Conversation {
  /** Teams thread id, e.g. `19:…@thread.v2`, `19:…@thread.tacv2`, `48:notes`. */
  id: string;
  kind: ConversationKind;
  /** Topic or channel name; null for chats without one (the CLI shows members instead). */
  title: string | null;
  /** Owning team, for channels only; null until the team is known. */
  teamId: string | null;
  lastMessageAt: string | null;
  /** Arrival time of the last message the user has read (Teams `consumptionhorizon`); null when Teams does not report it. */
  readUpTo: string | null;
}

export interface ConversationMember {
  conversationId: string;
  personId: string;
  /** Role as reported by Teams, e.g. `Admin`, `User`. */
  role: string | null;
}

export interface Person {
  /** MRI, e.g. `8:orgid:<object id>`. */
  id: string;
  displayName: string | null;
  email: string | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
}

/** A channel is a conversation of kind `channel`; this narrows the type. */
export type Channel = Conversation & { kind: 'channel' };

export interface Message {
  /** Unique only within its conversation: the key is (conversationId, id). */
  id: string;
  conversationId: string;
  /** Root message id for channel thread replies; null for roots and chat messages. */
  parentId: string | null;
  senderId: string | null;
  senderName: string | null;
  /** Teams `messagetype`, e.g. `Text`, `RichText/Html`, `Event/Call`. */
  type: string;
  /** Content as received (HTML for rich text). Empty when deleted. */
  content: string;
  /** Plain text derived from `content`; what search indexes. */
  text: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Increases on every change (edit, delete, reaction). An older version never overwrites a newer one. */
  version: number;
  /** Id chosen by the sender's client; lets the CLI find a message it just sent. */
  clientMessageId: string | null;
  /** Files attached to the message; inline images stay in `content`. */
  files: MessageFile[];
}

/** A file attached to a message, stored in SharePoint or OneDrive. */
export interface MessageFile {
  name: string;
  /** Extension as Teams reports it, e.g. `pdf`. */
  type: string | null;
  /** SharePoint or OneDrive URL of the file. */
  url: string;
}

/**
 * Sync progress for one scope: the conversation list (`scope: 'conversations'`)
 * or one conversation (`scope: <conversation id>`; Teams ids always contain `:`).
 */
export interface Checkpoint {
  scope: string;
  /** Teams `syncState` URL: returns only what changed since the last call. */
  syncState: string | null;
  /** Next `backwardLink` of an interrupted backfill, to resume it. */
  backwardLink: string | null;
  /** Oldest message time stored, for `history coverage`. */
  oldestMessageAt: string | null;
  /** True once paging reached the first message of the conversation. */
  historyComplete: boolean;
  updatedAt: string;
}
