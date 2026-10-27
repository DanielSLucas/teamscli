import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage } from '../../store/messages.ts';
import type { Command } from '../command.ts';
import { renderMessageDetail } from '../output.ts';
import { resolveConversationTarget } from '../session.ts';

const command: Command<Message> = {
  name: 'messages show',
  summary: 'Show a locally stored message',
  usage: '<id> --chat ID',
  arguments: '<id>  Id of the message to show',
  options: { chat: { type: 'string' } },
  optionHelp: { chat: { valueName: 'ID', description: 'Chat containing the message (id, short id or name).' } },
  maxPositionals: 1,
  mutates: false,
  async run(ctx, { positionals, values }) {
    const id = positionals[0];
    const query = values.chat;
    if (!id) throw new CliError('usage', 'Missing the message ID: pass it after the command.');
    if (typeof query !== 'string' || !query) throw new CliError('usage', 'Missing --chat: the chat containing the message (id, short id or name).');

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
  render: renderMessageDetail,
};

export default command;
