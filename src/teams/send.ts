import { randomInt } from 'node:crypto';
import type { Message } from '../models.ts';
import { listMessages } from './messages.ts';
import type { Endpoints, TeamsClient } from './client.ts';
import { quoteHtml, toTeamsHtml, type QuotedMessage } from './compose.ts';

export interface SendTextOptions {
  conversationId: string;
  replyTo?: string;
  channelPost?: boolean;
  text: string;
  quote?: QuotedMessage;
}

export async function sendText(client: TeamsClient, endpoints: Endpoints, { conversationId, replyTo, channelPost, text, quote }: SendTextOptions): Promise<{ clientMessageId: string; message: Message | null }> {
  const clientMessageId = newClientMessageId();
  const targetId = replyTo === undefined ? conversationId : `${conversationId};messageid=${replyTo}`;
  await client.json('chatService', `${conversationUrl(endpoints, targetId)}/messages`, {
    method: 'POST',
    body: {
      ...messageBody(text, clientMessageId, quote),
      ...(channelPost && replyTo === undefined ? { postType: 'Standard' } : {}),
    },
  });
  const message = await firstMessage(client, endpoints, targetId, (item) => item.clientMessageId === clientMessageId);
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

function messageBody(text: string, clientMessageId: string, quote?: QuotedMessage) {
  return {
    content: `${quote ? quoteHtml(quote) : ''}${toTeamsHtml(text)}`,
    messagetype: 'RichText/Html',
    contenttype: 'text',
    clientmessageid: clientMessageId,
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
