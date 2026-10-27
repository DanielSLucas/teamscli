import type { Account } from '../../models.ts';
import type { Command } from '../command.ts';
import { secretStore, teamsSession } from '../session.ts';

const command: Command<Account & { secretStore: string }> = {
  name: 'auth status',
  summary: 'Check that the saved login still works (exit 3 when a new "teamscli auth" is needed)',
  // Renewing the login saves the rotated refresh token, except under --read-only (see teamsSession).
  mutates: false,
  async run(ctx) {
    const store = secretStore(ctx);
    const account = await teamsSession(ctx, store).account();
    return { ...account, secretStore: store.kind };
  },
};

export default command;
