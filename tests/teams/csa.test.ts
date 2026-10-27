import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTeamsClient } from '../../src/teams/client.ts';
import { fetchTeamsAndChats } from '../../src/teams/csa.ts';
import { fakeFetch, fakeSession, TEST_ENDPOINTS } from '../helpers/fake-fetch.ts';

interface CsaFixture {
  teams: {
    id: string;
    description: string;
    channels: { id: string; displayName: string; parentTeamId: string; isMember: boolean; isDeleted: boolean }[];
  }[];
  chats: { id: string; members: { mri: string; role: string; friendlyName?: string }[] }[];
  metadata: { hasMoreChats: boolean; isPartialData: boolean };
}

const CSA_URL = `${TEST_ENDPOINTS.csa}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`;

function fixture(): CsaFixture {
  return JSON.parse(readFileSync(new URL('../fixtures/teams/csa-teams.json', import.meta.url), 'utf8')) as CsaFixture;
}

function client(payload: CsaFixture) {
  const fake = fakeFetch([{ url: CSA_URL, json: payload }]);
  return {
    client: createTeamsClient({ fetch: fake.fetch, session: fakeSession() }),
    calls: fake.calls,
  };
}

test('maps CSA teams, syncable channels, chat members and named people', async () => {
  const payload = fixture();
  const team = payload.teams[0]!;
  team.description = '';
  team.channels.push(
    { id: '19:deleted@thread.tacv2', displayName: 'Deleted', parentTeamId: team.id, isMember: true, isDeleted: true },
    { id: '19:not-member@thread.tacv2', displayName: 'Not a member', parentTeamId: team.id, isMember: false, isDeleted: false },
  );
  const { client: teamsClient, calls } = client(payload);

  const result = await fetchTeamsAndChats(teamsClient, TEST_ENDPOINTS);

  assert.deepEqual(result, {
    teams: [{ id: team.id, name: 'Example Team', description: null }],
    channels: [
      { id: team.id, kind: 'channel', title: 'General', teamId: team.id, lastMessageAt: null },
      { id: '19:5555eeee6666ffff7777aaaa8888bbbb@thread.tacv2', kind: 'channel', title: 'Announcements', teamId: team.id, lastMessageAt: null },
      { id: '19:9999cccc0000dddd1111eeee2222ffff@thread.tacv2', kind: 'channel', title: 'Leads', teamId: team.id, lastMessageAt: null },
    ],
    chatMembers: [
      {
        conversationId: '19:0a1b2c3d4e5f40718293a4b5c6d7e8f9@thread.v2',
        members: [
          { conversationId: '19:0a1b2c3d4e5f40718293a4b5c6d7e8f9@thread.v2', personId: '8:orgid:00000000-0000-4000-8000-000000000001', role: 'Admin' },
          { conversationId: '19:0a1b2c3d4e5f40718293a4b5c6d7e8f9@thread.v2', personId: '8:orgid:00000000-0000-4000-8000-000000000002', role: 'Admin' },
          { conversationId: '19:0a1b2c3d4e5f40718293a4b5c6d7e8f9@thread.v2', personId: '8:live:.cid.0000000000000000', role: 'Guest' },
        ],
      },
    ],
    people: [{ id: '8:orgid:00000000-0000-4000-8000-000000000002', displayName: 'Bob Example', email: null }],
    partial: false,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, CSA_URL);
  assert.equal(calls[0]?.headers.authorization, 'Bearer test-token');
});

test('reports either CSA incompleteness flag without paging', async () => {
  for (const metadata of [
    { hasMoreChats: true, isPartialData: false },
    { hasMoreChats: false, isPartialData: true },
  ]) {
    const payload = fixture();
    payload.metadata = metadata;
    const { client: teamsClient, calls } = client(payload);

    const result = await fetchTeamsAndChats(teamsClient, TEST_ENDPOINTS);

    assert.equal(result.partial, true);
    assert.equal(calls.length, 1);
  }
});
