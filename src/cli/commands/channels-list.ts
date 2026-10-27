import type { Channel } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { listConversations } from '../../store/conversations.ts';
import { openDatabase } from '../../store/database.ts';
import { listTeams } from '../../store/teams.ts';
import { shortId } from '../../store/resolve.ts';
import { table } from '../output.ts';
import type { Command } from '../command.ts';

type ChannelListItem = Channel & { shortId: string; teamName: string | null };

const command: Command<ChannelListItem[]> = {
  name: 'channels list',
  summary: 'List locally stored channels',
  usage: '[--team ID]',
  options: { team: { type: 'string' } },
  optionHelp: { team: { valueName: 'ID', description: 'Limit results to a team.' } },
  mutates: false,
  async run(ctx, { values }) {
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const teams = new Map(listTeams(db).map(({ id, name }) => [id, name]));
      return listConversations(db, { kind: 'channel', teamId: typeof values.team === 'string' ? values.team : undefined })
        .map((conversation) => ({
          ...conversation,
          kind: 'channel' as const,
          shortId: shortId(conversation.id),
          teamName: conversation.teamId === null ? null : teams.get(conversation.teamId) ?? null,
        }));
    } finally {
      db.close();
    }
  },
  render(result) {
    return table(result.map(({ shortId, teamName, title, lastMessageAt }) => ({ shortId, teamName, title, lastMessageAt })),
      ['shortId', 'teamName', 'title', 'lastMessageAt']);
  },
};

export default command;
