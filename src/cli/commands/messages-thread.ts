import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listThread } from '../../store/messages.ts';
import { CliError } from '../../errors.ts';
import type { Command } from '../command.ts';

const command: Command<Message[]> = {
  name: 'messages thread',
  summary: 'Show a channel message and its replies',
  usage: '<rootId> --channel ID',
  options: { channel: { type: 'string' } },
  maxPositionals: 1,
  mutates: false,
  async run(ctx, { positionals, values }) {
    const rootId = positionals[0];
    const conversationId = values.channel;
    if (!rootId || typeof conversationId !== 'string' || !conversationId) {
      throw new CliError('usage', 'messages thread requires a root message ID and --channel ID.');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      return listThread(db, conversationId, rootId);
    } finally {
      db.close();
    }
  },
  render: (messages) => messages.map((message) => {
    const text = message.deletedAt ? '[deleted]' : `${message.text}${message.editedAt ? ' (edited)' : ''}`;
    return `${message.createdAt}  ${message.senderName ?? message.senderId ?? '-'}  ${text}`;
  }).join('\n'),
};

export default command;
