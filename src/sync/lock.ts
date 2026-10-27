import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../errors.ts';

const LOCK_NAME = 'sync.lock';

/** Acquires the per-account sync lock and returns an idempotent release function. */
export function acquireSyncLock(accountDir: string): () => void {
  mkdirSync(accountDir, { recursive: true, mode: 0o700 });
  const path = join(accountDir, LOCK_NAME);
  const pid = String(process.pid);

  for (;;) {
    let fd: number | null = null;
    let created = false;
    try {
      fd = openSync(path, 'wx', 0o600);
      created = true;
      writeFileSync(fd, `${pid}\n`);
      closeSync(fd);
      fd = null;
      break;
    } catch (error) {
      if (fd !== null) {
        try { closeSync(fd); } catch {}
      }
      if (created) {
        try { unlinkSync(path); } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
        }
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isOwnerAlive(path)) {
        throw new CliError('usage', 'Another sync is already running for this account. Stop it before starting another sync.');
      }
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (readFileSync(path, 'utf8').trim() === pid) unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}

function isOwnerAlive(path: string): boolean {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const owner = Number(contents.trim());
  if (!Number.isSafeInteger(owner) || owner < 1) return false;
  try {
    process.kill(owner, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
