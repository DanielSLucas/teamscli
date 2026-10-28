import { readIdentity } from '../../auth/identity.ts';
import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { getConversation } from '../../store/conversations.ts';
import { openDatabase } from '../../store/database.ts';
import { listMessages, listUnreadMessages } from '../../store/messages.ts';
import { shortId } from '../../store/resolve.ts';
import type { Command } from '../command.ts';
import { renderMessage } from '../output.ts';
import { resolveConversationTarget } from '../session.ts';

const chatLabel = Symbol('chatLabel'); // Keep the display-only label out of --json.
type MessageListItem = Message & { [chatLabel]?: string };

const command: Command<MessageListItem[]> = {
  name: 'messages list',
  summary: 'List locally stored messages for a chat',
  usage: '(--chat ID | --unread [--chat ID]) [--limit 50] [--before ISO] [--after ISO]',
  optionHelp: {
    chat: { valueName: 'ID', description: 'Chat to list (id, short id or name).' },
    unread: { description: 'Only unread messages in chats, group chats and meetings (as of the last sync); --chat becomes optional.' },
    limit: { valueName: 'N', description: 'Maximum number of messages to show.' },
    before: { valueName: 'ISO', description: 'Show messages before this timestamp.' },
    after: { valueName: 'ISO', description: 'Show messages after this timestamp.' },
  },
  options: {
    chat: { type: 'string' },
    unread: { type: 'boolean' },
    limit: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
  },
  mutates: false,
  async run(ctx, { values }) {
    const query = values.chat;
    const unread = values.unread === true;
    if (!unread && (typeof query !== 'string' || !query)) throw new CliError('usage', 'Missing --chat: the chat to list (id, short id or name).');

    const limit = values.limit === undefined ? 50 : Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new CliError('usage', '--limit must be a positive integer.');

    const before = timestamp(values.before);
    const after = timestamp(values.after);
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const conversation = typeof query === 'string' && query ? resolveConversationTarget(ctx, db, query) : null;
      if (!unread) return listMessages(db, { conversationId: conversation!.id, limit, before, after });
      if (conversation && !['chat', 'group', 'meeting'].includes(conversation.kind)) {
        throw new CliError('usage', '--unread supports chats, group chats and meetings only.');
      }

      const selfId = readIdentity(ctx.home, ctx.account)?.userId ?? null;
      const messages = listUnreadMessages(db, { conversationId: conversation?.id, selfId, limit, before, after });
      if (conversation) return messages;
      // Across chats, prefix each line with its chat so people know where it came from.
      return messages.map((message) => {
        const chat = getConversation(db, message.conversationId);
        return { ...message, [chatLabel]: chat?.title ?? shortId(message.conversationId) };
      });
    } finally {
      db.close();
    }
  },
  render: (messages) => messages.map((message) => (message[chatLabel] ? `[${message[chatLabel]}]  ` : '') + renderMessage(message)).join('\n'),
};

function timestamp(value: string | boolean | string[] | boolean[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CliError('usage', '--before and --after must be valid ISO 8601 timestamps.');
  }
  return new Date(value).toISOString();
}

export default command;
