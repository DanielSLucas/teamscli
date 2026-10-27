import type { DatabaseSync } from 'node:sqlite';
import { createSession, type AuthSession } from '../auth/session.ts';
import { readIdentity } from '../auth/identity.ts';
import { selectSecretStore, type SecretStore } from '../auth/secrets.ts';
import type { Conversation } from '../models.ts';
import { runCommand } from '../runtime/exec.ts';
import { resolveConversation } from '../store/resolve.ts';
import type { CommandContext } from './command.ts';

/** The account's secret store, with the real platform and command runner. */
export function secretStore(ctx: CommandContext): SecretStore {
  return selectSecretStore({ platform: process.platform, env: ctx.env, home: ctx.home, exec: runCommand });
}

/** Teams session for the selected account: what remote commands pass to `createTeamsClient`. Under `--read-only` nothing is saved, not even the rotated refresh token. */
export function teamsSession(ctx: CommandContext, store: SecretStore = secretStore(ctx)): AuthSession {
  return createSession({ account: ctx.account, store, fetch: ctx.fetch, persistRotation: !ctx.options.readOnly });
}

/** Resolve a local conversation using the signed-in identity saved by auth or sync. */
export function resolveConversationTarget(ctx: CommandContext, db: DatabaseSync, query: string): Conversation {
  return resolveConversation(db, query, readIdentity(ctx.home, ctx.account)?.userId ?? null);
}
