import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '-p', 'tsconfig.build.json'],
  { cwd: root, stdio: 'inherit' },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else {
  const source = join(root, 'src/store/migrations');
  const target = join(dist, 'store/migrations');
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(source).filter((name) => name.endsWith('.sql'))) {
    copyFileSync(join(source, file), join(target, file));
  }
}
