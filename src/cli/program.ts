import { readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CliError, EXIT_CODES } from '../errors.ts';
import { resolveAccount, resolveHome } from '../runtime/paths.ts';
import { GLOBAL_OPTIONS, type Command, type CommandContext, type GlobalOptions } from './command.ts';
import { describeError, eventLine, jsonFailure, jsonSuccess, renderHuman } from './output.ts';

/** Process-level side effects, injected so tests run the CLI in-process. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  now: () => Date;
}

/** Every file in `cli/commands/` default-exports one Command. Adding a command never edits a shared file. */
export async function loadCommands(): Promise<Command[]> {
  const dir = new URL('./commands/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => /\.(ts|js)$/.test(file) && !file.endsWith('.d.ts'));
  const modules = await Promise.all(files.map((file) => import(new URL(file, dir).href)));
  return modules.map((module) => module.default as Command).sort((a, b) => a.name.localeCompare(b.name));
}

/** Runs one invocation and returns the exit code. */
export async function runCli(argv: string[], io: CliIo, commands?: Command[]): Promise<number> {
  const json = argv.includes('--json');
  try {
    const all = commands ?? (await loadCommands());
    const { words, rest } = splitCommand(argv, all);
    const name = words.join(' ');
    const command = all.find((candidate) => candidate.name === name);
    const wantsHelp = rest.includes('--help') || rest.includes('-h');

    if (!command) {
      const listed = all.filter((candidate) => candidate.name.startsWith(name));
      if (wantsHelp) {
        io.stdout(generalHelp(listed) + '\n');
        return 0;
      }
      const unknown = rest.find((arg) => !arg.startsWith('-'));
      if (unknown !== undefined && words.length === 0) throw new CliError('usage', `Unknown command "${unknown}". Run "teamscli --help".`);
      io.stderr(generalHelp(listed) + '\n');
      return EXIT_CODES.usage;
    }

    const input = parse(command, rest);
    if (input.help) {
      io.stdout(commandHelp(command) + '\n');
      return 0;
    }
    const { options } = input;
    if (options.json && options.events) throw new CliError('usage', 'Use either --json or --events, not both.');
    if (command.mutates && options.readOnly) {
      throw new CliError('read_only', `"${command.name}" changes data and is disabled by --read-only.`);
    }

    const ctx: CommandContext = {
      options,
      home: resolveHome(options.store, io.env),
      account: resolveAccount(options.account, io.env),
      env: io.env,
      fetch: io.fetch,
      log: (message) => io.stderr(message + '\n'),
      emit: options.events ? (type, data) => io.stdout(eventLine(type, data, io.now()) + '\n') : () => {},
    };
    const result = await command.run(ctx, { values: input.values, positionals: input.positionals });

    if (options.json) io.stdout(jsonSuccess(result) + '\n');
    else if (!options.events) {
      const text = command.render ? command.render(result) : renderHuman(result);
      if (text) io.stdout(text + '\n');
    }
    return 0;
  } catch (error) {
    const { code, message, details, exitCode } = describeError(error);
    if (io.env.TEAMSCLI_DEBUG && error instanceof Error) io.stderr((error.stack ?? String(error)) + '\n');
    if (json) io.stdout(jsonFailure(code, message, details) + '\n');
    else io.stderr(`teamscli: ${message}\n`);
    return exitCode;
  }
}

/** Separates the command words from everything else. Global options may appear before the command. */
function splitCommand(argv: string[], commands: Command[]): { words: string[]; rest: string[] } {
  const words: string[] = [];
  const rest: string[] = [];
  let collecting = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    if (collecting && arg.startsWith('-')) {
      rest.push(arg);
      const option = GLOBAL_OPTIONS[arg.slice(2) as keyof typeof GLOBAL_OPTIONS];
      if (option?.type === 'string' && i + 1 < argv.length) rest.push(argv[++i] ?? '');
      continue;
    }
    const prefix = [...words, arg].join(' ');
    if (collecting && commands.some((c) => c.name === prefix || c.name.startsWith(prefix + ' '))) {
      words.push(arg);
      continue;
    }
    collecting = false;
    rest.push(arg);
  }
  return { words, rest };
}

function parse(command: Command, args: string[]) {
  const commandOptions = command.options ?? {};
  let parsed;
  try {
    parsed = parseArgs({ args, options: { ...GLOBAL_OPTIONS, ...commandOptions }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliError('usage', `${(error as Error).message} Run "teamscli ${command.name} --help".`);
  }
  const { values, positionals } = parsed;
  if (positionals.length > (command.maxPositionals ?? 0)) {
    throw new CliError('usage', `Unexpected argument "${positionals[command.maxPositionals ?? 0]}". Run "teamscli ${command.name} --help".`);
  }
  const options: GlobalOptions = {
    account: (values.account as string | undefined) ?? null,
    store: (values.store as string | undefined) ?? null,
    json: values.json === true,
    events: values.events === true,
    readOnly: values['read-only'] === true,
  };
  const own = Object.fromEntries(Object.entries(values).filter(([key]) => key in commandOptions));
  return { help: values.help === true, options, values: own, positionals };
}

function generalHelp(commands: Command[]): string {
  const width = Math.max(0, ...commands.map((command) => command.name.length));
  const exitCodes = Object.entries(EXIT_CODES).map(([code, exit]) => `${exit} ${code}`).join(', ');
  return [
    'Usage: teamscli [global options] <command> [options]',
    '',
    'Commands:',
    ...commands.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    GLOBAL_HELP,
    '',
    `Exit codes: 0 ok, ${exitCodes}.`,
  ].join('\n');
}

function commandHelp(command: Command): string {
  return [`Usage: teamscli ${command.name}${command.usage ? ' ' + command.usage : ''}`, '', command.summary, '', GLOBAL_HELP].join('\n');
}

const GLOBAL_HELP = `Global options:
  --account NAME  Account to use (default: $TEAMSCLI_ACCOUNT or "default")
  --store DIR     Local state directory (default: $TEAMSCLI_HOME or ~/.teamscli)
  --json          Print the result as one JSON document: {"ok":true,"data":...}
  --events        Stream NDJSON events to stdout (continuous operations)
  --read-only     Refuse any command that changes local or remote data
  -h, --help      Show help`;
