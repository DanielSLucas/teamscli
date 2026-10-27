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

test('picks Keychain on macOS and libsecret on Linux', () => {
  assert.equal(select('darwin').kind, 'keychain');
  assert.equal(select('linux').kind, 'libsecret');
});

test('the plain file store is only used when asked for', () => {
  assert.equal(select('linux', { TEAMSCLI_SECRET_STORE: 'file' }).kind, 'file');
  assert.equal(select('linux', { TEAMSCLI_SECRET_STORE: 'keychain' }).kind, 'keychain');
  assert.equal(select('darwin', { TEAMSCLI_SECRET_STORE: 'libsecret' }).kind, 'libsecret');
});

test('an unknown store name is a usage error', () => {
  assert.throws(() => select('win32', { TEAMSCLI_SECRET_STORE: 'vault' }), (error) => error instanceof CliError && error.code === 'usage');
});
