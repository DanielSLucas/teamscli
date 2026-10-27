import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeychainStore } from '../../src/auth/secrets-keychain.ts';
import { CliError } from '../../src/errors.ts';
import type { Exec } from '../../src/runtime/exec.ts';

const secret = 'synthetic "quoted" \\ path';

function fakeSecurity() {
  const calls: { command: string; args: string[]; input: string }[] = [];
  let stored: string | null = null;
  const exec: Exec = async (command, args, input = '') => {
    calls.push({ command, args, input });
    if (args[0] === '-q') {
      stored = secret;
      return { stdout: '', stderr: '', code: 0 };
    }
    if (args[0] === 'find-generic-password') {
      return stored === null
        ? { stdout: '', stderr: 'synthetic missing item diagnostic', code: 44 }
        : { stdout: `${stored}\n`, stderr: '', code: 0 };
    }
    if (args[0] === 'delete-generic-password') {
      if (stored === null) return { stdout: '', stderr: 'synthetic missing item diagnostic', code: 44 };
      stored = null;
      return { stdout: '', stderr: '', code: 0 };
    }
    throw new Error('unexpected synthetic security command');
  };
  return { exec, calls };
}

test('round-trips one Keychain item per account with the secret only in stdin', async () => {
  const { exec, calls } = fakeSecurity();
  const store = createKeychainStore({ exec });

  await store.set('work', secret);
  assert.equal(await store.get('work'), secret);
  assert.equal(calls[0]?.command, 'security');
  assert.deepEqual(calls[0]?.args, ['-q', '-i']);
  assert.equal(calls[0]?.input, 'add-generic-password -U -s "teamscli" -a "work" -w "synthetic \\"quoted\\" \\\\ path"\n');
  assert.deepEqual(calls[1]?.args, ['find-generic-password', '-s', 'teamscli', '-a', 'work', '-w']);
  assert.ok(calls.every(({ args }) => args.every((arg) => !arg.includes(secret))));
});

test('rejects line breaks instead of letting them create another security command', async () => {
  const { exec } = fakeSecurity();
  const store = createKeychainStore({ exec });
  await assert.rejects(store.set('work', 'synthetic first line\nsecond line'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});

test('missing Keychain item is null and delete is idempotent', async () => {
  const { exec } = fakeSecurity();
  const store = createKeychainStore({ exec });
  assert.equal(await store.get('work'), null);
  await store.delete('work');
  await store.delete('work');
  await store.set('work', secret);
  await store.delete('work');
  await store.delete('work');
  assert.equal(await store.get('work'), null);
});

test('Keychain errors and missing command suggest file without echoing output', async () => {
  const failing: Exec = async () => ({ stdout: `synthetic ${secret}`, stderr: `synthetic ${secret}`, code: 1 });
  const store = createKeychainStore({ exec: failing });
  await assert.rejects(store.set('work', secret), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message) && !error.message.includes(secret));

  const missing = createKeychainStore({ exec: async () => { throw new Error('synthetic command missing'); } });
  await assert.rejects(missing.get('work'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});
