import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshAccessToken, requestDeviceCode, SCOPES, waitForDeviceLogin, type DeviceCode } from '../../src/auth/devicecode.ts';
import { CliError } from '../../src/errors.ts';
import { AAD_DEVICECODE_URL, AAD_TOKEN_URL, tokenResponse } from '../helpers/fake-auth.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';

const now = () => new Date('2026-01-01T00:00:00.000Z');
const code: DeviceCode = { userCode: 'ABCD-EFGH', verificationUri: 'https://example.test/devicelogin', expiresAt: new Date('2026-01-01T00:15:00.000Z'), interval: 5, deviceCode: 'test-device-code' };

test('requests a device code for the Teams client with offline access', async () => {
  const { fetch, calls } = fakeFetch([
    { method: 'POST', url: AAD_DEVICECODE_URL, json: { device_code: 'test-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://example.test/devicelogin', expires_in: 900, interval: 5 } },
  ]);
  assert.deepEqual(await requestDeviceCode({ fetch, now }), code);
  const form = new URLSearchParams(String(calls[0]?.body));
  assert.equal(form.get('client_id'), '1fec8e78-bce4-4aaf-ab1b-5451cc387264');
  assert.match(form.get('scope') ?? '', /api\.spaces\.skype\.com\/\.default offline_access/);
});

test('polls through pending and slow_down until the user signs in', async () => {
  const { fetch, calls } = fakeFetch([
    { method: 'POST', url: AAD_TOKEN_URL, status: 400, json: { error: 'authorization_pending' }, times: 1 },
    { method: 'POST', url: AAD_TOKEN_URL, status: 400, json: { error: 'slow_down' }, times: 1 },
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse('test-access', 'test-refresh', 600) },
  ]);
  const sleeps: number[] = [];
  const tokens = await waitForDeviceLogin(code, { fetch, now, sleep: async (ms) => void sleeps.push(ms) });
  assert.deepEqual(tokens, { accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: new Date('2026-01-01T00:10:00.000Z') });
  assert.deepEqual(sleeps, [5000, 5000, 10000]);
  assert.equal(new URLSearchParams(String(calls[0]?.body)).get('device_code'), 'test-device-code');
});

test('declined or expired login is auth_required', async () => {
  const declined = fakeFetch([{ method: 'POST', url: AAD_TOKEN_URL, status: 400, json: { error: 'authorization_declined' } }]);
  await assert.rejects(waitForDeviceLogin(code, { fetch: declined.fetch, now, sleep: async () => {} }), { code: 'auth_required' });

  const late = () => new Date('2026-01-01T00:16:00.000Z');
  await assert.rejects(waitForDeviceLogin(code, { fetch: declined.fetch, now: late, sleep: async () => {} }), /expired/);
});

test('refresh asks for the scope and returns the rotated refresh token', async () => {
  const { fetch, calls } = fakeFetch([{ method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse('test-access', 'test-refresh-2') }]);
  const tokens = await refreshAccessToken('test-refresh-1', SCOPES.chatsvcagg, { fetch, now });
  assert.equal(tokens.refreshToken, 'test-refresh-2');
  const form = new URLSearchParams(String(calls[0]?.body));
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('scope'), `${SCOPES.chatsvcagg} offline_access`);
});

test('a rejected refresh token is auth_required and the error never contains it', async () => {
  const { fetch } = fakeFetch([{ method: 'POST', url: AAD_TOKEN_URL, status: 400, json: { error: 'invalid_grant', error_description: 'AADSTS70008: expired test-refresh-1' } }]);
  await assert.rejects(refreshAccessToken('test-refresh-1', SCOPES.spaces, { fetch, now }), (error) => {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, 'auth_required');
    assert.match(error.message, /invalid_grant/);
    assert.doesNotMatch(error.message, /test-refresh-1|AADSTS/);
    return true;
  });

  const down = fakeFetch([{ method: 'POST', url: AAD_TOKEN_URL, status: 503 }]);
  await assert.rejects(refreshAccessToken('test-refresh-1', SCOPES.spaces, { fetch: down.fetch, now }), { code: 'remote' });
});
