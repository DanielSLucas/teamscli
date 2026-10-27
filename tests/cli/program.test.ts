import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const documented: Command = {
  name: 'things documented',
  summary: 'Inspect documented options',
  usage: '<query>',
  arguments: '<query>  Search phrase',
  options: {
    chat: { type: 'string' },
    channel: { type: 'string' },
    quiet: { type: 'boolean' },
  },
  optionHelp: {
    chat: { description: 'Conversation to inspect', valueName: 'ID' },
    channel: { description: 'Channel to inspect', valueName: 'NAME' },
  },
  mutates: false,
  async run() {
    return null;
  },
};

const deleteMessage: Command = {
  name: 'messages delete',
  summary: 'Delete a message',
  options: { chat: { type: 'string' } },
  mutates: true,
  async run() {
    return null;
  },
};

const commands = [echo, remove, missing, broken, follow, documented, deleteMessage];

test('help lists commands, global options and exit codes', async () => {
  const run = await runTestCli(['--help'], { commands });
  assert.equal(run.code, 0);
  assert.match(run.stdout, /things show\s+Show a thing/);
  assert.match(run.stdout, /--read-only/);
  assert.match(run.stdout, /3 auth_required/);
  assert.match(run.stdout, /default: --account, \$TEAMSCLI_ACCOUNT, the account set with "accounts use", or "default"/);
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
  assert.match(run.stdout, /Options:\n  --upper\n\nGlobal options: --account, --store, --json, --events, --read-only \(see teamscli --help\)/);
  assert.equal((run.stdout.match(/Global options:/g) ?? []).length, 1);
  assert.doesNotMatch(run.stdout, /--account NAME/);
});

test('command help shows option descriptions, values and positional text', async () => {
  const run = await runTestCli(['things', 'documented', '--help'], { commands });
  assert.equal(run.code, 0);
  assert.match(run.stdout, /Arguments: <query>  Search phrase/);
  assert.match(run.stdout, /Options:\n  --chat ID       Conversation to inspect\n  --channel NAME  Channel to inspect\n  --quiet/);
});

test('global options work before and after the command and are not passed as command values', async () => {
  calls.length = 0;
  const run = await runTestCli(['--account', 'work', 'things', 'show', 'box', '--upper', '--store', '/tmp/x', '--json'], { commands });
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(run.stdout), { ok: true, data: { name: 'BOX', home: resolve('/tmp/x'), account: 'work' } });
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

test('parse errors are concise and point to command help', async () => {
  const cases: [string[], string][] = [
    [['messages', 'delete', '-y'], `Unknown option '-y'. Run "teamscli messages delete --help".`],
    [['messages', 'delete', '--chat'], `Option '--chat' needs a value. Run "teamscli messages delete --help".`],
    [['things', 'show', 'a', 'b'], `Unexpected argument "b". Run "teamscli things show --help".`],
  ];
  for (const [argv, message] of cases) {
    const run = await runTestCli(argv, { commands });
    assert.equal(run.code, 2, argv.join(' '));
    assert.equal(run.stderr, `teamscli: ${message}\n`);
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

test('every real command documents its options and positional arguments', async () => {
  const store = mkdtempSync(join(tmpdir(), 'teamscli-help-'));
  try {
    for (const command of await loadCommands()) {
      const options = Object.entries(command.options ?? {});
      if (options.length === 0) continue;

      assert.deepEqual(Object.keys(command.optionHelp ?? {}).sort(), options.map(([name]) => name).sort(), command.name);
      const help = await runTestCli(['--store', store, ...command.name.split(' '), '--help']);
      assert.equal(help.code, 0, command.name);
      const flags = options.map(([name, config]) => {
        const option = command.optionHelp?.[name];
        return (config.short ? '-' + config.short + ', ' : '') + '--' + name + (option?.valueName ? ' ' + option.valueName : '');
      });
      const width = Math.max(...flags.map((flag) => flag.length));
      for (const [name, config] of options) {
        const option = command.optionHelp?.[name];
        assert.ok(option?.description, command.name + ' --' + name + ' description');
        if (config.type === 'string') assert.ok(option.valueName, command.name + ' --' + name + ' value name');
        const flag = (config.short ? '-' + config.short + ', ' : '') + '--' + name + (option.valueName ? ' ' + option.valueName : '');
        assert.ok(help.stdout.includes(flag.padEnd(width) + '  ' + option.description), command.name + ' help includes ' + flag);
        if (name === 'chat' || name === 'channel') {
          assert.match(option.description, /id, short id or name/);
        }
      }
      if ((command.maxPositionals ?? 0) > 0) {
        assert.ok(command.arguments, command.name + ' positional argument description');
        assert.ok(help.stdout.includes('Arguments: ' + command.arguments), command.name + ' help includes arguments');
      }
    }
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
});

test('the executable prints help', () => {
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('../../src/main.ts', import.meta.url)), '--help'], { encoding: 'utf8' });
  assert.match(stdout, /^Usage: teamscli/);
});
