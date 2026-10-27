import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { CliError, type ErrorCode } from '../errors.ts';
import { accountDir } from '../runtime/paths.ts';
import { createTeamsClient } from '../teams/client.ts';
import { createSession } from './session.ts';
import type { SecretStore } from './secrets.ts';

export interface DoctorCheck {
  name: 'node' | 'store' | 'secretStore' | 'login' | 'chatService' | 'csa';
  ok: boolean;
  detail: string;
}

export interface DoctorDeps {
  account: string;
  home: string;
  nodeVersion: string;
  fetch: typeof fetch;
  createSecretStore: () => SecretStore;
  log: (message: string) => void;
  /** Passed to the session: false under `--read-only`. */
  persistRotation?: boolean;
}

/** Checks installation and Teams access; the session saves its rotated login unless `persistRotation` is false. */
export async function runDoctor({ account, home, nodeVersion, fetch, createSecretStore, log, persistRotation = true }: DoctorDeps): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  let firstFailure: ErrorCode | null = null;

  function record(check: DoctorCheck): void {
    checks.push(check);
    log(`${check.ok ? 'OK' : check.detail.startsWith('skipped:') ? 'SKIP' : 'FAIL'} ${check.name}: ${check.detail}`);
  }

  function fail(name: DoctorCheck['name'], code: ErrorCode, detail: string): void {
    firstFailure ??= code;
    record({ name, ok: false, detail });
  }

  function skip(names: DoctorCheck['name'][], dependency: string): void {
    for (const name of names) record({ name, ok: false, detail: `skipped: ${dependency} failed` });
  }

  function finish(): DoctorCheck[] {
    if (firstFailure) throw new CliError(firstFailure, 'Doctor found a problem; see the checks for details.', { checks });
    return checks;
  }

  const majorVersion = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
  if (majorVersion < 24 || !Number.isFinite(majorVersion)) {
    fail('node', 'usage', `Node.js ${nodeVersion} is unsupported; use version 24 or newer.`);
    skip(['store', 'secretStore', 'login', 'chatService', 'csa'], 'node');
    return finish();
  }
  record({ name: 'node', ok: true, detail: `Node.js ${nodeVersion}` });

  const directory = accountDir(home, account);
  let directoryIssue: 'missing' | 'not-directory' | 'not-writable' | null = null;
  try {
    directoryIssue = !(await stat(directory)).isDirectory() ? 'not-directory' : null;
    if (!directoryIssue) await access(directory, constants.W_OK);
  } catch (error) {
    directoryIssue = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'not-writable';
  }
  if (directoryIssue) {
    fail('store', directoryIssue === 'missing' ? 'not_found' : 'usage', {
      missing: 'Account directory does not exist.',
      'not-directory': 'Account store path is not a directory.',
      'not-writable': 'Account directory is not writable.',
    }[directoryIssue] ?? 'Account directory check failed.');
    skip(['secretStore', 'login', 'chatService', 'csa'], 'store');
    return finish();
  }
  record({ name: 'store', ok: true, detail: 'Account directory exists and is writable.' });

  let store: SecretStore | null = null;
  let hasSavedLogin = false;
  let secretStoreIssue: { code: ErrorCode; detail: string } | null = null;
  try {
    store = createSecretStore();
    hasSavedLogin = Boolean(await store.get(account));
  } catch (error) {
    secretStoreIssue = {
      code: error instanceof CliError ? error.code : 'usage',
      detail: 'Selected secret store is unavailable or could not be read.',
    };
  }
  if (secretStoreIssue) {
    fail('secretStore', secretStoreIssue.code, secretStoreIssue.detail);
    skip(['login', 'chatService', 'csa'], 'secretStore');
    return finish();
  }
  if (!hasSavedLogin) {
    fail('secretStore', 'auth_required', `Secret store: ${store?.kind}; no saved login.`);
    skip(['login', 'chatService', 'csa'], 'secretStore');
    return finish();
  }
  record({ name: 'secretStore', ok: true, detail: `Secret store: ${store?.kind}; saved login found.` });

  const session = createSession({ account, store: store as SecretStore, fetch, persistRotation });
  try {
    const signedIn = await session.account();
    record({ name: 'login', ok: true, detail: `userId: ${signedIn.userId ?? 'unavailable'}; region: ${signedIn.region}` });
  } catch (error) {
    const code = error instanceof CliError ? error.code : 'remote';
    fail('login', code, error instanceof CliError ? error.message : 'Could not renew the saved login.');
    skip(['chatService', 'csa'], 'login');
    return finish();
  }

  const client = createTeamsClient({ fetch, session });
  const endpoints = await session.endpoints();
  try {
    await client.json('chatService', `${endpoints.chatService}/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=1`);
    record({ name: 'chatService', ok: true, detail: 'HTTP 200.' });
  } catch (error) {
    const code = error instanceof CliError ? error.code : 'remote';
    fail('chatService', code, error instanceof CliError ? error.message : 'Could not check chatService.');
  }

  try {
    await client.json('csa', `${endpoints.csa}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`);
    record({ name: 'csa', ok: true, detail: 'HTTP 200.' });
  } catch (error) {
    const code = error instanceof CliError ? error.code : 'remote';
    fail('csa', code, error instanceof CliError ? error.message : 'Could not check csa.');
  }

  return finish();
}
