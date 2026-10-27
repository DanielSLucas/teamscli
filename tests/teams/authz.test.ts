import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../../src/teams/authz.ts';
import { AUTHZ_ROUTE, AUTHZ_URL } from '../helpers/fake-auth.ts';
import { fakeFetch } from '../helpers/fake-fetch.ts';

const now = () => new Date('2026-01-01T00:00:00.000Z');

test('exchanges the spaces token for the skypetoken and regional endpoints', async () => {
  const { fetch, calls } = fakeFetch([AUTHZ_ROUTE]);
  assert.deepEqual(await authorize('test-spaces-token', { fetch, now }), {
    skypeToken: 'test-skypetoken',
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    region: 'test',
    endpoints: { chatService: 'https://chat.example.test', csa: 'https://teams.microsoft.com/api/csa/test' },
  });
  assert.equal(calls[0]?.headers.authorization, 'Bearer test-spaces-token');
});

test('401 is auth_required; an unexpected body is remote', async () => {
  await assert.rejects(authorize('t', { fetch: fakeFetch([{ method: 'POST', url: AUTHZ_URL, status: 401 }]).fetch, now }), { code: 'auth_required' });
  await assert.rejects(authorize('t', { fetch: fakeFetch([{ method: 'POST', url: AUTHZ_URL, json: { region: 'test' } }]).fetch, now }), { code: 'remote' });
});
