import { CliError } from '../errors.ts';
import { createTeamsClient, type Endpoints } from './client.ts';

const AUTHZ_URL = 'https://teams.microsoft.com/api/authsvc/v1.0/authz';

export interface Authorization {
  skypeToken: string;
  expiresAt: Date;
  /** e.g. `amer`. */
  region: string;
  endpoints: Endpoints;
}

interface AuthzResponse {
  tokens?: { skypeToken?: string; expiresIn?: number };
  region?: string;
  regionGtms?: { chatService?: string };
}

/** Exchanges a `spaces` access token for the skypetoken and the account's regional endpoints. */
export async function authorize(spacesToken: string, { fetch, now }: { fetch: typeof globalThis.fetch; now: () => Date }): Promise<Authorization> {
  const client = createTeamsClient({
    fetch,
    session: {
      headers: async () => ({ authorization: `Bearer ${spacesToken}` }),
      endpoints: () => Promise.reject(new Error('authz has no endpoints yet')),
    },
  });
  const body = await client.json<AuthzResponse | null>('csa', AUTHZ_URL, { method: 'POST' }).catch((error: unknown) => {
    if (error instanceof CliError && (error.details as { status?: number } | null)?.status === 403) {
      throw new CliError(
        'auth_required',
        'Signed in to Azure AD, but this account has no access to Teams (no Teams license, a personal teams.live.com account, or a tenant policy). Sign in with a work account that uses Teams.',
        { status: 403 },
        { cause: error },
      );
    }
    throw error;
  });
  const skypeToken = body?.tokens?.skypeToken;
  const region = body?.region;
  const chatService = body?.regionGtms?.chatService;
  if (!skypeToken || !region || !chatService) throw new CliError('remote', 'Teams authz returned an unexpected response.');
  return {
    skypeToken,
    expiresAt: new Date(now().getTime() + Number(body.tokens?.expiresIn ?? 3600) * 1000),
    region,
    endpoints: { chatService: chatService.replace(/\/+$/, ''), csa: `https://teams.microsoft.com/api/csa/${region}` },
  };
}
