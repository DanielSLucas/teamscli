import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibsecretStore } from '../../src/auth/secrets-libsecret.ts';
import { CliError } from '../../src/errors.ts';
import type { Exec } from '../../src/runtime/exec.ts';

const secret = 'synthetic secret\nwith multiple lines';

function fakeSecretTool() {
  const calls: { command: string; args: string[]; input: string }[] = [];
  const entries = new Map<string, string>();
  const exec: Exec = async (command, args, input = '') => {
    calls.push({ command, args, input });
    const account = args[args.indexOf('account') + 1] ?? '';
    if (args[0] === 'store') {
      entries.set(account, input);
      return { stdout: '', stderr: '', code: 0 };
    }
    if (args[0] === 'lookup') {
      return entries.has(account)
        ? { stdout: entries.get(account) ?? '', stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 1 };
    }
    if (args[0] === 'clear') {
      if (!entries.has(account)) return { stdout: '', stderr: '', code: 1 };
      entries.delete(account);
      return { stdout: '', stderr: '', code: 0 };
    }
    throw new Error('unexpected synthetic secret-tool command');
  };
  return { exec, calls };
}

test('round-trips one libsecret item per account with the secret only in stdin', async () => {
  const { exec, calls } = fakeSecretTool();
  const store = createLibsecretStore({ exec });

  await store.set('work', secret);
  assert.equal(await store.get('work'), secret);
  assert.equal(calls[0]?.command, 'secret-tool');
  assert.deepEqual(calls[0]?.args, ['store', '--label=teamscli', 'service', 'teamscli', 'account', 'work']);
  assert.equal(calls[0]?.input, secret);
  assert.deepEqual(calls[1]?.args, ['lookup', 'service', 'teamscli', 'account', 'work']);
  assert.ok(calls.every(({ args }) => args.every((arg) => !arg.includes(secret))));
});

test('missing libsecret item is null and delete is idempotent', async () => {
  const { exec } = fakeSecretTool();
  const store = createLibsecretStore({ exec });
  assert.equal(await store.get('work'), null);
  await store.delete('work');
  await store.delete('work');
  await store.set('work', secret);
  await store.delete('work');
  await store.delete('work');
  assert.equal(await store.get('work'), null);
});

test('libsecret errors and missing command suggest file without echoing output', async () => {
  const failing: Exec = async () => ({ stdout: `synthetic ${secret}`, stderr: `synthetic ${secret}`, code: 2 });
  const store = createLibsecretStore({ exec: failing });
  await assert.rejects(store.set('work', secret), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message) && !error.message.includes(secret));

  const missing = createLibsecretStore({ exec: async () => { throw new Error('synthetic command missing'); } });
  await assert.rejects(missing.get('work'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});
