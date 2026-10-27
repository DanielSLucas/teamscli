import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTestCli } from '../helpers/cli.ts';

test('history fetch help documents the cutoff and page limit', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const run = await runTestCli(['--store', store, 'history', 'fetch', '--help']);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /--before ISO/);
  assert.match(run.stdout, /--pages N/);
});

test('history fetch is blocked by --read-only before using the session or fetch', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  let calls = 0;
  const run = await runTestCli(['--store', store, '--read-only', '--json', 'history', 'fetch', '--chat', 'chat-test'], {
    fetch: async () => { calls++; throw new Error('fetch must not run'); },
  });

  assert.equal(run.code, 4);
  assert.equal(JSON.parse(run.stdout).error.code, 'read_only');
  assert.equal(calls, 0);
});

test('history fetch rejects a chat that is not in the local store before using the session', async (t) => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  let calls = 0;
  const run = await runTestCli(['--store', store, '--json', 'history', 'fetch', '--chat', 'chat-missing'], {
    fetch: async () => { calls++; throw new Error('fetch must not run'); },
  });

  assert.equal(run.code, 5);
  assert.equal(JSON.parse(run.stdout).error.code, 'not_found');
  assert.equal(calls, 0);
});
