import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDpapiStore } from '../../src/auth/secrets-dpapi.ts';
import { CliError } from '../../src/errors.ts';
import type { Exec } from '../../src/runtime/exec.ts';

/** Fake powershell.exe: "encrypts" by reversing the base64 of the input. */
function fakePowershell() {
  const calls: { command: string; args: string[]; input: string }[] = [];
  const exec: Exec = async (command, args, input = '') => {
    calls.push({ command, args, input });
    const script = args.at(-1) ?? '';
    const stdout = script.includes('Unprotect(')
      ? Buffer.from([...input.trim()].reverse().join(''), 'base64').toString()
      : [...Buffer.from(input).toString('base64')].reverse().join('');
    return { stdout: stdout + '\r\n', stderr: '', code: 0 };
  };
  return { exec, calls };
}

test('round-trips the secret through powershell.exe stdin and stdout only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const { exec, calls } = fakePowershell();
  const store = createDpapiStore({ home, exec });

  await store.set('work', 'secret-refresh-token');
  const blobPath = join(home, 'accounts', 'work', 'refresh_token.dpapi');
  // Windows has no Unix permission bits.
  if (process.platform !== 'win32') assert.equal(statSync(blobPath).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(blobPath, 'utf8'), /secret-refresh-token/);
  assert.equal(await store.get('work'), 'secret-refresh-token');

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, 'powershell.exe');
    assert.ok(call.args.every((arg) => !arg.includes('secret-refresh-token')));
  }
  assert.equal(calls[0]?.input, 'secret-refresh-token');
});

test('missing blob is null without calling powershell.exe; delete is idempotent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const { exec, calls } = fakePowershell();
  const store = createDpapiStore({ home, exec });
  assert.equal(await store.get('work'), null);
  await store.set('work', 'secret');
  await store.delete('work');
  await store.delete('work');
  assert.equal(await store.get('work'), null);
  assert.equal(calls.length, 1);
});

test('powershell.exe failures are CliErrors that do not echo its output', async () => {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-'));
  const failing = createDpapiStore({ home, exec: async (_c, _a, input = '') => ({ stdout: '', stderr: `bad ${input}`, code: 1 }) });
  await assert.rejects(failing.set('work', 'secret'), (error) => error instanceof CliError && !error.message.includes('secret'));

  const missing = createDpapiStore({ home, exec: () => Promise.reject(new Error('spawn powershell.exe ENOENT')) });
  await assert.rejects(missing.set('work', 'secret'), (error) => error instanceof CliError && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});
