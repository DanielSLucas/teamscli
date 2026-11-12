import type { ForwardedFrom, Message, MessageFile, Person, Quote, Reaction } from '../models.ts';
import type { Endpoints, TeamsClient } from './client.ts';
import { EMOTICONS } from './emoticons.ts';
import { htmlToText } from './html.ts';

interface RawMessage {
  id: string;
  messagetype: string;
  content: string;
  conversationid: string;
  conversationLink?: string;
  rootMessageId?: string;
  from?: string;
  imdisplayname?: string;
  composetime: string;
  version: string;
  clientmessageid?: string;
  properties?: Record<string, unknown>;
}

export interface MessagePage {
  messages: Message[];
  people: Person[];
  backwardLink: string | null;
  syncState: string | null;
}

export interface ListMessagesOptions {
  startTime?: string | number;
  /** A previously saved backwardLink or syncState; sent to Teams verbatim. */
  continuationUrl?: string;
}

/**
 * Lists remote messages without reordering Teams' pages. A channel with no messages may return
 * a remote CliError with details.status 404; let it propagate so sync can decide how to proceed.
 */
export async function* listMessages(
  client: TeamsClient,
  endpoints: Endpoints,
  conversationId: string,
  { startTime, continuationUrl }: ListMessagesOptions = {},
): AsyncGenerator<MessagePage> {
  const url = continuationUrl ?? `${endpoints.chatService}/v1/users/ME/conversations/${conversationPath(conversationId)}/messages?view=msnp24Equivalent&pageSize=200${startTime === undefined ? '' : `&startTime=${encodeURIComponent(String(startTime))}`}`;
  for await (const page of client.pages<RawMessage>('chatService', url, 'messages')) {
    yield {
      messages: page.items.map(mapMessage),
      people: mapPeople(page.items),
      backwardLink: page.backwardLink,
      syncState: page.syncState,
    };
  }
}

/** Maps the shape documented in docs/teams-payloads.md into the stable local model. */
export function mapMessage(raw: RawMessage): Message {
  const linkedRoot = raw.conversationLink?.match(/;messageid=([^/?#]+)/)?.[1];
  const rootId = linkedRoot === undefined ? raw.rootMessageId : decodePathSegment(linkedRoot);
  const xmlType = raw.messagetype.startsWith('Event/') || raw.messagetype.startsWith('ThreadActivity/') || raw.messagetype.startsWith('RichText/Media_');
  const senderId = raw.from ? decodePathSegment(raw.from.split('/').at(-1) ?? '') : null;
  const deletedAt = isoTime(raw.properties?.deletetime);
  const files = deletedAt ? [] : mapFiles(raw.properties?.files);
  const quoteBlock = xmlType ? null : QUOTE_BLOCK.exec(raw.content);

  return {
    id: raw.id,
    conversationId: raw.conversationid,
    parentId: rootId && rootId !== raw.id ? rootId : null,
    senderId: senderId?.startsWith('19:') ? null : senderId || null,
    senderName: raw.imdisplayname || null,
    type: raw.messagetype,
    content: raw.content,
    text: xmlType ? '' : messageText(quoteBlock ? raw.content.replace(quoteBlock[0], '') : raw.content, files),
    createdAt: new Date(raw.composetime).toISOString(),
    editedAt: isoTime(raw.properties?.edittime),
    deletedAt,
    version: Number(raw.version),
    clientMessageId: raw.clientmessageid ?? null,
    files,
    forwardedFrom: mapForwardedFrom(raw.properties?.originalMessageContext),
    reactions: mapReactions(raw.properties?.emotions),
    quote: quoteBlock ? mapQuote(quoteBlock[0]) : null,
  };
}

const QUOTE_BLOCK = /<blockquote\b[^>]*\bitemtype="http:\/\/schema\.skype\.com\/Reply"[^>]*>[\s\S]*?<\/blockquote>/i;

/** Reply quote block (docs/authentication.md, "Replies"): blockquote itemid, `<strong itemprop="mri">` sender, `<p itemprop="preview">`. */
function mapQuote(block: string): Quote | null {
  const id = /^<blockquote\b[^>]*\bitemid="([^"]+)"/i.exec(block)?.[1];
  if (!id) return null;
  const sender = /<strong\b[^>]*\bitemprop="mri"[^>]*>([\s\S]*?)<\/strong>/i.exec(block);
  const senderId = sender ? /\bitemid="([^"]+)"/i.exec(sender[0])?.[1] : undefined;
  const preview = /<p\b[^>]*\bitemprop="preview"[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1];
  return {
    id: htmlToText(id),
    senderId: senderId ? htmlToText(senderId) : null,
    senderName: sender ? htmlToText(sender[1] ?? '') || null : null,
    text: htmlToText(preview ?? ''),
  };
}

