import type { ParseArgsOptionsConfig } from 'node:util';

/** Options accepted by every command, anywhere on the command line. */
export const GLOBAL_OPTIONS = {
  account: { type: 'string' },
  store: { type: 'string' },
  json: { type: 'boolean', default: false },
  events: { type: 'boolean', default: false },
  'read-only': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
} as const satisfies ParseArgsOptionsConfig;

export interface GlobalOptions {
  account: string | null;
  store: string | null;
  json: boolean;
  events: boolean;
  readOnly: boolean;
}

export interface CommandContext {
  options: GlobalOptions;
  /** Local state root (see runtime/paths.ts). */
  home: string;
  /** Validated account name; every account has its own directory and database. */
  account: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  /** Progress and diagnostics, to stderr. */
  log: (message: string) => void;
  /** One NDJSON event to stdout when `--events` is set; no-op otherwise. */
  emit: (type: string, data: unknown) => void;
}

export interface CommandInput {
  /** Command-specific option values, as returned by `parseArgs`. */
  values: Record<string, string | boolean | string[] | boolean[] | undefined>;
  positionals: string[];
}

export interface CommandOptionHelp {
  description?: string;
  valueName?: string;
}

/** `R` is what `run` returns; method syntax keeps every `Command<R>` assignable to `Command`. */
export interface Command<R = unknown> {
  /** Words that invoke it: `'messages search'`. The file is `commands/messages-search.ts`. */
  name: string;
  summary: string;
  /** Text after the name in help, e.g. `'<query> [--chat ID] [--limit N]'`. */
  usage?: string;
  /** Positional argument description shown in command help. */
  arguments?: string;
  options?: ParseArgsOptionsConfig;
  /** Per-option help keyed by the long option name. */
  optionHelp?: Record<string, CommandOptionHelp>;
  /** Allowed positional arguments; extra ones are a usage error. */
  maxPositionals?: number;
  /** True if it changes anything, local or remote. Such commands are refused under `--read-only`. */
  mutates: boolean;
  run(ctx: CommandContext, input: CommandInput): Promise<R>;
  /** Human rendering of `run`'s result. Without it the CLI picks a default (see output.ts). */
  render?(result: R): string;
}
