import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibsecretStore } from '../../src/auth/secrets-libsecret.ts';
import { CliError } from '../../src/errors.ts';
import type { Exec } from '../../src/runtime/exec.ts';

const secret = 'synthetic secret\nwith multiple lines';
const home = '/synthetic/teamscli-home';

function fakeSecretTool() {
  const calls: { command: string; args: string[]; input: string }[] = [];
  const entries = new Map<string, string>();
  const exec: Exec = async (command, args, input = '') => {
    calls.push({ command, args, input });
    const key = ['service', 'account', 'home'].map((attribute) => `${attribute}=${args[args.indexOf(attribute) + 1] ?? ''}`).join('\0');
    if (args[0] === 'store') {
      entries.set(key, input);
      return { stdout: '', stderr: '', code: 0 };
    }
    if (args[0] === 'lookup') {
      return entries.has(key)
        ? { stdout: entries.get(key) ?? '', stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 1 };
    }
    if (args[0] === 'clear') {
      if (!entries.has(key)) return { stdout: '', stderr: '', code: 1 };
      entries.delete(key);
      return { stdout: '', stderr: '', code: 0 };
    }
    throw new Error('unexpected synthetic secret-tool command');
  };
  return { exec, calls };
}

test('round-trips one libsecret item per account with the secret only in stdin', async () => {
  const { exec, calls } = fakeSecretTool();
  const store = createLibsecretStore({ home, exec });

  await store.set('work', secret);
  assert.equal(await store.get('work'), secret);
  assert.equal(calls[0]?.command, 'secret-tool');
  assert.deepEqual(calls[0]?.args, ['store', '--label=teamscli', 'service', 'teamscli', 'account', 'work', 'home', home]);
  assert.equal(calls[0]?.input, secret);
  assert.deepEqual(calls[1]?.args, ['lookup', 'service', 'teamscli', 'account', 'work', 'home', home]);
  assert.ok(calls.every(({ args }) => args.every((arg) => !arg.includes(secret))));
});

test('missing libsecret item is null and delete is idempotent', async () => {
  const { exec } = fakeSecretTool();
  const store = createLibsecretStore({ home, exec });
  assert.equal(await store.get('work'), null);
  await store.delete('work');
  await store.delete('work');
  await store.set('work', secret);
  await store.delete('work');
  await store.delete('work');
  assert.equal(await store.get('work'), null);
});

test('isolates the same libsecret account across different homes', async () => {
  const firstHome = '/synthetic/home-one';
  const secondHome = '/synthetic/home-two';
  const firstSecret = 'synthetic secret one';
  const secondSecret = 'synthetic secret two';
  const { exec } = fakeSecretTool();
  const first = createLibsecretStore({ home: firstHome, exec });
  const second = createLibsecretStore({ home: secondHome, exec });

  await first.set('default', firstSecret);
  assert.equal(await second.get('default'), null);
  await second.set('default', secondSecret);
  assert.equal(await first.get('default'), firstSecret);
  assert.equal(await second.get('default'), secondSecret);
});

test('libsecret errors and missing command suggest file without echoing output', async () => {
  const failing: Exec = async () => ({ stdout: `synthetic ${secret}`, stderr: `synthetic ${secret}`, code: 2 });
  const store = createLibsecretStore({ home, exec: failing });
  await assert.rejects(store.set('work', secret), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message) && !error.message.includes(secret));

  const missing = createLibsecretStore({ home, exec: async () => { throw new Error('synthetic command missing'); } });
  await assert.rejects(missing.get('work'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});
