import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../errors.ts';
import { accountDir } from '../runtime/paths.ts';

export interface LocalIdentity {
  userId: string | null;
  tenantId: string | null;
  region: string | null;
  displayName: string | null;
}

export function readIdentity(home: string, account: string): LocalIdentity | null {
  let contents: string;
  try {
    contents = readFileSync(join(accountDir(home, account), 'account.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new CliError('usage', 'The local account identity is invalid; repair account.json before continuing.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('usage', 'The local account identity is invalid; repair account.json before continuing.');
  }
  const identity = value as Record<keyof LocalIdentity, unknown>;
  if (!(['userId', 'tenantId', 'region', 'displayName'] as const).every((key) => identity[key] === null || typeof identity[key] === 'string')) {
    throw new CliError('usage', 'The local account identity is invalid; repair account.json before continuing.');
  }
  return {
    userId: identity.userId as string | null,
    tenantId: identity.tenantId as string | null,
    region: identity.region as string | null,
    displayName: identity.displayName as string | null,
  };
}

export function writeIdentity(home: string, account: string, identity: LocalIdentity): void {
  const path = identityPath(home, account);
  const temporary = temporaryPath(path);
  try {
    writeFileSync(temporary, `${JSON.stringify(identity)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Create the complete file atomically without replacing an identity saved by auth. */
export function writeIdentityIfMissing(home: string, account: string, identity: LocalIdentity): void {
  const path = identityPath(home, account);
  const temporary = temporaryPath(path);
  try {
    writeFileSync(temporary, `${JSON.stringify(identity)}\n`, { flag: 'wx', mode: 0o600 });
    try {
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

function identityPath(home: string, account: string): string {
  const directory = accountDir(home, account);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, 'account.json');
}

function temporaryPath(path: string): string {
  return `${path}.${process.pid}.${randomUUID()}.tmp`;
}
