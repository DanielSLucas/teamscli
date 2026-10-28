import type { Conversation, ConversationKind } from '../../models.ts';
import { CliError } from '../../errors.ts';
import { readIdentity } from '../../auth/identity.ts';
import { databasePath } from '../../runtime/paths.ts';
import { listConversations } from '../../store/conversations.ts';
import { countUnread } from '../../store/messages.ts';
import { openDatabase } from '../../store/database.ts';
import { conversationLabel, listMembers, type MemberWithName } from '../../store/people.ts';
import { shortId } from '../../store/resolve.ts';
import { table } from '../output.ts';
import type { Command } from '../command.ts';

const humanTitle = Symbol('humanTitle'); // Keep the display-only label out of --json.
type ChatListItem = Conversation & { shortId: string; unreadCount: number; members: MemberWithName[]; [humanTitle]: string };

const conversationKinds: ConversationKind[] = ['chat', 'group', 'meeting', 'channel', 'system'];

const command: Command<ChatListItem[]> = {
  name: 'chats list',
  summary: 'List locally stored chats and channels',
  usage: '[--type chat|group|meeting|channel|system] [--unread] [--limit N]',
  options: { type: { type: 'string' }, unread: { type: 'boolean' }, limit: { type: 'string' } },
  optionHelp: {
    type: { valueName: 'TYPE', description: 'Filter by conversation type.' },
    unread: { description: 'Only chats, group chats and meetings with unread messages (as of the last sync).' },
    limit: { valueName: 'N', description: 'Maximum number of conversations to show.' },
  },
  mutates: false,
  async run(ctx, { values }) {
    const kind = parseKind(values.type);
    const limit = parseLimit(values.limit);
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const selfId = readIdentity(ctx.home, ctx.account)?.userId ?? null;
      const unread = countUnread(db, selfId);
      const conversations = listConversations(db, kind ? { kind } : {})
        .filter((conversation) => kind || conversation.kind !== 'system')
        .filter((conversation) => !values.unread || unread.has(conversation.id));
      return conversations.slice(0, limit).map((conversation) => {
        const members = listMembers(db, conversation.id);
        return {
          ...conversation,
          shortId: shortId(conversation.id),
          unreadCount: unread.get(conversation.id) ?? 0,
          members,
          [humanTitle]: conversationLabel(conversation, members, selfId) || '-',
        };
      });
    } finally {
      db.close();
    }
  },
  render(result) {
    return table(result.map(({ shortId, kind, unreadCount, lastMessageAt, [humanTitle]: title }) => ({
      shortId,
      kind,
      title,
      unread: unreadCount || null,
      lastMessageAt,
    })), ['shortId', 'kind', 'title', 'unread', 'lastMessageAt']);
  },
};

function parseKind(value: string | boolean | string[] | boolean[] | undefined): ConversationKind | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && conversationKinds.includes(value as ConversationKind)) return value as ConversationKind;
  throw new CliError('usage', 'Invalid --type; choose chat, group, meeting, channel, or system.');
}

function parseLimit(value: string | boolean | string[] | boolean[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new CliError('usage', 'The --limit value must be a positive integer.');
  return limit;
}


export default command;
