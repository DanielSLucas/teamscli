import { randomInt } from 'node:crypto';
import type { Message } from '../models.ts';
import { listMessages } from './messages.ts';
import type { Endpoints, TeamsClient } from './client.ts';
import { escapeHtml, quoteHtml, toTeamsHtml, toTeamsHtmlWithMentions, type PersonMention, type QuotedMessage } from './compose.ts';
import type { UploadedImage } from './files.ts';

export interface SendTextOptions {
  conversationId: string;
  replyTo?: string;
  channelPost?: boolean;
  text: string;
  quote?: QuotedMessage;
  mentions?: PersonMention[];
}

export async function sendText(client: TeamsClient, endpoints: Endpoints, { conversationId, replyTo, channelPost, text, quote, mentions }: SendTextOptions): Promise<{ clientMessageId: string; message: Message | null }> {
  const clientMessageId = newClientMessageId();
  const targetId = replyTo === undefined ? conversationId : `${conversationId};messageid=${replyTo}`;
  await client.json('chatService', `${conversationUrl(endpoints, targetId)}/messages`, {
    method: 'POST',
    body: {
      ...messageBody(text, clientMessageId, quote, mentions),
      ...(channelPost && replyTo === undefined ? { postType: 'Standard' } : {}),
    },
  });
  const message = await firstMessage(client, endpoints, targetId, (item) => item.clientMessageId === clientMessageId);
  return { clientMessageId, message };
}

export interface SendAttachmentOptions {
  conversationId: string;
  /** Optional markdown text shown above the attachment. */
  text?: string;
  image?: UploadedImage & { format: string };
  /** An entry from `uploadFile`. */
  file?: Record<string, unknown>;
  /** Sender name; Teams leaves it empty on attachment messages that do not carry it. */
  displayName: string | null;
}

/** Sends an image or file uploaded with `uploadImage` or `uploadFile`. */
export async function sendAttachment(client: TeamsClient, endpoints: Endpoints, { conversationId, text, image, file, displayName }: SendAttachmentOptions): Promise<{ clientMessageId: string; message: Message | null }> {
  const clientMessageId = newClientMessageId();
  const imageHtml = image
    ? `<p><img src="${escapeHtml(image.url)}" itemtype="http://schema.skype.com/AMSImage" itemscope="${escapeHtml(image.format)}" alt="image" id="x_${escapeHtml(image.id)}" itemid="${escapeHtml(image.id)}"></p>`
    : '';
  await client.json('chatService', `${conversationUrl(endpoints, conversationId)}/messages`, {
    method: 'POST',
    body: {
      content: `${text ? toTeamsHtml(text) : ''}${imageHtml}`,
      messagetype: 'RichText/Html',
      contenttype: 'text',
      clientmessageid: clientMessageId,
      ...(displayName ? { imdisplayname: displayName } : {}),
      ...(image ? { amsreferences: [image.id] } : {}),
      ...(file ? { properties: { files: JSON.stringify([file]) } } : {}),
    },
  });
  const message = await firstMessage(client, endpoints, conversationId, (item) => item.clientMessageId === clientMessageId);
  return { clientMessageId, message };
}

export async function editText(client: TeamsClient, endpoints: Endpoints, message: Message, text: string): Promise<Message | null> {
  await client.json('chatService', `${conversationUrl(endpoints, message.conversationId)}/messages/${encodeURIComponent(message.id)}`, {
    method: 'PUT',
    body: messageBody(text, newClientMessageId()),
  });
  const threadId = message.parentId === null ? message.conversationId : `${message.conversationId};messageid=${message.parentId}`;
  return firstMessage(client, endpoints, threadId, (item) => item.id === message.id);
}

// shortcut: channel reply mutations use stored conversationId; verify the path with D6.
export async function deleteMessage(client: TeamsClient, endpoints: Endpoints, message: Message): Promise<Message | null> {
  await client.json('chatService', `${conversationUrl(endpoints, message.conversationId)}/messages/${encodeURIComponent(message.id)}?behavior=softDelete`, {
    method: 'DELETE',
  });
  const threadId = message.parentId === null ? message.conversationId : `${message.conversationId};messageid=${message.parentId}`;
  return firstMessage(client, endpoints, threadId, (item) => item.id === message.id);
}

async function firstMessage(
  client: TeamsClient,
  endpoints: Endpoints,
  conversationId: string,
  matches: (message: Message) => boolean,
): Promise<Message | null> {
  const page = await listMessages(client, endpoints, conversationId).next();
  return page.value?.messages.find(matches) ?? null;
}

function messageBody(text: string, clientMessageId: string, quote?: QuotedMessage, mentions?: PersonMention[]) {
  const composed = mentions?.length ? toTeamsHtmlWithMentions(text, mentions) : null;
  return {
    content: `${quote ? quoteHtml(quote) : ''}${composed?.content ?? toTeamsHtml(text)}`,
    messagetype: 'RichText/Html',
    contenttype: 'text',
    clientmessageid: clientMessageId,
    ...(composed ? { properties: { mentions: JSON.stringify(composed.mentions) } } : {}),
  };
}

function conversationUrl(endpoints: Endpoints, conversationId: string): string {
  const marker = ';messageid=';
  const separator = conversationId.lastIndexOf(marker);
  const path = separator < 0
    ? encodeURIComponent(conversationId)
    : `${encodeURIComponent(conversationId.slice(0, separator))}${marker}${encodeURIComponent(conversationId.slice(separator + marker.length))}`;
  return `${endpoints.chatService}/v1/users/ME/conversations/${path}`;
}

function newClientMessageId(): string {
  return `${randomInt(1_000_000_000).toString().padStart(9, '0')}${randomInt(1_000_000_000).toString().padStart(9, '0')}`;
}
