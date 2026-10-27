import type { Command } from '../../src/cli/command.ts';
import { runCli, type CliIo } from '../../src/cli/program.ts';

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI in-process with captured output. Without `commands`, uses the real registry.
 * `fetch` fails by default so no test reaches the network by accident.
 */
export async function runTestCli(argv: string[], overrides: Partial<CliIo> & { commands?: Command[] } = {}): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const { commands, ...io } = overrides;
  const code = await runCli(
    argv,
    {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      env: {},
      fetch: () => Promise.reject(new Error('network disabled in tests')),
      now: () => new Date('2026-01-02T03:04:05.000Z'),
      ...io,
    },
    commands,
  );
  return { code, stdout, stderr };
}
