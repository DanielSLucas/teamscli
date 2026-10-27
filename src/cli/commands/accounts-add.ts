import { addAccount } from '../../auth/accounts.ts';
import { resolveAccount } from '../../runtime/paths.ts';
import { CliError } from '../../errors.ts';
import type { Command } from '../command.ts';

const command: Command<{ account: string }> = {
  name: 'accounts add',
  summary: 'Create a local account',
  usage: '<name>',
  arguments: '<name>  Name for the local account',
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals }) {
    const name = positionals[0];
    if (!name) throw new CliError('usage', 'Missing the account name: pass it after the command.');
    const account = resolveAccount(name, {}, ctx.home);
    await addAccount(ctx.home, account);
    ctx.log(`Next step: teamscli --account ${account} auth`);
    return { account };
  },
};

export default command;
