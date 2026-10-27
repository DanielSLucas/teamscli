import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createKeychainStore } from '../../src/auth/secrets-keychain.ts';
import { CliError } from '../../src/errors.ts';
import type { Exec } from '../../src/runtime/exec.ts';

const secret = 'synthetic "quoted" \\ path';
const home = '/synthetic/teamscli-home';
const accountKey = (account: string, root: string) => `${account}@${createHash('sha256').update(root).digest('hex').slice(0, 16)}`;

function fakeSecurity(secrets = [secret]) {
  const calls: { command: string; args: string[]; input: string }[] = [];
  const stored = new Map<string, string>();
  let writeIndex = 0;
  const exec: Exec = async (command, args, input = '') => {
    calls.push({ command, args, input });
    if (args[0] === '-q') {
      const account = / -a "([^"]+)"/.exec(input)?.[1] ?? '';
      stored.set(account, secrets[writeIndex++] ?? '');
      return { stdout: '', stderr: '', code: 0 };
    }
    if (args[0] === 'find-generic-password') {
      const account = args[args.indexOf('-a') + 1] ?? '';
      return !stored.has(account)
        ? { stdout: '', stderr: 'synthetic missing item diagnostic', code: 44 }
        : { stdout: `${stored.get(account)}\n`, stderr: '', code: 0 };
    }
    if (args[0] === 'delete-generic-password') {
      const account = args[args.indexOf('-a') + 1] ?? '';
      if (!stored.has(account)) return { stdout: '', stderr: 'synthetic missing item diagnostic', code: 44 };
      stored.delete(account);
      return { stdout: '', stderr: '', code: 0 };
    }
    throw new Error('unexpected synthetic security command');
  };
  return { exec, calls };
}

test('round-trips one Keychain item per account with the secret only in stdin', async () => {
  const { exec, calls } = fakeSecurity();
  const store = createKeychainStore({ home, exec });

  await store.set('work', secret);
  assert.equal(await store.get('work'), secret);
  assert.equal(calls[0]?.command, 'security');
  assert.deepEqual(calls[0]?.args, ['-q', '-i']);
  assert.equal(calls[0]?.input, `add-generic-password -U -s "teamscli" -a "${accountKey('work', home)}" -w "synthetic \\"quoted\\" \\\\ path"\n`);
  assert.deepEqual(calls[1]?.args, ['find-generic-password', '-s', 'teamscli', '-a', accountKey('work', home), '-w']);
  assert.ok(calls.every(({ args }) => args.every((arg) => !arg.includes(secret))));
});

test('rejects line breaks instead of letting them create another security command', async () => {
  const { exec } = fakeSecurity();
  const store = createKeychainStore({ home, exec });
  await assert.rejects(store.set('work', 'synthetic first line\nsecond line'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});

test('missing Keychain item is null and delete is idempotent', async () => {
  const { exec } = fakeSecurity();
  const store = createKeychainStore({ home, exec });
  assert.equal(await store.get('work'), null);
  await store.delete('work');
  await store.delete('work');
  await store.set('work', secret);
  await store.delete('work');
  await store.delete('work');
  assert.equal(await store.get('work'), null);
});

test('isolates the same Keychain account across different homes', async () => {
  const firstHome = '/synthetic/home-one';
  const secondHome = '/synthetic/home-two';
  const firstSecret = 'synthetic secret one';
  const secondSecret = 'synthetic secret two';
  const { exec } = fakeSecurity([firstSecret, secondSecret]);
  const first = createKeychainStore({ home: firstHome, exec });
  const second = createKeychainStore({ home: secondHome, exec });

  await first.set('default', firstSecret);
  assert.equal(await second.get('default'), null);
  await second.set('default', secondSecret);
  assert.equal(await first.get('default'), firstSecret);
  assert.equal(await second.get('default'), secondSecret);
});

test('Keychain errors and missing command suggest file without echoing output', async () => {
  const failing: Exec = async () => ({ stdout: `synthetic ${secret}`, stderr: `synthetic ${secret}`, code: 1 });
  const store = createKeychainStore({ home, exec: failing });
  await assert.rejects(store.set('work', secret), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message) && !error.message.includes(secret));

  const missing = createKeychainStore({ home, exec: async () => { throw new Error('synthetic command missing'); } });
  await assert.rejects(missing.get('work'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});
