import { useAccount } from '../../auth/accounts.ts';
import { resolveAccount } from '../../runtime/paths.ts';
import { CliError } from '../../errors.ts';
import type { Command } from '../command.ts';

const command: Command<{ defaultAccount: string }> = {
  name: 'accounts use',
  summary: 'Set the default local account',
  usage: '<name>',
  arguments: '<name>  Name of the local account to select',
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals }) {
    const name = positionals[0];
    if (!name) throw new CliError('usage', 'Missing the account name: pass it after the command.');
    const account = resolveAccount(name, {}, ctx.home);
    await useAccount(ctx.home, account);
    return { defaultAccount: account };
  },
};

export default command;
