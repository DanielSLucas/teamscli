import { createHash } from 'node:crypto';
import { CliError } from '../errors.ts';
import type { Exec } from '../runtime/exec.ts';
import type { SecretStore } from './secrets.ts';

const SERVICE = 'teamscli';
const ITEM_NOT_FOUND = 44;

// security -i reads commands from stdin; quoted values escape backslashes and double quotes.
const quote = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const accountKey = (account: string, home: string) => `${account}@${createHash('sha256').update(home).digest('hex').slice(0, 16)}`;

export function createKeychainStore({ home, exec }: { home: string; exec: Exec }): SecretStore {
  async function run(args: string[], input = '') {
    try {
      return await exec('security', args, input);
    } catch {
      throw new CliError('internal', 'Could not run security for macOS Keychain; set TEAMSCLI_SECRET_STORE=file to keep the login in a 0600 file instead.');
    }
  }

  function failed() {
    throw new CliError('internal', 'macOS Keychain failed; set TEAMSCLI_SECRET_STORE=file to keep the login in a 0600 file instead.');
  }

  return {
    kind: 'keychain',
    async get(account) {
      const result = await run(['find-generic-password', '-s', SERVICE, '-a', accountKey(account, home), '-w']);
      if (result.code === ITEM_NOT_FOUND) return null;
      if (result.code !== 0) failed();
      return result.stdout.replace(/\r?\n$/, '');
    },
    async set(account, secret) {
      if (/[\r\n]/.test(account) || /[\r\n]/.test(secret)) failed();
      const command = `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(accountKey(account, home))} -w ${quote(secret)}\n`;
      const result = await run(['-q', '-i'], command);
      if (result.code !== 0) failed();
    },
    async delete(account) {
      const result = await run(['delete-generic-password', '-s', SERVICE, '-a', accountKey(account, home)]);
      if (result.code !== 0 && result.code !== ITEM_NOT_FOUND) failed();
    },
  };
}
