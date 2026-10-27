import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CliError } from '../../src/errors.ts';
import { acquireSyncLock } from '../../src/sync/lock.ts';

test('rejects a live owner, reclaims an orphaned pid, and releases the lock', () => {
  const accountDir = mkdtempSync(join(tmpdir(), 'teamscli-lock-'));
  const path = join(accountDir, 'sync.lock');
  try {
    const release = acquireSyncLock(accountDir);
    assert.throws(
      () => acquireSyncLock(accountDir),
      (error: unknown) => error instanceof CliError && error.code === 'usage' && error.message.includes('Another sync is already running'),
    );
    release();
    assert.equal(existsSync(path), false);

    writeFileSync(path, '2147483647\n', { mode: 0o600 });
    const releaseRecovered = acquireSyncLock(accountDir);
    assert.equal(readFileSync(path, 'utf8').trim(), String(process.pid));
    releaseRecovered();
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(accountDir, { recursive: true, force: true });
  }
});
