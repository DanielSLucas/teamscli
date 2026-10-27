import { spawn } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs an external command. Secrets go through `input` (stdin), never through `args`. */
export type Exec = (command: string, args: string[], input?: string) => Promise<ExecResult>;

/** The real `Exec`. Rejects only when the command cannot start (e.g. not installed). */
export const runCommand: Exec = (command, args, input = '') =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    // The child may exit before reading stdin; its exit code reports that, not EPIPE.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
