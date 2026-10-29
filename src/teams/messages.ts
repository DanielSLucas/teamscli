import type { Message, MessageFile, Person } from '../models.ts';
import type { Endpoints, TeamsClient } from './client.ts';
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

  return {
    id: raw.id,
    conversationId: raw.conversationid,
    parentId: rootId && rootId !== raw.id ? rootId : null,
    senderId: senderId?.startsWith('19:') ? null : senderId || null,
    senderName: raw.imdisplayname || null,
    type: raw.messagetype,
    content: raw.content,
    text: xmlType ? '' : messageText(raw.content, files),
    createdAt: new Date(raw.composetime).toISOString(),
    editedAt: isoTime(raw.properties?.edittime),
    deletedAt,
    version: Number(raw.version),
    clientMessageId: raw.clientmessageid ?? null,
    files,
  };
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
