import { selectSecretStore } from '../../auth/secrets.ts';
import { removeAccount } from '../../auth/accounts.ts';
import { runCommand } from '../../runtime/exec.ts';
import { resolveAccount } from '../../runtime/paths.ts';
import { CliError } from '../../errors.ts';
import type { Command } from '../command.ts';

const command: Command<{ removed: string }> = {
  name: 'accounts remove',
  summary: 'Remove a local account and its secret',
  usage: '<name> --yes',
  options: { yes: { type: 'boolean', default: false } },
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals, values }) {
    const name = positionals[0];
    if (!name) throw new CliError('usage', 'Provide an account name.');
    if (values.yes !== true) throw new CliError('usage', 'Removing an account deletes its local database and secret; rerun with --yes to confirm.');
    const account = resolveAccount(name, {}, ctx.home);
    const secrets = selectSecretStore({ platform: process.platform, env: ctx.env, home: ctx.home, exec: runCommand });
    await removeAccount(ctx.home, account, secrets);
    return { removed: account };
  },
};

export default command;
