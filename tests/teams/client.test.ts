import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamsClient } from '../../src/teams/client.ts';
import { fakeFetch, fakeSession } from '../helpers/fake-fetch.ts';

const BASE = 'https://chat.example.test/v1/users/ME/conversations';

function client(routes: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(routes);
  const sleeps: number[] = [];
  const teams = createTeamsClient({
    fetch: fake.fetch,
    session: fakeSession(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { teams, calls: fake.calls, sleeps };
}

test('sends the service credentials and a JSON body', async () => {
  const { teams, calls } = client([{ method: 'POST', url: `${BASE}/48:notes/messages`, status: 201, json: { OriginalArrivalTime: 1 } }]);
  const result = await teams.json('chatService', `${BASE}/48:notes/messages`, { method: 'POST', body: { content: 'hi' } });
  assert.deepEqual(result, { OriginalArrivalTime: 1 });
  assert.equal(calls[0]?.headers.authentication, 'skypetoken=test-skypetoken');
  assert.equal(calls[0]?.headers['content-type'], 'application/json');
  assert.deepEqual(calls[0]?.body, { content: 'hi' });
});

test('429 waits for Retry-After and retries', async () => {
  const { teams, sleeps } = client([
    { url: BASE, status: 429, headers: { 'retry-after': '7' }, times: 1 },
    { url: BASE, json: { ok: true } },
  ]);
  assert.deepEqual(await teams.json('chatService', BASE), { ok: true });
  assert.deepEqual(sleeps, [7000]);
});

test('429 beyond the retry budget is rate_limited', async () => {
  const { teams, sleeps } = client([{ url: BASE, status: 429 }]);
  await assert.rejects(teams.json('chatService', BASE), { code: 'rate_limited' });
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
});

test('401 is auth_required, other failures are remote without the query string', async () => {
  const { teams } = client([
    { url: `${BASE}?a=1`, status: 401 },
    { url: `${BASE}?secret=1`, status: 500 },
  ]);
  await assert.rejects(teams.json('chatService', `${BASE}?a=1`), { code: 'auth_required' });
  await assert.rejects(teams.json('chatService', `${BASE}?secret=1`), (error: Error & { code: string }) => {
    assert.equal(error.code, 'remote');
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('a request timeout is a remote error without exposing its query string', async () => {
  let observedSignal: AbortSignal | undefined;
  const teams = createTeamsClient({
    fetch: async (_input, init) => {
      observedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        const fallback = setTimeout(() => reject(new Error('fetch did not time out')), 2000);
        observedSignal?.addEventListener('abort', () => {
          clearTimeout(fallback);
          reject(new Error('synthetic timeout abort'));
        }, { once: true });
      });
    },
    session: fakeSession(),
    requestTimeoutMs: 10,
  });

  await assert.rejects(teams.json('chatService', `${BASE}?x=synthetic`), (error: Error & { code: string }) => {
    assert.equal(error.code, 'remote');
    assert.equal(error.message, 'Teams did not answer in time (GET /v1/users/ME/conversations).');
    return true;
  });
  assert.equal(observedSignal?.aborted, true);
});

test('pages follow backwardLink and stop after an empty page', async () => {
  const page = (n: number, items: unknown[], link: string | null) => ({
    url: `${BASE}?page=${n}`,
    json: { conversations: items, _metadata: { backwardLink: link, syncState: `${BASE}?sync=${n}` } },
  });
  const { teams, calls } = client([page(1, [{ id: 'a' }], `${BASE}?page=2`), page(2, [{ id: 'b' }], `${BASE}?page=3`), page(3, [], `${BASE}?page=4`)]);

  const pages = [];
  for await (const p of teams.pages<{ id: string }>('chatService', `${BASE}?page=1`, 'conversations')) pages.push(p);

  assert.deepEqual(pages.map((p) => p.items.map((item) => item.id)), [['a'], ['b'], []]);
  assert.equal(pages.at(-1)?.syncState, `${BASE}?sync=3`);
  assert.equal(calls.length, 3);
});

test('pages stop when the link is missing', async () => {
  const { teams } = client([{ url: BASE, json: { messages: [{ id: '1' }], _metadata: {} } }]);
  const pages = [];
  for await (const p of teams.pages('chatService', BASE, 'messages')) pages.push(p);
  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.backwardLink, null);
});

test('rejects a cross-origin backwardLink without fetching it', async () => {
  const { teams, calls } = client([{
    url: `${BASE}?page=1`,
    json: { conversations: [{ id: 'a' }], _metadata: { backwardLink: 'https://other.example.test/page-2' } },
  }]);

  await assert.rejects(async () => {
    for await (const page of teams.pages('chatService', `${BASE}?page=1`, 'conversations')) void page;
  }, (error: Error & { code?: string }) => {
    assert.equal(error.code, 'remote');
    assert.equal(error.message, 'Teams returned a link to an unexpected host; refusing to follow it.');
    assert.doesNotMatch(error.message, /other\.example\.test/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('rejects an HTTP syncState before returning the page', async () => {
  const { teams, calls } = client([{
    url: `${BASE}?page=1`,
    json: { conversations: [], _metadata: { syncState: 'http://chat.example.test/sync' } },
  }]);

  await assert.rejects(async () => {
    for await (const page of teams.pages('chatService', `${BASE}?page=1`, 'conversations')) void page;
  }, (error: Error & { code?: string }) => {
    assert.equal(error.code, 'remote');
    assert.equal(error.message, 'Teams returned a link to an unexpected host; refusing to follow it.');
    return true;
  });
  assert.equal(calls.length, 1);
});

test('rejects an unexpected saved URL before fetching it', async () => {
  const { teams, calls } = client([]);

  await assert.rejects(async () => {
    for await (const page of teams.pages('chatService', 'https://other.example.test/saved', 'messages')) void page;
  }, (error: Error & { code?: string }) => {
    assert.equal(error.code, 'remote');
    assert.equal(error.message, 'Teams returned a link to an unexpected host; refusing to follow it.');
    assert.doesNotMatch(error.message, /other\.example\.test/);
    return true;
  });
  assert.equal(calls.length, 0);
});
