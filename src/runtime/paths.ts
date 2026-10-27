import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CliError } from '../errors.ts';

const ACCOUNT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Root of all local state: `--store`, then `TEAMSCLI_HOME`, then `~/.teamscli`. */
export function resolveHome(store: string | null, env: NodeJS.ProcessEnv): string {
  return resolve(store ?? env.TEAMSCLI_HOME ?? join(homedir(), '.teamscli'));
}

/** Account to act on: `--account`, then `TEAMSCLI_ACCOUNT`, then `default`. */
// shortcut: no persisted default account yet; `accounts use` (A5) should extend this.
export function resolveAccount(account: string | null, env: NodeJS.ProcessEnv): string {
  const name = account ?? env.TEAMSCLI_ACCOUNT ?? 'default';
  // The name becomes a directory: reject anything that could escape `accounts/`.
  if (!ACCOUNT_NAME.test(name)) {
    throw new CliError('usage', `Invalid account name "${name}": use letters, digits, ".", "_" or "-".`);
  }
  return name;
}

export function accountDir(home: string, account: string): string {
  return join(home, 'accounts', account);
}

export function databasePath(home: string, account: string): string {
  return join(accountDir(home, account), 'messages.db');
}
