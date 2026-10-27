import { CliError } from '../../errors.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listHistoryCoverage } from '../../store/messages.ts';
import type { Command } from '../command.ts';
import { resolveConversationTarget } from '../session.ts';

const command: Command = {
  name: 'history coverage',
  summary: 'Show local message history coverage',
  usage: '[--chat ID]',
  options: { chat: { type: 'string' } },
  optionHelp: { chat: { valueName: 'ID', description: 'Limit coverage to a chat (id, short id or name).' } },
  mutates: false,
  async run(ctx, { values }) {
    if (ctx.options.events) throw new CliError('usage', 'history coverage does not support --events.');
    const chat = values.chat;
    if (chat !== undefined && (typeof chat !== 'string' || !chat)) {
      throw new CliError('usage', 'Missing --chat: the chat whose history coverage to show (id, short id or name).');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const conversationId = typeof chat === 'string' ? resolveConversationTarget(ctx, db, chat).id : undefined;
      return listHistoryCoverage(db, conversationId);
    } finally {
      db.close();
    }
  },
};

export default command;
