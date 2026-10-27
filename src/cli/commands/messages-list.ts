import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listMessages } from '../../store/messages.ts';
import type { Command } from '../command.ts';

const command: Command<Message[]> = {
  name: 'messages list',
  summary: 'List locally stored messages for a chat',
  usage: '--chat ID [--limit 50] [--before ISO] [--after ISO]',
  options: {
    chat: { type: 'string' },
    limit: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
  },
  mutates: false,
  async run(ctx, { values }) {
    const conversationId = values.chat;
    if (typeof conversationId !== 'string' || !conversationId) throw new CliError('usage', 'messages list requires --chat ID.');

    const limit = values.limit === undefined ? 50 : Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new CliError('usage', '--limit must be a positive integer.');

    const before = timestamp(values.before);
    const after = timestamp(values.after);
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      return listMessages(db, { conversationId, limit, before, after });
    } finally {
      db.close();
    }
  },
  render: (messages) => messages.map(renderMessage).join('\n'),
};

function timestamp(value: string | boolean | string[] | boolean[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CliError('usage', '--before and --after must be valid ISO 8601 timestamps.');
  }
  return new Date(value).toISOString();
}

function renderMessage(message: Message): string {
  const text = message.deletedAt ? '[deleted]' : `${message.text}${message.editedAt ? ' (edited)' : ''}`;
  return `${message.createdAt}  ${message.senderName ?? message.senderId ?? '-'}  ${text}`;
}

export default command;
