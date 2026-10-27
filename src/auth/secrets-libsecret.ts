import { CliError } from '../errors.ts';
import type { Exec } from '../runtime/exec.ts';
import type { SecretStore } from './secrets.ts';

const SERVICE = 'teamscli';

export function createLibsecretStore({ exec }: { exec: Exec }): SecretStore {
  async function run(args: string[], input = '') {
    try {
      return await exec('secret-tool', args, input);
    } catch {
      throw new CliError('internal', 'Could not run secret-tool for Linux libsecret; set TEAMSCLI_SECRET_STORE=file to keep the login in a 0600 file instead.');
    }
  }

  function failed() {
    throw new CliError('internal', 'Linux libsecret failed; set TEAMSCLI_SECRET_STORE=file to keep the login in a 0600 file instead.');
  }

  return {
    kind: 'libsecret',
    async get(account) {
      const result = await run(['lookup', 'service', SERVICE, 'account', account]);
      if (result.code === 1 && !result.stdout && !result.stderr) return null;
      if (result.code !== 0) failed();
      return result.stdout;
    },
    async set(account, secret) {
      const result = await run(['store', '--label=teamscli', 'service', SERVICE, 'account', account], secret);
      if (result.code !== 0) failed();
    },
    async delete(account) {
      const result = await run(['clear', 'service', SERVICE, 'account', account]);
      if (result.code !== 0 && !(result.code === 1 && !result.stdout && !result.stderr)) failed();
    },
  };
}
