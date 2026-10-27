import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CliError } from '../errors.ts';

const ACCOUNT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Root of all local state: `--store`, then `TEAMSCLI_HOME`, then `~/.teamscli`. */
export function resolveHome(store: string | null, env: NodeJS.ProcessEnv): string {
  return resolve(store ?? env.TEAMSCLI_HOME ?? join(homedir(), '.teamscli'));
}

/** Account to act on: `--account`, then `TEAMSCLI_ACCOUNT`, then config, then `default`. */
export function resolveAccount(account: string | null, env: NodeJS.ProcessEnv, home: string): string {
  const name = account ?? env.TEAMSCLI_ACCOUNT ?? readDefaultAccount(home) ?? 'default';
  return validateAccountName(name);
}

export function readDefaultAccount(home: string): string | null {
  let contents: string;
  try {
    contents = readFileSync(join(home, 'config.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let config: unknown;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new CliError('usage', 'The account config is invalid; repair config.json before continuing.');
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new CliError('usage', 'The account config is invalid; repair config.json before continuing.');
  }
  if (!('defaultAccount' in config)) return null;
  const name = (config as { defaultAccount?: unknown }).defaultAccount;
  if (typeof name !== 'string') throw new CliError('usage', 'The account config has an invalid defaultAccount.');
  return validateAccountName(name);
}

function validateAccountName(name: string): string {
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
