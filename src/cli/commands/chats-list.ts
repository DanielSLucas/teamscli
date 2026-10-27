import type { Conversation, ConversationKind } from '../../models.ts';
import { CliError } from '../../errors.ts';
import { databasePath } from '../../runtime/paths.ts';
import { listConversations } from '../../store/conversations.ts';
import { openDatabase } from '../../store/database.ts';
import { listMembers, type MemberWithName } from '../../store/people.ts';
import { table } from '../output.ts';
import type { Command } from '../command.ts';

type ChatListItem = Conversation & { members: MemberWithName[] };

const conversationKinds: ConversationKind[] = ['chat', 'group', 'meeting', 'channel', 'system'];

const command: Command<ChatListItem[]> = {
  name: 'chats list',
  summary: 'List locally stored chats and channels',
  usage: '[--type chat|group|meeting|channel|system] [--limit N]',
  options: { type: { type: 'string' }, limit: { type: 'string' } },
  mutates: false,
  async run(ctx, { values }) {
    const kind = parseKind(values.type);
    const limit = parseLimit(values.limit);
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const conversations = listConversations(db, kind ? { kind } : {}).filter((conversation) => kind || conversation.kind !== 'system');
      return conversations.slice(0, limit).map((conversation) => ({
        ...conversation,
        members: listMembers(db, conversation.id),
      }));
    } finally {
      db.close();
    }
  },
  render(result) {
    return table(result.map(({ id, kind, title, lastMessageAt, members }) => ({
      id,
      kind,
      title: title ?? memberSummary(members),
      lastMessageAt,
    })), ['id', 'kind', 'title', 'lastMessageAt']);
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

function memberSummary(members: MemberWithName[]): string {
  const names = members.map(({ displayName, personId }) => displayName ?? personId);
  const shown = names.slice(0, 3).join(', ');
  return `${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}` || '-';
}

export default command;
