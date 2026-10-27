import { CliError } from '../errors.ts';

// Azure AD v2 endpoints with the public client of Teams web (see docs/authentication.md).
const AUTHORITY = 'https://login.microsoftonline.com/organizations/oauth2/v2.0';
const TEAMS_CLIENT_ID = '1fec8e78-bce4-4aaf-ab1b-5451cc387264';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Resources the CLI needs tokens for: `spaces` is exchanged for the skypetoken, `chatsvcagg` calls csa. */
export const SCOPES = {
  spaces: 'https://api.spaces.skype.com/.default',
  chatsvcagg: 'https://chatsvcagg.teams.microsoft.com/.default',
} as const;

export interface TokenSet {
  accessToken: string;
  /** Rotated on every refresh; null when the response did not include one. */
  refreshToken: string | null;
  expiresAt: Date;
}

export interface DeviceCode {
  /** What the user types at `verificationUri`. Safe to show. */
  userCode: string;
  verificationUri: string;
  expiresAt: Date;
  /** Seconds between polls. */
  interval: number;
  /** Secret: proves this login to AAD. Never shown. */
  deviceCode: string;
}

export interface AadDeps {
  fetch: typeof fetch;
  now: () => Date;
}

/** Starts a device code login for the Teams `spaces` scope, plus a refresh token. */
export async function requestDeviceCode({ fetch, now }: AadDeps): Promise<DeviceCode> {
  const { status, body } = await post(fetch, '/devicecode', { client_id: TEAMS_CLIENT_ID, scope: `${SCOPES.spaces} offline_access openid profile` });
  if (status !== 200 || typeof body.device_code !== 'string' || typeof body.user_code !== 'string') {
    throw new CliError('auth_required', `Azure AD refused the device code login (${errorCode(body, status)}).`);
  }
  return {
    userCode: body.user_code,
    verificationUri: String(body.verification_uri ?? 'https://microsoft.com/devicelogin'),
    expiresAt: new Date(now().getTime() + Number(body.expires_in ?? 900) * 1000),
    interval: Number(body.interval ?? 5),
    deviceCode: body.device_code,
  };
}

/** Polls until the user finishes (or abandons) the login in a browser. */
export async function waitForDeviceLogin(code: DeviceCode, { fetch, now, sleep = defaultSleep }: AadDeps & { sleep?: (ms: number) => Promise<void> }): Promise<TokenSet> {
  let interval = code.interval;
  for (;;) {
    if (now() >= code.expiresAt) throw new CliError('auth_required', 'The sign-in code expired; run "teamscli auth" again.');
    await sleep(interval * 1000);
    const { status, body } = await post(fetch, '/token', { grant_type: DEVICE_CODE_GRANT, client_id: TEAMS_CLIENT_ID, device_code: code.deviceCode });
    if (status === 200) return tokenSet(body, now);
    switch (body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5;
        continue;
      case 'authorization_declined':
        throw new CliError('auth_required', 'Sign-in was declined.');
      case 'expired_token':
        throw new CliError('auth_required', 'The sign-in code expired; run "teamscli auth" again.');
      default:
        throw new CliError('auth_required', `Sign-in failed (${errorCode(body, status)}).`);
    }
  }
}

/** Access token for `scope` from a refresh token. A rejected refresh token is `auth_required`. */
export async function refreshAccessToken(refreshToken: string, scope: string, { fetch, now }: AadDeps): Promise<TokenSet> {
  const { status, body } = await post(fetch, '/token', {
    grant_type: 'refresh_token',
    client_id: TEAMS_CLIENT_ID,
    refresh_token: refreshToken,
    scope: `${scope} offline_access`,
  });
  if (status === 200) return tokenSet(body, now);
  if (status === 400 || status === 401) {
    throw new CliError('auth_required', `The saved login expired or was revoked (${errorCode(body, status)}). Run "teamscli auth".`);
  }
  throw new CliError('remote', `Azure AD token request failed: ${status}.`, { status });
}

type AadBody = Record<string, unknown>;

async function post(fetch: typeof globalThis.fetch, path: string, form: Record<string, string>): Promise<{ status: number; body: AadBody }> {
  let response: Response;
  try {
    response = await fetch(AUTHORITY + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  } catch (error) {
    throw new CliError('remote', 'Could not reach Azure AD (login.microsoftonline.com).', null, { cause: error });
  }
  const text = await response.text();
  try {
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as AadBody };
  } catch {
    throw new CliError('remote', `Azure AD returned an unexpected response: ${response.status}.`, { status: response.status });
  }
}

function tokenSet(body: AadBody, now: () => Date): TokenSet {
  if (typeof body.access_token !== 'string') throw new CliError('remote', 'Azure AD returned no access token.');
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: new Date(now().getTime() + Number(body.expires_in ?? 3600) * 1000),
  };
}

/** The OAuth error code only: descriptions carry trace ids and are not useful to the user. */
function errorCode(body: AadBody, status: number): string {
  return typeof body.error === 'string' ? body.error : `HTTP ${status}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
