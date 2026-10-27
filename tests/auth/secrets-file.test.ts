import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../../src/auth/secrets-file.ts';

test('stores one secret per account in a 0600 file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const store = createFileStore({ home });
  assert.equal(await store.get('work'), null);

  await store.set('work', 'secret-work');
  await store.set('home', 'secret-home');
  assert.equal(await store.get('work'), 'secret-work');
  assert.equal(await store.get('home'), 'secret-home');
  // Windows has no Unix permission bits.
  if (process.platform !== 'win32') assert.equal(statSync(join(home, 'accounts', 'work', 'refresh_token')).mode & 0o777, 0o600);

  await store.delete('work');
  await store.delete('work');
  assert.equal(await store.get('work'), null);
  assert.equal(await store.get('home'), 'secret-home');
});
