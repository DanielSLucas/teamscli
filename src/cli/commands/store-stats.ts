import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { storeStats, type StoreStats } from '../../store/stats.ts';
import type { Command } from '../command.ts';

const command: Command<StoreStats & { account: string; path: string }> = {
  name: 'store stats',
  summary: 'Show what the local store holds for the account',
  mutates: false,
  async run(ctx) {
    const path = databasePath(ctx.home, ctx.account);
    const db = openDatabase(path, { readOnly: true });
    try {
      return { account: ctx.account, path, ...storeStats(db) };
    } finally {
      db.close();
    }
  },
};

export default command;
