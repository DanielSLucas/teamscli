import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readIdentity, writeIdentity, writeIdentityIfMissing, type LocalIdentity } from '../../src/auth/identity.ts';

const identity: LocalIdentity = { userId: 'synthetic-user', tenantId: 'synthetic-tenant', region: 'test', displayName: 'Synthetic User' };

test('local identity is readable offline, stored with mode 0600, and written only once by sync', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-identity-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));

  assert.equal(readIdentity(home, 'work'), null);
  writeIdentity(home, 'work', identity);
  writeIdentityIfMissing(home, 'work', { ...identity, displayName: 'Replacement' });

  const path = join(home, 'accounts', 'work', 'account.json');
  assert.deepEqual(readIdentity(home, 'work'), identity);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), identity);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});
