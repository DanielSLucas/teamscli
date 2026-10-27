import type { Conversation, ConversationMember } from '../models.ts';
import type { Endpoints, TeamsClient } from './client.ts';

interface RawConversation {
  id: string;
  threadProperties?: {
    productThreadType?: string;
    topic?: string;
    spaceId?: string;
    parentSpaces?: string;
  };
  lastMessage?: { originalarrivaltime?: string } | null;
}

interface RawThreadMember {
  id: string;
  role?: string;
}

interface ConversationPage {
  conversations: Conversation[];
  backwardLink: string | null;
  syncState: string | null;
}

/** Lists conversation pages, including the empty page that carries the sync checkpoint. */
export async function* listConversations(
  client: TeamsClient,
  endpoints: Endpoints,
  savedLink?: string,
): AsyncGenerator<ConversationPage> {
  const firstUrl = savedLink ?? `${endpoints.chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=100`;
  for await (const page of client.pages<RawConversation>('chatService', firstUrl, 'conversations')) {
    yield {
      conversations: page.items.map(mapConversation),
      backwardLink: page.backwardLink,
      syncState: page.syncState,
    };
  }
}

/** Maps one raw Teams conversation into the stable local model. */
export function mapConversation(raw: RawConversation): Conversation {
  const thread = raw.threadProperties ?? {};
  const productType = thread.productThreadType;
  let kind: Conversation['kind'] = 'system';
  let teamId: string | null = null;

  switch (productType) {
    case 'OneToOneChat':
      kind = 'chat';
      break;
    case 'Chat':
      kind = 'group';
      break;
    case 'Meeting':
      kind = 'meeting';
      break;
    case 'TeamsStandardChannel':
      kind = 'channel';
      teamId = thread.spaceId ?? null;
      break;
    case 'TeamsTeam':
      kind = 'channel';
      teamId = raw.id;
      break;
    case 'TeamsPrivateChannel':
      kind = 'channel';
      teamId = parentTeamId(thread.parentSpaces);
      break;
  }

  const arrivalTime = raw.lastMessage?.originalarrivaltime;
  const timestamp = typeof arrivalTime === 'string' ? Date.parse(arrivalTime) : Number.NaN;

  return {
    id: raw.id,
    kind,
    title: thread.topic ?? null,
    teamId,
    lastMessageAt: Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(),
  };
}

/** Fetches the roster for any Teams thread. */
export async function fetchMembers(client: TeamsClient, endpoints: Endpoints, conversationId: string): Promise<ConversationMember[]> {
  const url = `${endpoints.chatService}/v1/threads/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`;
  const thread = await client.json<{ members: RawThreadMember[] }>('chatService', url);
  return thread.members.map((member) => ({ conversationId, personId: member.id, role: member.role ?? null }));
}

function parentTeamId(parentSpaces: string | undefined): string | null {
  if (!parentSpaces) return null;
  try {
    const parsed: unknown = JSON.parse(parentSpaces);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const items = (parsed as { linkedSpaceInfoItems?: unknown }).linkedSpaceInfoItems;
    if (!Array.isArray(items)) return null;
    const id = (items[0] as { spaceThreadId?: unknown } | undefined)?.spaceThreadId;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}
