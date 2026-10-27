import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { accountDir } from '../runtime/paths.ts';
import type { SecretStore } from './secrets.ts';

/** Plain file readable only by the user. Opt-in (`TEAMSCLI_SECRET_STORE=file`) for systems without a usable store. */
export function createFileStore({ home }: { home: string }): SecretStore {
  const path = (account: string) => join(accountDir(home, account), 'refresh_token');
  return {
    kind: 'file',
    get: (account) => readPrivateFile(path(account)),
    set: (account, secret) => writePrivateFile(path(account), secret),
    delete: (account) => rm(path(account), { force: true }),
  };
}

export async function readPrivateFile(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Mode 0600, written to a temporary file and renamed so a crash never leaves half a secret. */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}
