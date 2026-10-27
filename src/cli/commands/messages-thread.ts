import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listThread } from '../../store/messages.ts';
import { CliError } from '../../errors.ts';
import type { Command } from '../command.ts';
import { resolveConversationTarget } from '../session.ts';

const command: Command<Message[]> = {
  name: 'messages thread',
  summary: 'Show a channel message and its replies',
  usage: '<rootId> --channel ID',
  options: { channel: { type: 'string' } },
  maxPositionals: 1,
  mutates: false,
  async run(ctx, { positionals, values }) {
    const rootId = positionals[0];
    const query = values.channel;
    if (!rootId || typeof query !== 'string' || !query) {
      throw new CliError('usage', 'messages thread requires a root message ID and --channel ID.');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const conversation = resolveConversationTarget(ctx, db, query);
      if (conversation.kind !== 'channel') throw new CliError('usage', '--channel must name a channel in the local data.');
      const conversationId = conversation.id;
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
