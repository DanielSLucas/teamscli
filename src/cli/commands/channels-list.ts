import type { Channel } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { listConversations } from '../../store/conversations.ts';
import { openDatabase } from '../../store/database.ts';
import { listTeams } from '../../store/teams.ts';
import { table } from '../output.ts';
import type { Command } from '../command.ts';

type ChannelListItem = Channel & { teamName: string | null };

const command: Command<ChannelListItem[]> = {
  name: 'channels list',
  summary: 'List locally stored channels',
  usage: '[--team ID]',
  options: { team: { type: 'string' } },
  mutates: false,
  async run(ctx, { values }) {
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      const teams = new Map(listTeams(db).map(({ id, name }) => [id, name]));
      return listConversations(db, { kind: 'channel', teamId: typeof values.team === 'string' ? values.team : undefined })
        .map((conversation) => ({
          ...conversation,
          kind: 'channel' as const,
          teamName: conversation.teamId === null ? null : teams.get(conversation.teamId) ?? null,
        }));
    } finally {
      db.close();
    }
  },
  render(result) {
    return table(result.map(({ id, teamName, title, lastMessageAt }) => ({ id, teamName, title, lastMessageAt })),
      ['id', 'teamName', 'title', 'lastMessageAt']);
  },
};

export default command;
