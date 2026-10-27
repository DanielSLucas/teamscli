import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage } from '../../store/messages.ts';
import type { Command } from '../command.ts';
import { resolveConversationTarget } from '../session.ts';

const command: Command<Message> = {
  name: 'messages show',
  summary: 'Show a locally stored message',
  usage: '<id> --chat ID',
  options: { chat: { type: 'string' } },
  maxPositionals: 1,
  mutates: false,
  async run(ctx, { positionals, values }) {
    const id = positionals[0];
    const query = values.chat;
    if (!id || typeof query !== 'string' || !query) {
      throw new CliError('usage', 'messages show requires a message ID and --chat ID.');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const conversationId = resolveConversationTarget(ctx, db, query).id;
      const message = getMessage(db, conversationId, id);
      if (!message) throw new CliError('not_found', 'Message not found in the specified chat.');
      return message;
    } finally {
      db.close();
    }
  },
  render: (message) => {
    const text = message.deletedAt ? '[deleted]' : `${message.text}${message.editedAt ? ' (edited)' : ''}`;
    return `${message.createdAt}  ${message.senderName ?? message.senderId ?? '-'}  ${text}`;
  },
};

export default command;
