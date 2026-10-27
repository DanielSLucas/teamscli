import { CliError } from '../../errors.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { searchMessages, type SearchMessage } from '../../store/search.ts';
import type { Command } from '../command.ts';
import { table } from '../output.ts';

const command: Command<SearchMessage[]> = {
  name: 'messages search',
  summary: 'Search locally stored messages',
  usage: '<query> [--chat ID] [--from X] [--after ISO] [--before ISO] [--limit 20]',
  maxPositionals: 1,
  options: {
    chat: { type: 'string' },
    from: { type: 'string' },
    after: { type: 'string' },
    before: { type: 'string' },
    limit: { type: 'string' },
  },
  mutates: false,
  async run(ctx, { positionals, values }) {
    const query = positionals[0] ?? '';
    if (!query.trim()) throw new CliError('usage', 'Provide a search query.');

    const limitText = option(values, 'limit') ?? '20';
    const limit = Number(limitText);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new CliError('usage', '--limit must be a positive integer.');

    const conversationId = option(values, 'chat');
    const from = option(values, 'from');
    if (conversationId === '' || from === '') throw new CliError('usage', '--chat and --from must not be empty.');

    const after = timestamp(option(values, 'after'), '--after');
    const before = timestamp(option(values, 'before'), '--before');
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      return searchMessages(db, query, { conversationId, from, after, before, limit });
    } finally {
      db.close();
    }
  },
  render(results) {
    return table(
      results.map(({ message, snippet }) => ({
        conversation: message.conversationId,
        time: message.createdAt,
        sender: message.senderName ?? message.senderId,
        snippet,
      })),
      ['conversation', 'time', 'sender', 'snippet'],
    );
  },
};

export default command;

function option(values: Record<string, string | boolean | string[] | boolean[] | undefined>, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

function timestamp(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new CliError('usage', `${optionName} must be a valid ISO 8601 timestamp.`);
  return date.toISOString();
}
