import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { GLOBAL_OPTIONS, type Command } from '../../src/cli/command.ts';
import { loadCommands } from '../../src/cli/program.ts';
import { CliError } from '../../src/errors.ts';
import { runTestCli } from '../helpers/cli.ts';

const calls: unknown[] = [];

const echo: Command<{ name: string; home: string; account: string }> = {
  name: 'things show',
  summary: 'Show a thing',
  usage: '<name> [--upper]',
  options: { upper: { type: 'boolean' } },
  maxPositionals: 1,
  mutates: false,
  async run(ctx, input) {
    calls.push(input);
    const name = input.positionals[0] ?? 'none';
    return { name: input.values.upper ? name.toUpperCase() : name, home: ctx.home, account: ctx.account };
  },
  render: (result) => `thing ${result.name}`,
};

const remove: Command = {
  name: 'things remove',
  summary: 'Remove a thing',
  mutates: true,
  async run() {
    throw new Error('must not run under --read-only');
  },
};

const missing: Command = {
  name: 'things find',
  summary: 'Find a thing',
  mutates: false,
  async run() {
    throw new CliError('not_found', 'No such thing.', { candidates: [] });
  },
};

const broken: Command = {
  name: 'things break',
  summary: 'Fail unexpectedly',
  mutates: false,
  async run() {
    throw new TypeError('secret internals');
  },
};

const follow: Command = {
  name: 'things follow',
  summary: 'Stream events',
  mutates: false,
  async run(ctx) {
    ctx.emit('thing.seen', { id: 't1' });
    ctx.log('progress goes to stderr');
    return { done: true };
  },
};

const commands = [echo, remove, missing, broken, follow];

test('help lists commands, global options and exit codes', async () => {
  const run = await runTestCli(['--help'], { commands });
  assert.equal(run.code, 0);
  assert.match(run.stdout, /things show\s+Show a thing/);
  assert.match(run.stdout, /--read-only/);
  assert.match(run.stdout, /3 auth_required/);
});

test('a command group without a subcommand prints its commands and fails with usage', async () => {
  const run = await runTestCli(['things'], { commands });
  assert.equal(run.code, 2);
  assert.match(run.stderr, /things remove/);
});

test('command help shows usage', async () => {
  const run = await runTestCli(['things', 'show', '--help'], { commands });
  assert.equal(run.code, 0);
  assert.match(run.stdout, /Usage: teamscli things show <name> \[--upper\]/);
});

test('global options work before and after the command and are not passed as command values', async () => {
  calls.length = 0;
  const run = await runTestCli(['--account', 'work', 'things', 'show', 'box', '--upper', '--store', '/tmp/x', '--json'], { commands });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(run.stdout), { ok: true, data: { name: 'BOX', home: '/tmp/x', account: 'work' } });
  assert.deepEqual(calls, [{ values: { upper: true }, positionals: ['box'] }]);
});

test('human output uses the command renderer', async () => {
  const run = await runTestCli(['things', 'show', 'box'], { commands });
  assert.equal(run.stdout, 'thing box\n');
});

test('--read-only refuses mutating commands before they run', async () => {
  const run = await runTestCli(['--read-only', '--json', 'things', 'remove'], { commands });
  assert.equal(run.code, 4);
  assert.equal(JSON.parse(run.stdout).error.code, 'read_only');
});

test('expected errors map to their exit code and the --json failure envelope', async () => {
  const run = await runTestCli(['things', 'find', '--json'], { commands });
  assert.equal(run.code, 5);
  assert.deepEqual(JSON.parse(run.stdout), {
    ok: false,
    error: { code: 'not_found', message: 'No such thing.', details: { candidates: [] } },
  });
});

test('unexpected errors exit 1 without leaking their message', async () => {
  const run = await runTestCli(['things', 'break'], { commands });
  assert.equal(run.code, 1);
  assert.doesNotMatch(run.stderr, /secret internals/);
});

test('usage errors: unknown command, unknown option, extra positional, invalid account', async () => {
  for (const argv of [['nope'], ['things', 'show', '--nope'], ['things', 'show', 'a', 'b'], ['--account', '../x', 'things', 'show']]) {
    const run = await runTestCli(argv, { commands });
    assert.equal(run.code, 2, argv.join(' '));
    assert.equal(run.stdout, '');
  }
});

test('--events writes NDJSON to stdout, logs to stderr, and no final result', async () => {
  const run = await runTestCli(['things', 'follow', '--events'], { commands });
  assert.equal(run.code, 0);
  assert.deepEqual(run.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)), [
    { v: 1, type: 'thing.seen', at: '2026-01-02T03:04:05.000Z', data: { id: 't1' } },
  ]);
  assert.equal(run.stderr, 'progress goes to stderr\n');
});

test('--json and --events are exclusive', async () => {
  const run = await runTestCli(['things', 'follow', '--events', '--json'], { commands });
  assert.equal(run.code, 2);
});

test('registry: one file per command, named after it, without global option clashes', async () => {
  const files = readdirSync(new URL('../../src/cli/commands/', import.meta.url)).filter((file) => file.endsWith('.ts'));
  const registered = await loadCommands();
  assert.equal(registered.length, files.length);
  for (const command of registered) {
    assert.ok(files.includes(command.name.replaceAll(' ', '-') + '.ts'), `${command.name} lives in its own file`);
    assert.equal(typeof command.mutates, 'boolean', `${command.name} declares mutates`);
    for (const option of Object.keys(command.options ?? {})) {
      assert.ok(!(option in GLOBAL_OPTIONS), `${command.name} redefines global --${option}`);
    }
  }
});

test('the executable prints help', () => {
  const stdout = execFileSync(process.execPath, [new URL('../../src/main.ts', import.meta.url).pathname, '--help'], { encoding: 'utf8' });
  assert.match(stdout, /^Usage: teamscli/);
});
