import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databasePath, resolveAccount, resolveHome } from '../../src/runtime/paths.ts';

test('home: --store wins over TEAMSCLI_HOME', () => {
  assert.equal(resolveHome('/a', { TEAMSCLI_HOME: '/b' }), '/a');
  assert.equal(resolveHome(null, { TEAMSCLI_HOME: '/b' }), '/b');
});

test('account: --account, then TEAMSCLI_ACCOUNT, then default', () => {
  assert.equal(resolveAccount('work', { TEAMSCLI_ACCOUNT: 'other' }), 'work');
  assert.equal(resolveAccount(null, { TEAMSCLI_ACCOUNT: 'other' }), 'other');
  assert.equal(resolveAccount(null, {}), 'default');
});

test('account names cannot escape the accounts directory', () => {
  for (const name of ['../x', 'a/b', '.hidden', '', 'x'.repeat(65)]) {
    assert.throws(() => resolveAccount(name, {}), { code: 'usage' }, name);
  }
  assert.equal(databasePath('/h', 'work'), '/h/accounts/work/messages.db');
});
