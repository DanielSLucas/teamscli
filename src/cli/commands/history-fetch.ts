import { CliError } from '../../errors.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { fetchHistory } from '../../sync/history.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { resolveConversationTarget, teamsSession } from '../session.ts';

const command: Command = {
  name: 'history fetch',
  summary: 'Fetch older messages for a chat into the local store',
  usage: '--chat ID [--before ISO] [--pages N]',
  options: {
    chat: { type: 'string' },
    before: { type: 'string' },
    pages: { type: 'string' },
  },
  mutates: true,
  async run(ctx, { values }) {
    if (ctx.options.events) throw new CliError('usage', 'history fetch does not support --events.');
    const query = values.chat;
    if (typeof query !== 'string' || !query) throw new CliError('usage', 'history fetch requires --chat ID.');
    const before = timestamp(values.before);
    const pages = values.pages === undefined ? undefined : Number(values.pages);
    if (pages !== undefined && (!Number.isSafeInteger(pages) || pages < 1)) {
      throw new CliError('usage', '--pages must be a positive integer.');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const conversationId = resolveConversationTarget(ctx, db, query).id;
      const session = teamsSession(ctx);
      return await fetchHistory({
        db,
        client: createTeamsClient({ fetch: ctx.fetch, session }),
        endpoints: await session.endpoints(),
        conversationId,
        before,
        pages,
        now: () => new Date(),
        log: ctx.log,
      });
    } finally {
      db.close();
    }
  },
};

function timestamp(value: string | boolean | string[] | boolean[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CliError('usage', '--before must be a valid ISO 8601 timestamp.');
  }
  return new Date(value).toISOString();
}

export default command;
