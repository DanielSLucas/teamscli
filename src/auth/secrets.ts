import { CliError } from '../errors.ts';
import type { Exec } from '../runtime/exec.ts';
import { createDpapiStore } from './secrets-dpapi.ts';
import { createFileStore } from './secrets-file.ts';
import { createKeychainStore } from './secrets-keychain.ts';
import { createLibsecretStore } from './secrets-libsecret.ts';

export type SecretStoreKind = 'dpapi' | 'keychain' | 'libsecret' | 'file';

/** Keeps each account's refresh token outside the database. One secret per account. */
export interface SecretStore {
  /** Shown by `auth status` and `doctor`. */
  readonly kind: SecretStoreKind;
  /** The account's refresh token, or null when it has none. */
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  /** No error when there is nothing to delete. */
  delete(account: string): Promise<void>;
}

export interface SecretStoreDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exec: Exec;
}

/**
 * `TEAMSCLI_SECRET_STORE` when set (the only way to get the plain `file` store), otherwise by platform:
 * Windows and WSL use DPAPI through powershell.exe, macOS the Keychain, other systems libsecret.
 */
export function selectSecretStore({ platform, env, home, exec }: SecretStoreDeps): SecretStore {
  const kind = env.TEAMSCLI_SECRET_STORE || defaultKind(platform, env);
  switch (kind) {
    case 'dpapi':
      return createDpapiStore({ home, exec });
    case 'file':
      return createFileStore({ home });
    case 'keychain':
      return createKeychainStore({ home, exec });
    case 'libsecret':
      return createLibsecretStore({ home, exec });
    default:
      throw new CliError('usage', `Unknown TEAMSCLI_SECRET_STORE "${kind}": use dpapi, keychain, libsecret or file.`);
  }
}

function defaultKind(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): SecretStoreKind {
  if (platform === 'win32') return 'dpapi';
  if (platform === 'darwin') return 'keychain';
  // WSL has no keyring; powershell.exe reaches the Windows user's DPAPI.
  if (platform === 'linux' && (env.WSL_DISTRO_NAME || env.WSL_INTEROP)) return 'dpapi';
  return 'libsecret';
}
