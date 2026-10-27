#!/usr/bin/env node
import { runCli } from './cli/program.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  fetch,
  now: () => new Date(),
});
