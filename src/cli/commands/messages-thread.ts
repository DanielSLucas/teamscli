import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listThread } from '../../store/messages.ts';
import { CliError } from '../../errors.ts';
import type { Command } from '../command.ts';
import { renderMessages } from '../output.ts';
import { resolveConversationTarget } from '../session.ts';

const command: Command<Message[]> = {
  name: 'messages thread',
  summary: 'Show a channel message and its replies',
  usage: '<rootId> --channel ID',
  arguments: '<rootId>  Id of the root message',
  options: { channel: { type: 'string' } },
  optionHelp: { channel: { valueName: 'ID', description: 'Channel to show (id, short id or name).' } },
  maxPositionals: 1,
  mutates: false,
  async run(ctx, { positionals, values }) {
    const rootId = positionals[0];
    const query = values.channel;
    if (!rootId) throw new CliError('usage', 'Missing the root message ID: pass it after the command.');
    if (typeof query !== 'string' || !query) throw new CliError('usage', 'Missing --channel: the channel to show (id, short id or name).');

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
  render: renderMessages,
};

export default command;
