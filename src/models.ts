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
  /** Origin of a forwarded message; `senderName` comes from the local people table when known. */
  forwardedFrom: ForwardedFrom | null;
  /** Reactions with at least one user; user names come from the local people table when known. */
  reactions: Reaction[];
  /** Message this one replies to with a quote; its preview is not part of `text`. */
  quote: Quote | null;
}

export interface Quote {
  /** Id of the quoted message in the same conversation. */
  id: string;
  senderId: string | null;
  senderName: string | null;
  /** Preview of the quoted message, as the sender's client wrote it. */
  text: string;
}

export interface Reaction {
  /** Teams reaction key: `heart`, `1f440_eyes`, or `<name>;<id>` for an organization's custom emoji. */
  key: string;
  /** Unicode emoji for the key; null for custom emoji and keys missing from the catalog. */
  emoji: string | null;
  users: ReactionUser[];
}

export interface ReactionUser {
  id: string;
  name: string | null;
  reactedAt: string | null;
}

export interface ForwardedFrom {
  senderId: string;
  senderName: string | null;
  sentAt: string | null;
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

/** Your answer to a calendar event; `organizer` when you organize it. */
export type CalendarResponse = 'accepted' | 'tentative' | 'declined' | 'none' | 'organizer';

export interface CalendarPerson {
  name: string | null;
  email: string | null;
}

/** An event of the user's Outlook calendar, as the Teams Calendar app shows it. */
export interface CalendarEvent {
  /** Outlook item id; pass it to `calendar show` and `calendar rsvp`. */
  id: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  organizer: CalendarPerson | null;
  myResponse: CalendarResponse;
  isOrganizer: boolean;
  isOnlineMeeting: boolean;
  isRecurring: boolean;
  isCancelled: boolean;
  location: string | null;
  /** Meeting chat (`19:meeting_…@thread.v2`); usable with `messages list` and `send text`. */
  chatId: string | null;
}

export interface CalendarAttendee extends CalendarPerson {
  type: 'required' | 'optional';
  response: CalendarResponse;
}

export interface CalendarEventDetail extends CalendarEvent {
  /** Teams join link from the invitation; null when the event has none. */
  joinUrl: string | null;
  attendees: CalendarAttendee[];
  /** Invitation text without the Teams join block; null when empty. */
  description: string | null;
}

/** A Teams meeting link not tied to a calendar event (Meet now). */
export interface OnlineMeeting {
  subject: string | null;
  joinUrl: string;
  /** `teams.microsoft.com/meet/<id>` form, when Teams returns it. */
  shortJoinUrl: string | null;
  chatId: string | null;
}

export interface CallParty {
  /** MRI, e.g. `8:orgid:…`. */
  id: string;
  /** Teams sends names for the caller and group participants only; null otherwise. */
  name: string | null;
}

/** One entry of the Teams call history (the Calls app "History" list). */
export interface CallLog {
  /** Message id in `48:calllogs`; unique per entry. */
  id: string;
  /** Teams call id; one call can log several entries (e.g. missed, then joined). */
  callId: string;
  startAt: string;
  /** When the call connected; null when it never did (missed, declined). */
  connectAt: string | null;
  endAt: string;
  /** Connected time, `connectAt` to `endAt`; null when it never connected. */
  durationSeconds: number | null;
  direction: 'incoming' | 'outgoing';
  /** Teams `callState`, verbatim. Seen: `accepted`, `missed`, `declined`. */
  state: string;
  /** Group call (Teams `callType` `multiParty`) instead of one-to-one. */
  isGroup: boolean;
  /** Went to the callee's voicemail. */
  isVoicemail: boolean;
  originator: CallParty;
  target: CallParty;
  /** Group calls only; empty for one-to-one calls. */
  participants: CallParty[];
  /** Group chat or meeting the call belongs to; null for one-to-one calls. */
  chatId: string | null;
}
