import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore, writePrivateFile } from '../../src/auth/secrets-file.ts';

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

test('leaves a pre-existing predictable temporary file untouched', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-file-'));
  const path = join(home, 'refresh_token');
  const oldTemporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(oldTemporary, 'synthetic pre-existing file');
    await writePrivateFile(path, 'synthetic new file');

    assert.equal(readFileSync(oldTemporary, 'utf8'), 'synthetic pre-existing file');
    assert.equal(readFileSync(path, 'utf8'), 'synthetic new file');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('removes its temporary file when rename fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-file-'));
  const path = join(home, 'target');
  try {
    mkdirSync(path);
    await assert.rejects(writePrivateFile(path, 'synthetic content'));
    assert.deepEqual(readdirSync(home), ['target']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
