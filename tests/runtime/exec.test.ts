import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../../src/runtime/exec.ts';

test('passes input on stdin and returns output and exit code', async () => {
  const script = 'process.stdin.pipe(process.stdout); process.stdin.on("end", () => { process.stderr.write("done"); process.exitCode = 3; })';
  assert.deepEqual(await runCommand(process.execPath, ['-e', script], 'hello'), { stdout: 'hello', stderr: 'done', code: 3 });
});

test('rejects when the command does not exist', async () => {
  await assert.rejects(runCommand('teamscli-no-such-command', []));
});
