import { CliError } from '../../errors.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listHistoryCoverage } from '../../store/messages.ts';
import type { Command } from '../command.ts';

const command: Command = {
  name: 'history coverage',
  summary: 'Show local message history coverage',
  usage: '[--chat ID]',
  options: { chat: { type: 'string' } },
  mutates: false,
  async run(ctx, { values }) {
    if (ctx.options.events) throw new CliError('usage', 'history coverage does not support --events.');
    const chat = values.chat;
    if (chat !== undefined && (typeof chat !== 'string' || !chat)) {
      throw new CliError('usage', 'history coverage --chat requires an ID.');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      return listHistoryCoverage(db, typeof chat === 'string' ? chat : undefined);
    } finally {
      db.close();
    }
  },
};

export default command;
