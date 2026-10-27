import type { Command } from '../command.ts';
import { secretStore } from '../session.ts';

const command: Command<{ name: string; signedIn: false }> = {
  name: 'auth logout',
  summary: "Forget the account's saved login (local data is kept)",
  mutates: true,
  async run(ctx) {
    await secretStore(ctx).delete(ctx.account);
    return { name: ctx.account, signedIn: false };
  },
};

export default command;
