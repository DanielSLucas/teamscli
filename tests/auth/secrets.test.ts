import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSecretStore } from '../../src/auth/secrets.ts';
import { CliError } from '../../src/errors.ts';

const exec = async () => ({ stdout: '', stderr: '', code: 0 });
const select = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) => selectSecretStore({ platform, env, home: '/nonexistent', exec });

test('picks DPAPI on Windows and WSL', () => {
  assert.equal(select('win32').kind, 'dpapi');
  assert.equal(select('linux', { WSL_DISTRO_NAME: 'Ubuntu' }).kind, 'dpapi');
});

test('the plain file store is only used when asked for', () => {
  assert.equal(select('linux', { TEAMSCLI_SECRET_STORE: 'file' }).kind, 'file');
  assert.throws(() => select('linux'), (error) => error instanceof CliError && error.code === 'usage' && /TEAMSCLI_SECRET_STORE=file/.test(error.message));
});

test('an unknown store name is a usage error', () => {
  assert.throws(() => select('win32', { TEAMSCLI_SECRET_STORE: 'vault' }), (error) => error instanceof CliError && error.code === 'usage');
});
