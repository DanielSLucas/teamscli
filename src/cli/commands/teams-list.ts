import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { listTeams } from '../../store/teams.ts';
import { table } from '../output.ts';
import type { Command } from '../command.ts';
import type { Team } from '../../models.ts';

const command: Command<Team[]> = {
  name: 'teams list',
  summary: 'List locally stored teams',
  mutates: false,
  async run(ctx) {
    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    try {
      return listTeams(db);
    } finally {
      db.close();
    }
  },
  render(result) {
    return table(result.map((team) => ({ ...team })), ['id', 'name', 'description']);
  },
};

export default command;
