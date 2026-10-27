import { runCommand } from '../../runtime/exec.ts';
import { listAccounts } from '../../auth/accounts.ts';
import { selectSecretStore } from '../../auth/secrets.ts';
import type { Command } from '../command.ts';

const command: Command = {
  name: 'accounts list',
  summary: 'List local accounts',
  mutates: false,
  async run(ctx) {
    const secrets = selectSecretStore({ platform: process.platform, env: ctx.env, home: ctx.home, exec: runCommand });
    return listAccounts(ctx.home, secrets);
  },
};

export default command;
