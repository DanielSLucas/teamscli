import assert from 'node:assert/strict';
import test from 'node:test';
import { CliError } from '../../src/errors.ts';
import { upsertConversations } from '../../src/store/conversations.ts';
import { openDatabase } from '../../src/store/database.ts';
import { setMembers, upsertPeople } from '../../src/store/people.ts';
import { resolveConversation, resolvePerson } from '../../src/store/resolve.ts';
import { upsertTeams } from '../../src/store/teams.ts';
import { aConversation } from '../helpers/builders.ts';

const self = '8:orgid:00000000-0000-0000-0000-000000000000';
const alice = '8:orgid:00000000-0000-0000-0000-000000000001';
const joao = '8:orgid:00000000-0000-0000-0000-000000000002';

function fixture() {
  const db = openDatabase(':memory:');
  upsertTeams(db, [
    { id: '19:team-a@thread.tacv2', name: 'Engineering', description: null },
    { id: '19:team-b@thread.tacv2', name: 'Sales', description: null },
  ]);
  upsertConversations(db, [
    aConversation({ id: '19:group-1@thread.v2', kind: 'group', title: 'Fechamento mensal' }),
    aConversation({ id: '19:group-2@thread.v2', kind: 'group', title: 'Fechamento anual' }),
    aConversation({ id: '19:chan-a@thread.tacv2', kind: 'channel', title: 'General', teamId: '19:team-a@thread.tacv2' }),
    aConversation({ id: '19:chan-b@thread.tacv2', kind: 'channel', title: 'General', teamId: '19:team-b@thread.tacv2' }),
    aConversation({ id: '19:alice_self@unq.gbl.spaces', kind: 'chat', title: null }),
    aConversation({ id: '19:joao_self@unq.gbl.spaces', kind: 'chat', title: null }),
  ]);
  upsertPeople(db, [
    { id: self, displayName: 'Me Example', email: 'me@example.com' },
    { id: alice, displayName: 'Alice Example', email: 'alice@example.com' },
    { id: joao, displayName: 'João Ninguém', email: 'joao@example.com' },
  ]);
  setMembers(db, '19:alice_self@unq.gbl.spaces', [
    { conversationId: '19:alice_self@unq.gbl.spaces', personId: self, role: 'User' },
    { conversationId: '19:alice_self@unq.gbl.spaces', personId: alice, role: 'User' },
  ]);
  setMembers(db, '19:joao_self@unq.gbl.spaces', [
    { conversationId: '19:joao_self@unq.gbl.spaces', personId: self, role: 'User' },
    { conversationId: '19:joao_self@unq.gbl.spaces', personId: joao, role: 'User' },
  ]);
  return db;
}

function rejects(fn: () => unknown, code: string): CliError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CliError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail('expected an error');
}

test('exact id wins over names', () => {
  const db = fixture();
  assert.equal(resolveConversation(db, '19:group-2@thread.v2', self).id, '19:group-2@thread.v2');
  assert.equal(resolvePerson(db, alice).id, alice);
});

test('exact name, ignoring case and accents, beats a prefix match', () => {
  const db = fixture();
  assert.equal(resolveConversation(db, 'FECHAMENTO MENSAL', self).id, '19:group-1@thread.v2');
  assert.equal(resolvePerson(db, 'joao ninguem').id, joao);
});

test('prefix and substring match when nothing matches exactly', () => {
  const db = fixture();
  assert.equal(resolveConversation(db, 'fechamento m', self).id, '19:group-1@thread.v2');
  assert.equal(resolveConversation(db, 'anual', self).id, '19:group-2@thread.v2');
  assert.equal(resolvePerson(db, 'alice@').id, alice);
});

test('several candidates at the strongest level is an ambiguous error listing them', () => {
  const db = fixture();
  const error = rejects(() => resolveConversation(db, 'fechamento', self), 'ambiguous');
  assert.deepEqual(error.details, {
    candidates: [
      { id: '19:group-2@thread.v2', kind: 'group', title: 'Fechamento anual' },
      { id: '19:group-1@thread.v2', kind: 'group', title: 'Fechamento mensal' },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  });
  assert.match(error.message, /19:group-1@thread\.v2/);
});

test('channels resolve as Team/Channel; a bare shared channel name is ambiguous', () => {
  const db = fixture();
  assert.equal(resolveConversation(db, 'sales/general', self).id, '19:chan-b@thread.tacv2');
  const error = rejects(() => resolveConversation(db, 'General', self), 'ambiguous');
  assert.deepEqual((error.details as { candidates: unknown[] }).candidates.map((c) => (c as { title: string }).title).sort(),
    ['Engineering/General', 'Sales/General']);
});

test('one-on-one chat resolves by the other person, not by the signed-in user', () => {
  const db = fixture();
  assert.equal(resolveConversation(db, 'Joao Ninguem', self).id, '19:joao_self@unq.gbl.spaces');
  rejects(() => resolveConversation(db, 'Me Example', self), 'not_found');
  rejects(() => resolveConversation(db, 'Me Example', null), 'ambiguous');
});

test('no match is not_found; blank is a usage error', () => {
  const db = fixture();
  rejects(() => resolveConversation(db, 'nothing like this', self), 'not_found');
  rejects(() => resolvePerson(db, 'Bob'), 'not_found');
  rejects(() => resolveConversation(db, '  ', self), 'usage');
});