/** `properties.emotions`; a removed reaction keeps its key with no users, so those are dropped. */
function mapReactions(value: unknown): Reaction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: { key?: unknown; users?: unknown }) => {
    if (typeof item?.key !== 'string' || !item.key || !Array.isArray(item.users)) return [];
    const users = item.users.flatMap((user: { mri?: unknown; time?: unknown }) =>
      typeof user?.mri === 'string' && user.mri ? [{ id: user.mri, name: null, reactedAt: isoTime(user.time) }] : []);
    return users.length ? [{ key: item.key, emoji: reactionEmoji(item.key), users }] : [];
  });
}

export function reactionEmoji(key: string): string | null {
  return EMOTICONS[key] ?? null;
}

const TOOLBAR_KEYS = ['like', 'heart', 'laugh', 'surprised'];

/** Reaction key for a key or an emoji (`fire`, `🔥`); custom emoji keys (`name;id`) pass through. Null when unknown. */
export function reactionKey(input: string): string | null {
  if (EMOTICONS[input] || input.includes(';')) return input;
  const bare = (value: string) => value.replaceAll('\uFE0F', '');
  const keys = Object.keys(EMOTICONS).filter((key) => bare(EMOTICONS[key]!) === bare(input));
  return keys.find((key) => TOOLBAR_KEYS.includes(key)) ?? keys[0] ?? null;
}

function mapForwardedFrom(value: unknown): ForwardedFrom | null {
  const context = value as { originalSender?: unknown; originalSentTime?: unknown } | null | undefined;
  if (typeof context?.originalSender !== 'string' || !context.originalSender) return null;
  const sentAt = typeof context.originalSentTime === 'string' && Number.isFinite(Date.parse(context.originalSentTime)) ? new Date(context.originalSentTime).toISOString() : null;
  return { senderId: context.originalSender, senderName: null, sentAt };
}

/** Plain text of an HTML or text message, with placeholders for inline images and attached files so they show and can be searched. */
export function messageText(content: string, files: MessageFile[]): string {
  const text = htmlToText(content.replace(/<img\b[^>]*\bitemtype="http:\/\/schema\.skype\.com\/AMSImage"[^>]*>/gi, ' [image] '));
  return [text, ...files.map((file) => `[file: ${file.name}]`)].filter(Boolean).join(' ');
}

function mapFiles(value: unknown): MessageFile[] {
  if (typeof value !== 'string') return [];
  try {
    const files = JSON.parse(value) as unknown;
    if (!Array.isArray(files)) return [];
    return files.flatMap((file: { fileName?: unknown; fileType?: unknown; objectUrl?: unknown }) => {
      if (typeof file?.fileName !== 'string' || !file.fileName || typeof file.objectUrl !== 'string' || !file.objectUrl) return [];
      return [{ name: file.fileName, type: typeof file.fileType === 'string' && file.fileType ? file.fileType : null, url: file.objectUrl }];
    });
  } catch {
    // A malformed optional file list should not prevent the rest of the page from syncing.
    return [];
  }
}

function mapPeople(messages: RawMessage[]): Person[] {
  const people = new Map<string, Person>();
  const add = (id: unknown, displayName: unknown) => {
    if (typeof id !== 'string' || !id || id.startsWith('19:')) return;
    const name = typeof displayName === 'string' && displayName ? displayName : null;
    const previous = people.get(id);
    people.set(id, { id, displayName: previous?.displayName ?? name, email: null });
  };

  for (const raw of messages) {
    const senderId = raw.from ? decodePathSegment(raw.from.split('/').at(-1) ?? '') : null;
    add(senderId, raw.imdisplayname);
  }
  for (const raw of messages) {
    const value = raw.properties?.mentions;
    if (typeof value !== 'string') continue;
    try {
      const mentions = JSON.parse(value) as unknown;
      if (!Array.isArray(mentions)) continue;
      for (const mention of mentions) {
        if (mention && typeof mention === 'object') add((mention as { mri?: unknown }).mri, (mention as { displayName?: unknown }).displayName);
      }
    } catch {
      // A malformed optional mention list should not prevent the rest of the page from syncing.
    }
  }

  return [...people.values()];
}

function conversationPath(conversationId: string): string {
  const marker = ';messageid=';
  const separator = conversationId.lastIndexOf(marker);
  if (separator < 0) return encodeURIComponent(conversationId);
  return `${encodeURIComponent(conversationId.slice(0, separator))}${marker}${encodeURIComponent(conversationId.slice(separator + marker.length))}`;
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isoTime(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null;
}
