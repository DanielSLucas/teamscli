import { CliError } from '../errors.ts';
import type { Account } from '../models.ts';
import { authorize } from '../teams/authz.ts';
import type { Session } from '../teams/client.ts';
import { refreshAccessToken, SCOPES, type TokenSet } from './devicecode.ts';
import type { SecretStore } from './secrets.ts';

/** Renew a token this long before it expires. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export interface SessionDeps {
  account: string;
  store: SecretStore;
  fetch: typeof fetch;
  now?: () => Date;
  /** Tokens of a login that just finished; without it the refresh token comes from the store. */
  login?: TokenSet;
}

export interface AuthSession extends Session {
  /** Who is signed in and where, from the tokens and authz. */
  account(): Promise<Account>;
}

/**
 * Teams credentials for one account, cached for the life of the process. Every refresh rotates the
 * refresh token and saves the new one. A missing or rejected login is `auth_required`.
 */
export function createSession({ account, store, fetch, now = () => new Date(), login }: SessionDeps): AuthSession {
  let refreshToken: Promise<string> | null = login?.refreshToken ? Promise.resolve(login.refreshToken) : null;

  async function currentRefreshToken(): Promise<string> {
    refreshToken ??= store.get(account).then((token) => {
      if (token) return token;
      refreshToken = null;
      throw new CliError('auth_required', `Account "${account}" is not signed in. Run "teamscli auth".`);
    });
    return refreshToken;
  }

  function tokenFor(scope: string, initial?: TokenSet) {
    return untilExpiry(async () => {
      const used = await currentRefreshToken();
      const tokens = await refreshAccessToken(used, scope, { fetch, now });
      if (tokens.refreshToken && tokens.refreshToken !== used) {
        refreshToken = Promise.resolve(tokens.refreshToken);
        await store.set(account, tokens.refreshToken);
      }
      return tokens;
    }, now, initial);
  }

  const spaces = tokenFor(SCOPES.spaces, login);
  const chatsvcagg = tokenFor(SCOPES.chatsvcagg);
  const authorization = untilExpiry(async () => authorize((await spaces()).accessToken, { fetch, now }), now);

  return {
    async headers(service): Promise<Record<string, string>> {
      if (service === 'chatService') return { authentication: `skypetoken=${(await authorization()).skypeToken}` };
      return { authorization: `Bearer ${(await chatsvcagg()).accessToken}` };
    },
    endpoints: async () => (await authorization()).endpoints,
    async account() {
      const { region } = await authorization();
      const claims = jwtClaims((await spaces()).accessToken);
      const oid = typeof claims.oid === 'string' ? claims.oid : null;
      return { name: account, userId: oid && `8:orgid:${oid}`, tenantId: typeof claims.tid === 'string' ? claims.tid : null, region };
    },
  };
}

/** Caches `load`'s result until it is about to expire; concurrent callers share one load, failures are not cached. */
function untilExpiry<T extends { expiresAt: Date }>(load: () => Promise<T>, now: () => Date, initial?: T): () => Promise<T> {
  let current: Promise<T> | null = initial ? Promise.resolve(initial) : null;
  return async () => {
    const cached = current && (await current.catch(() => null));
    if (cached && cached.expiresAt.getTime() - now().getTime() > EXPIRY_MARGIN_MS) return cached;
    current = load();
    return current;
  };
}

/** Payload of a JWT access token, unverified: used only to show who is signed in. */
function jwtClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
