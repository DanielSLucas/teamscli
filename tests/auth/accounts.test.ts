import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAccounts } from '../../src/auth/accounts.ts';

test('skips invalid directory names before asking the secret store', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-account-list-'));
  const accountsPath = join(home, 'accounts');
  const secretLookups: string[] = [];
  try {
    mkdirSync(join(accountsPath, 'work'), { recursive: true });
    mkdirSync(join(accountsPath, 'bad account'));
    mkdirSync(join(accountsPath, '!invalid'));

    const secrets = {
      kind: 'file' as const,
      get: async (account: string) => {
        secretLookups.push(account);
        return null;
      },
      set: async () => {},
      delete: async () => {},
    };
    const accounts = await listAccounts(home, secrets);

    assert.deepEqual(accounts.map(({ name }) => name), ['work']);
    assert.deepEqual(secretLookups, ['work']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
