import { createSession, type AuthSession } from '../auth/session.ts';
import { selectSecretStore, type SecretStore } from '../auth/secrets.ts';
import { runCommand } from '../runtime/exec.ts';
import type { CommandContext } from './command.ts';

/** The account's secret store, with the real platform and command runner. */
export function secretStore(ctx: CommandContext): SecretStore {
  return selectSecretStore({ platform: process.platform, env: ctx.env, home: ctx.home, exec: runCommand });
}

/** Teams session for the selected account: what remote commands pass to `createTeamsClient`. */
export function teamsSession(ctx: CommandContext): AuthSession {
  return createSession({ account: ctx.account, store: secretStore(ctx), fetch: ctx.fetch });
}
