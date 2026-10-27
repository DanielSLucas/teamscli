import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../errors.ts';
import { accountDir, databasePath, readDefaultAccount, resolveAccount } from '../runtime/paths.ts';
import type { SecretStore } from './secrets.ts';

export interface AccountInfo {
  name: string;
  isDefault: boolean;
  hasSecret: boolean;
  hasDatabase: boolean;
}

export async function listAccounts(home: string, secrets: SecretStore): Promise<AccountInfo[]> {
  const accountsPath = join(home, 'accounts');
  let entries;
  try {
    entries = await readdir(accountsPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const defaultAccount = readDefaultAccount(home) ?? 'default';
  const accounts = await Promise.all(
    entries.filter((entry) => entry.isDirectory() && hasValidName(entry.name, home)).map(async ({ name }): Promise<AccountInfo> => ({
      name,
      isDefault: name === defaultAccount,
      hasSecret: (await secrets.get(name)) !== null,
      hasDatabase: existsSync(databasePath(home, name)),
    })),
  );
  return accounts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function hasValidName(name: string, home: string): boolean {
  try {
    resolveAccount(name, {}, home);
    return true;
  } catch (error) {
    if (error instanceof CliError && error.code === 'usage') return false;
    throw error;
  }
}

export async function addAccount(home: string, name: string): Promise<void> {
  const accountsPath = join(home, 'accounts');
  await mkdir(accountsPath, { recursive: true, mode: 0o700 });
  try {
    await mkdir(accountDir(home, name), { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError('usage', `Account "${name}" already exists.`);
    }
    throw error;
  }
}

export async function useAccount(home: string, name: string): Promise<void> {
  await requireAccount(home, name);
  await writeConfig(home, { defaultAccount: name });
}

export async function removeAccount(home: string, name: string, secrets: SecretStore): Promise<void> {
  await requireAccount(home, name);
  if (readDefaultAccount(home) === name) await writeConfig(home, {});
  await secrets.delete(name);
  await rm(accountDir(home, name), { recursive: true });
}

async function requireAccount(home: string, name: string): Promise<void> {
  try {
    if ((await lstat(accountDir(home, name))).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  throw new CliError('not_found', `Account "${name}" does not exist.`);
}

async function writeConfig(home: string, config: { defaultAccount?: string }): Promise<void> {
  const path = join(home, 'config.json');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
