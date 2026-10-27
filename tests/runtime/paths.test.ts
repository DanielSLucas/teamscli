import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { databasePath, resolveAccount, resolveHome } from '../../src/runtime/paths.ts';

test('home: --store wins over TEAMSCLI_HOME', () => {
  assert.equal(resolveHome('/a', { TEAMSCLI_HOME: '/b' }), resolve('/a'));
  assert.equal(resolveHome(null, { TEAMSCLI_HOME: '/b' }), resolve('/b'));
});

test('account: --account, then TEAMSCLI_ACCOUNT, config, then default', () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-paths-'));
  try {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultAccount: 'saved' }));
    assert.equal(resolveAccount('work', { TEAMSCLI_ACCOUNT: 'other' }, home), 'work');
    assert.equal(resolveAccount(null, { TEAMSCLI_ACCOUNT: 'other' }, home), 'other');
    assert.equal(resolveAccount(null, {}, home), 'saved');
    rmSync(join(home, 'config.json'));
    assert.equal(resolveAccount(null, {}, home), 'default');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('account names cannot escape the accounts directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-paths-'));
  try {
    for (const name of ['../x', 'a/b', '.hidden', '', 'x'.repeat(65)]) {
      assert.throws(() => resolveAccount(name, {}, home), { code: 'usage' }, name);
    }
    assert.equal(databasePath('/h', 'work'), join('/h', 'accounts', 'work', 'messages.db'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
