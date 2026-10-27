import { CliError } from '../../errors.ts';
import { openDatabase } from '../../store/database.ts';
import { databasePath } from '../../runtime/paths.ts';
import { runSync } from '../../sync/runner.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { teamsSession } from '../session.ts';

const command: Command = {
  name: 'sync',
  summary: 'Sync changed conversations and recent messages to the local store',
  usage: '[--days N]',
  options: { days: { type: 'string' } },
  mutates: true,
  async run(ctx, { values }) {
    if (ctx.options.events) throw new CliError('usage', 'The sync command does not support --events yet.');
    const days = Number(values.days ?? '90');
    if (!Number.isSafeInteger(days) || days < 1) throw new CliError('usage', '--days must be a positive integer.');

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const session = teamsSession(ctx);
      return await runSync({
        db,
        client: createTeamsClient({ fetch: ctx.fetch, session }),
        endpoints: await session.endpoints(),
        days,
        now: () => new Date(),
        log: ctx.log,
      });
    } finally {
      db.close();
    }
  },
};

export default command;
