import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../../src/cli/program.ts';
import { databasePath } from '../../src/runtime/paths.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { upsertMessages } from '../../src/store/messages.ts';
import { upsertTeams } from '../../src/store/teams.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';
import { runTestCli } from '../helpers/cli.ts';

const mutatingCommands = [
  { name: 'auth', args: [] },
  { name: 'auth logout', args: [] },
  { name: 'accounts add', args: ['work'] },
  { name: 'accounts use', args: ['work'] },
  { name: 'accounts remove', args: ['work', '--yes'] },
  { name: 'sync', args: [] },
  { name: 'history fetch', args: ['--chat', 'chat-test'] },
  { name: 'send text', args: ['--chat', 'chat-test', '--message', 'Synthetic'] },
  { name: 'messages edit', args: ['message-test', '--chat', 'chat-test', '--message', 'Synthetic'] },
  { name: 'messages delete', args: ['message-test', '--chat', 'chat-test', '--yes'] },
  { name: 'files download', args: ['message-test', '--chat', 'chat-test'] },
] as const;

const databaseReadCommands = [
  { name: 'chats list', args: [] },
  { name: 'teams list', args: [] },
  { name: 'channels list', args: [] },
  { name: 'messages list', args: ['--chat', 'channel-1'] },
  { name: 'messages show', args: ['root', '--chat', 'channel-1'] },
  { name: 'messages thread', args: ['root', '--channel', 'channel-1'] },
  { name: 'messages search', args: ['synthetic'] },
  { name: 'history coverage', args: [] },
  { name: 'store stats', args: [] },
] as const;

test('the real command registry matches the explicit mutation table', async () => {
  const commands = await loadCommands();
  assert.deepEqual(
    commands.filter(({ mutates }) => mutates).map(({ name }) => name),
    mutatingCommands.map(({ name }) => name).sort(),
  );
  for (const { name } of databaseReadCommands) {
    assert.equal(commands.find((command) => command.name === name)?.mutates, false, `${name} must remain read-only`);
  }
});

test('--read-only refuses every mutating command before fetch or store changes', async () => {
  for (const { name, args } of mutatingCommands) {
    const store = mkdtempSync(join(tmpdir(), 'teamscli-read-only-'));
    try {
      const before = snapshotStore(store);
      let fetchCalls = 0;
      const fetch = async (): Promise<Response> => {
        fetchCalls++;
        throw new Error('unexpected fetch');
      };
      const run = await runTestCli(
        ['--store', store, '--read-only', '--json', ...name.split(' '), ...args],
        { env: { TEAMSCLI_SECRET_STORE: 'file' }, fetch: fetch as typeof globalThis.fetch },
      );

      assert.equal(run.code, 4, `${name}: ${run.stdout}${run.stderr}`);
      assert.equal(JSON.parse(run.stdout).error.code, 'read_only', name);
      assert.equal(fetchCalls, 0, `${name} called fetch`);
      assert.equal(snapshotStore(store), before, `${name} touched the store`);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  }
});

test('--read-only database commands preserve messages.db and do not fetch', async () => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-read-only-'));
  try {
    seedStore(store);
    const dbPath = databasePath(store, 'default');
    const walPath = `${dbPath}-wal`;
    const dbHash = hashFile(dbPath);

    for (const { name, args } of databaseReadCommands) {
      let fetchCalls = 0;
      const fetch = async (): Promise<Response> => {
        fetchCalls++;
        throw new Error('unexpected fetch');
      };
      const run = await runTestCli(
        ['--store', store, '--read-only', '--json', ...name.split(' '), ...args],
        { fetch: fetch as typeof globalThis.fetch },
      );

      assert.equal(run.code, 0, `${name}: ${run.stdout}${run.stderr}`);
      assert.equal(fetchCalls, 0, `${name} called fetch`);
      assert.equal(hashFile(dbPath), dbHash, `${name} changed messages.db`);
      if (existsSync(walPath)) {
        assert.equal(statSync(walPath).size, 0, `${name} created a WAL with content`);
      }
    }
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

function seedStore(store: string): void {
  const db = openDatabase(databasePath(store, 'default'));
  try {
    upsertTeams(db, [{ id: 'team-1', name: 'Example Team', description: null }]);
    upsertConversations(db, [
      aConversation({ id: 'group-1', kind: 'group', title: 'Example group' }),
      aConversation({ id: 'channel-1', kind: 'channel', title: 'Example channel', teamId: 'team-1' }),
    ]);
    upsertMessages(db, [
      aMessage({ id: 'root', conversationId: 'channel-1', text: 'Synthetic summary', content: 'Synthetic summary' }),
      aMessage({ id: 'reply', conversationId: 'channel-1', parentId: 'root', text: 'Synthetic reply', content: 'Synthetic reply' }),
    ]);
  } finally {
    db.close();
  }
}

function snapshotStore(root: string): string {
  const entries: { path: string; kind: string; mtimeMs: number; size: number; hash?: string }[] = [];
  const visit = (path: string): void => {
    const stat = statSync(path);
    const entry = {
      path: relative(root, path),
      kind: stat.isDirectory() ? 'directory' : 'file',
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      ...(!stat.isDirectory() ? { hash: createHash('sha256').update(readFileSync(path)).digest('hex') } : {}),
    };
    entries.push(entry);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path).sort()) visit(join(path, child));
    }
  };
  visit(root);
  return JSON.stringify(entries.sort((a, b) => a.path.localeCompare(b.path)));
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
