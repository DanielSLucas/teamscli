import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../../src/auth/secrets-file.ts';
import { runTestCli } from '../helpers/cli.ts';
import { aConversation } from '../helpers/builders.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertConversations } from '../../src/store/conversations.ts';

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'teamscli-accounts-'));
  try {
    await run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function cli(home: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return runTestCli(['--store', home, ...args], { env: { TEAMSCLI_SECRET_STORE: 'file', ...env } });
}

async function createDatabase(home: string, account: string, conversations = 0): Promise<void> {
  const db = openDatabase(databasePath(home, account));
  if (conversations) upsertConversations(db, Array.from({ length: conversations }, (_, i) => aConversation({ id: `${account}-${i}` })));
  db.close();
}

test('accounts add creates a private directory and list reports stable metadata without exposing the secret', async () => {
  await withHome(async (home) => {
    const added = await cli(home, ['accounts', 'add', 'work']);
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stderr, /teamscli --account work auth/);
    assert.equal(statSync(join(home, 'accounts', 'work')).mode & 0o777, 0o700);
    assert.equal((await cli(home, ['accounts', 'add', 'work'])).code, 2);
    assert.equal((await cli(home, ['accounts', 'add', 'alpha'])).code, 0);

    await cli(home, ['accounts', 'use', 'work']);
    await createFileStore({ home }).set('work', 'fixture');
    await createDatabase(home, 'work');

    const listed = await cli(home, ['--json', 'accounts', 'list']);
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(
      listed.stdout,
      '{"ok":true,"data":[{"name":"alpha","isDefault":false,"hasSecret":false,"hasDatabase":false},{"name":"work","isDefault":true,"hasSecret":true,"hasDatabase":true}]}\n',
    );
    assert.doesNotMatch(listed.stdout, /fixture/);
  });
});

test('account selection honors --account, TEAMSCLI_ACCOUNT, persisted default, and default fallback', async () => {
  await withHome(async (home) => {
    for (const name of ['default', 'env', 'saved', 'explicit']) {
      assert.equal((await cli(home, ['accounts', 'add', name])).code, 0);
      await createDatabase(home, name);
    }
    assert.equal((await cli(home, ['accounts', 'use', 'saved'])).code, 0);

    const selected = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
      const run = await cli(home, ['--json', 'store', 'stats', ...args], env);
      assert.equal(run.code, 0, run.stderr);
      return JSON.parse(run.stdout).data.account as string;
    };
    assert.equal(await selected([]), 'saved');
    assert.equal(await selected([], { TEAMSCLI_ACCOUNT: 'env' }), 'env');
    assert.equal(await selected(['--account', 'explicit'], { TEAMSCLI_ACCOUNT: 'env' }), 'explicit');

    const freshHome = mkdtempSync(join(tmpdir(), 'teamscli-accounts-fallback-'));
    try {
      await createDatabase(freshHome, 'default');
      const run = await cli(freshHome, ['--json', 'store', 'stats']);
      assert.equal(run.code, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).data.account, 'default');
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });
});

test('each account uses its own database', async () => {
  await withHome(async (home) => {
    for (const name of ['work', 'personal']) {
      assert.equal((await cli(home, ['accounts', 'add', name])).code, 0);
    }
    await createDatabase(home, 'work', 2);
    await createDatabase(home, 'personal', 1);

    for (const [name, conversations] of [['work', 2], ['personal', 1]] as const) {
      const run = await cli(home, ['--account', name, '--json', 'store', 'stats']);
      assert.equal(run.code, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).data.conversations, conversations);
    }
  });
});

test('accounts remove needs --yes, removes local data and secret, and clears the configured default', async () => {
  await withHome(async (home) => {
    const missing = await cli(home, ['accounts', 'use', 'missing']);
    assert.equal(missing.code, 5);
    assert.equal((await cli(home, ['accounts', 'add', 'work'])).code, 0);
    assert.equal((await cli(home, ['accounts', 'use', 'work'])).code, 0);
    await createFileStore({ home }).set('work', 'fixture');
    await createDatabase(home, 'work');

    const refused = await cli(home, ['accounts', 'remove', 'work']);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /--yes/);
    assert.equal(existsSync(join(home, 'accounts', 'work')), true);

    const removed = await cli(home, ['--json', 'accounts', 'remove', 'work', '-y']);
    assert.equal(removed.code, 0, removed.stderr);
    assert.deepEqual(JSON.parse(removed.stdout).data, { removed: 'work' });
    assert.equal(existsSync(join(home, 'accounts', 'work')), false);
    assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).defaultAccount, undefined);
  });
});

test('account commands name the first missing positional argument', async () => {
  await withHome(async (home) => {
    for (const name of ['add', 'use', 'remove']) {
      const run = await cli(home, ['accounts', name]);
      assert.equal(run.code, 2, name);
      assert.equal(run.stderr, 'teamscli: Missing the account name: pass it after the command.\n');
    }
  });
});

test('account names are validated and --read-only blocks add, use, and remove', async () => {
  await withHome(async (home) => {
    const invalid = await cli(home, ['accounts', 'add', '../outside']);
    assert.equal(invalid.code, 2);

    for (const args of [
      ['accounts', 'add', 'work'],
      ['accounts', 'use', 'work'],
      ['accounts', 'remove', 'work', '--yes'],
    ]) {
      const run = await cli(home, ['--read-only', ...args]);
      assert.equal(run.code, 4, args.join(' '));
    }
    assert.equal(existsSync(join(home, 'accounts')), false);
  });
});
