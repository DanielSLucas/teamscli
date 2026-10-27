import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from '../errors.ts';
import type { Exec } from '../runtime/exec.ts';
import { accountDir } from '../runtime/paths.ts';
import { readPrivateFile, writePrivateFile } from './secrets-file.ts';
import type { SecretStore } from './secrets.ts';

// Secrets and blobs travel only through stdin and stdout. Both are ASCII (token, base64), so the console code page does not matter.
const PROTECT = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security
$bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')))`;
const UNPROTECT = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security
$blob = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
[Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')))`;

/**
 * Windows DPAPI (CurrentUser) through powershell.exe, on Windows and WSL. The encrypted blob, in base64,
 * lives in `accounts/<account>/refresh_token.dpapi` with mode 0600. Each call takes about 0.5 s.
 */
export function createDpapiStore({ home, exec }: { home: string; exec: Exec }): SecretStore {
  const path = (account: string) => join(accountDir(home, account), 'refresh_token.dpapi');

  async function powershell(script: string, input: string): Promise<string> {
    let result;
    try {
      result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input);
    } catch (error) {
      throw new CliError('internal', 'Could not run powershell.exe for Windows DPAPI; set TEAMSCLI_SECRET_STORE=file to use a 0600 file instead.', null, { cause: error });
    }
    // stderr is not shown: it could echo input.
    if (result.code !== 0) throw new CliError('internal', `Windows DPAPI failed (powershell.exe exit ${result.code}).`);
    return result.stdout.trim();
  }

  return {
    kind: 'dpapi',
    async get(account) {
      const blob = await readPrivateFile(path(account));
      return blob === null ? null : await powershell(UNPROTECT, blob);
    },
    async set(account, secret) {
      await writePrivateFile(path(account), await powershell(PROTECT, secret));
    },
    delete: (account) => rm(path(account), { force: true }),
  };
}
