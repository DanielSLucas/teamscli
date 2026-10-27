import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmExecPath = process.env.npm_execpath;

if (!npmExecPath) throw new Error('Run this verifier with "npm run verify:pack".');

const temp = mkdtempSync(join(tmpdir(), 'teamscli-pack-'));
const install = join(temp, 'install');

function npm(label, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [npmExecPath, ...args], { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) {
    throw new Error(`${label} exited ${result.status}; expected ${expectedStatus}.\n${result.stdout}${result.stderr}`);
  }
  return result;
}

try {
  npm('pack', ['pack', '--pack-destination', temp]);

  const tarball = readdirSync(temp).find((file) => file.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack did not create a tarball.');

  mkdirSync(install, { recursive: true });
  npm('install', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--prefix', install, join(temp, tarball)]);

  const packageDir = join(install, 'node_modules/teamscli');
  const main = join(packageDir, 'dist/main.js');
  const migrations = join(packageDir, 'dist/store/migrations');
  if (!existsSync(main) || !existsSync(join(migrations, '001_initial.sql'))) {
    throw new Error('The package is missing its executable or SQLite migrations.');
  }
  if (!readFileSync(main, 'utf8').startsWith('#!/usr/bin/env node\n')) {
    throw new Error('The packaged executable is missing its Node.js shebang.');
  }
  if (existsSync(join(packageDir, 'src')) || existsSync(join(packageDir, 'tests'))) {
    throw new Error('The package includes source or test files.');
  }

  const help = npm('teamscli --help', ['exec', '--offline', '--prefix', install, '--', 'teamscli', '--help']);
  if (!help.stdout.includes('Usage: teamscli') || !help.stdout.includes('store stats')) {
    throw new Error(`The installed CLI did not print its command help.\n${help.stdout}${help.stderr}`);
  }

  const store = join(temp, 'store');
  const stats = npm('teamscli store stats', ['exec', '--offline', '--prefix', install, '--', 'teamscli', '--json', 'store', 'stats', '--store', store], 5);
  const failure = JSON.parse(stats.stdout);
  if (failure.ok !== false || failure.error?.code !== 'not_found') {
    throw new Error(`Expected a not_found JSON error; got ${stats.stdout}`);
  }

  console.log('verify:pack passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
