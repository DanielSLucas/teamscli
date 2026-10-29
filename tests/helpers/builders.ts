import type { Conversation, Message } from '../../src/models.ts';

// Synthetic models. Override only what the test is about.

export function aConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '19:conversation-1@thread.v2',
    kind: 'group',
    title: 'Example group',
    teamId: null,
    lastMessageAt: '2026-01-01T10:00:00.000Z',
    readUpTo: null,
    ...overrides,
  };
}

export function aMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1767261600000',
    conversationId: '19:conversation-1@thread.v2',
    parentId: null,
    senderId: '8:orgid:00000000-0000-0000-0000-000000000001',
    senderName: 'Alice Example',
    type: 'Text',
    content: 'Hello there',
    text: 'Hello there',
    createdAt: '2026-01-01T10:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    version: 1767261600000,
    clientMessageId: null,
    files: [],
    ...overrides,
  };
}
