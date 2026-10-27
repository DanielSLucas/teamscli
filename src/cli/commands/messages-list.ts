import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listMessages } from '../../store/messages.ts';
import type { Command } from '../command.ts';
import { renderMessages } from '../output.ts';
import { resolveConversationTarget } from '../session.ts';

const command: Command<Message[]> = {
  name: 'messages list',
  summary: 'List locally stored messages for a chat',
  usage: '--chat ID [--limit 50] [--before ISO] [--after ISO]',
  optionHelp: {
    chat: { valueName: 'ID', description: 'Chat to list (id, short id or name).' },
    limit: { valueName: 'N', description: 'Maximum number of messages to show.' },
    before: { valueName: 'ISO', description: 'Show messages before this timestamp.' },
    after: { valueName: 'ISO', description: 'Show messages after this timestamp.' },
  },
  options: {
    chat: { type: 'string' },
    limit: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
  },
  mutates: false,
  async run(ctx, { values }) {
    const query = values.chat;
    if (typeof query !== 'string' || !query) throw new CliError('usage', 'Missing --chat: the chat to list (id, short id or name).');

    const limit = values.limit === undefined ? 50 : Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new CliError('usage', '--limit must be a positive integer.');

    const before = timestamp(values.before);
    const after = timestamp(values.after);
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const conversation = resolveConversationTarget(ctx, db, query);
      return listMessages(db, { conversationId: conversation.id, limit, before, after });
    } finally {
      db.close();
    }
  },
  render: renderMessages,
};

function timestamp(value: string | boolean | string[] | boolean[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CliError('usage', '--before and --after must be valid ISO 8601 timestamps.');
  }
  return new Date(value).toISOString();
}

export default command;
