import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runTestCli } from '../helpers/cli.ts';
import { AAD_TOKEN_URL, fakeJwt, TEST_OID, TEST_TID, tokenResponse } from '../helpers/fake-auth.ts';
import { fakeFetch, type FakeRoute, type RecordedRequest } from '../helpers/fake-fetch.ts';
import { env, removeHome, signedInHome } from './message-mutation-setup.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/teams/${name}.json`, import.meta.url), 'utf8'));
const owaUrl = (action: string) => `https://outlook.office.com/owa/service.svc?action=${action}&app=Calendar`;
const GATEWAY = 'https://outlook.office.com/outlookgatewayb2/graphql';
const JOIN_URL = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_bmV3LW1lZXRpbmc%40thread.v2/0';

const viewRoute: FakeRoute = { method: 'POST', url: owaUrl('GetCalendarView'), json: fixture('calendar-view') };
const itemRoute: FakeRoute = { method: 'POST', url: owaUrl('GetItem'), json: fixture('calendar-item') };
const folderRoute: FakeRoute = { method: 'POST', url: owaUrl('GetFolder'), json: { Body: { ResponseMessages: { Items: [{ ResponseClass: 'Success', Folders: [{ FolderId: { Id: 'calendar-folder' } }] }] } } } };
const meetingRoute: FakeRoute = {
  method: 'POST',
  url: GATEWAY,
  json: [{ data: { createOnlineMeeting: { onlineMeeting: { joinUrl: JOIN_URL, meetingDetails: '', providerType: 'TeamsForBusiness', providerProperties: [] } } } }],
};

/** Every AAD token carries a upn, so commands know the mailbox. */
function outlookFetch(routes: FakeRoute[]) {
  return fakeFetch([
    { method: 'POST', url: AAD_TOKEN_URL, json: tokenResponse(fakeJwt({ oid: TEST_OID, tid: TEST_TID, upn: 'alex@example.com' }), 'synthetic-rotated-value') },
    ...routes,
  ]);
}

async function calendar(args: string[], routes: FakeRoute[]) {
  const home = signedInHome();
  try {
    const fake = outlookFetch(routes);
    const run = await runTestCli(['--store', home, '--account', 'work', ...args], { env, fetch: fake.fetch });
    return { run, calls: fake.calls.filter(({ url }) => url !== AAD_TOKEN_URL) };
  } finally {
    removeHome(home);
  }
}

const owaRequest = (call: RecordedRequest | undefined): any => {
  const header = call?.headers['x-owa-urlpostdata'];
  return header ? JSON.parse(decodeURIComponent(header)) : call?.body;
};

/** Same local-midnight arithmetic as the command, so the test holds in any timezone. */
const localMidnight = (year: number, month: number, day: number) => new Date(year, month - 1, day).toISOString().slice(0, 23);

test('calendar list defaults to the local week of now and returns the events', async () => {
  const { run, calls } = await calendar(['--json', 'calendar', 'list'], [viewRoute]);

  assert.equal(run.code, 0, run.stderr);
  const data = JSON.parse(run.stdout).data;
  assert.deepEqual(data.map((event: { subject: string }) => event.subject), ['Daily standup', 'Planning', 'Holiday']);
  // runTestCli's now is 2026-01-02T03:04:05Z: a Thursday or Friday locally, in the week of Monday 2025-12-29.
  const body = owaRequest(calls[0]).Body;
  assert.equal(body.RangeStart, localMidnight(2025, 12, 29));
  assert.equal(body.RangeEnd, localMidnight(2026, 1, 5));
});

test('calendar list --from/--to covers whole local days and renders a table', async () => {
  const { run, calls } = await calendar(['calendar', 'list', '--from', '2026-11-25', '--to', '2026-11-26'], [viewRoute]);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /Planning\s+Bob Example\s+tentative\s+event-planning/);
  assert.match(run.stdout, /all day\s+Holiday\s+you\s+organizer/);
  const body = owaRequest(calls[0]).Body;
  assert.equal(body.RangeStart, localMidnight(2026, 11, 25));
  assert.equal(body.RangeEnd, localMidnight(2026, 11, 27));
});

test('calendar list rejects malformed or reversed dates before calling Outlook', async () => {
  for (const args of [['--from', '2026-13-01'], ['--from', '25/11/2026'], ['--from', '2026-11-26', '--to', '2026-11-25']]) {
    const { run, calls } = await calendar(['calendar', 'list', ...args], []);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(calls.length, 0);
  }
});

test('calendar show returns the event detail', async () => {
  const { run, calls } = await calendar(['--json', 'calendar', 'show', 'event-planning'], [itemRoute]);

  assert.equal(run.code, 0, run.stderr);
  const data = JSON.parse(run.stdout).data;
  assert.equal(data.joinUrl, 'https://teams.microsoft.com/meet/1234567890123?p=ExAmPlE');
  assert.equal(data.chatId, '19:meeting_cGxhbm5pbmc@thread.v2');
  assert.equal(data.attendees.length, 3);
  assert.equal(owaRequest(calls[0]).Body.ItemIds[0].Id, 'event-planning');
});

test('calendar show renders attendees and description for people', async () => {
  const { run } = await calendar(['calendar', 'show', 'event-planning'], [itemRoute]);

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Planning\n/);
  assert.match(run.stdout, /join +https:\/\/teams\.microsoft\.com\/meet\//);
  assert.match(run.stdout, /optional +none +Dave Example <dave@example\.com>/);
  assert.match(run.stdout, /Description\n  Agenda: review the release\./);
});

test('calendar rsvp answers, then returns the refreshed event', async () => {
  const { run, calls } = await calendar(
    ['--json', 'calendar', 'rsvp', 'event-planning', 'decline', '--no-notify'],
    [{ method: 'POST', url: owaUrl('RespondToCalendarEvent'), json: { Body: { ResponseClass: 'Success' } } }, itemRoute],
  );

  assert.equal(run.code, 0, run.stderr);
  const body = owaRequest(calls[0]).Body;
  assert.equal(body.Response, 'Decline');
  assert.equal(body.SendResponse, false);
  assert.equal(JSON.parse(run.stdout).data.id, 'event-planning');
});

test('calendar rsvp validates the answer and refuses a message nobody would receive', async () => {
  for (const args of [['event-planning'], ['event-planning', 'maybe'], ['event-planning', 'accept', '--message', 'hi', '--no-notify']]) {
    const { run, calls } = await calendar(['calendar', 'rsvp', ...args], []);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(calls.length, 0);
  }
});

test('calendar meet-now creates the meeting in the signed-in mailbox', async () => {
  const { run, calls } = await calendar(['--json', 'calendar', 'meet-now', '--subject', 'Quick sync'], [folderRoute, meetingRoute]);

  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).data, { subject: 'Quick sync', joinUrl: JOIN_URL, shortJoinUrl: null, chatId: '19:meeting_bmV3LW1lZXRpbmc@thread.v2' });
  assert.equal((calls[1]?.body as any)[0].variables.mailboxId, 'alex@example.com');
  assert.equal(calls[1]?.headers['x-anchormailbox'], 'UPN:alex@example.com');
});

test('calendar create sends local times as UTC, attendees and the Teams meeting', async () => {
  const { run, calls } = await calendar(
    ['--json', 'calendar', 'create', '--subject', 'Planning', '--start', '2026-11-25T13:00', '--duration', '45', '--attendee', 'bob@example.com', '--optional', 'dave@example.com'],
    [folderRoute, meetingRoute, { method: 'POST', url: owaUrl('CreateCalendarEvent'), json: { Body: { ResponseMessages: { Items: [{ ResponseClass: 'Success', Items: [{ ItemId: { Id: 'event-planning' } }] }] } } } }, itemRoute],
  );

  assert.equal(run.code, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).data.id, 'event-planning');
  const item = (calls[2]?.body as any).Body.Items[0];
  assert.equal(item.Start, new Date(2026, 10, 25, 13, 0).toISOString().slice(0, 23));
  assert.equal(item.End, new Date(2026, 10, 25, 13, 45).toISOString().slice(0, 23));
  assert.deepEqual(item.RequiredAttendees.map((attendee: any) => attendee.Mailbox.EmailAddress), ['bob@example.com']);
  assert.deepEqual(item.OptionalAttendees.map((attendee: any) => attendee.Mailbox.EmailAddress), ['dave@example.com']);
  assert.equal(item.OnlineMeeting.joinUrl, JOIN_URL);
});

test('calendar create validates its options before calling Outlook', async () => {
  const cases = [
    ['--start', '2026-11-25T13:00'],
    ['--subject', 'X'],
    ['--subject', 'X', '--start', '2026-11-25'],
    ['--subject', 'X', '--start', '2026-02-30T10:00'],
    ['--subject', 'X', '--start', '2026-11-25T13:00', '--end', '2026-11-25T12:00'],
    ['--subject', 'X', '--start', '2026-11-25T13:00', '--end', '2026-11-25T14:00', '--duration', '30'],
    ['--subject', 'X', '--start', '2026-11-25T13:00', '--duration', '0'],
    ['--subject', 'X', '--start', '2026-11-25T13:00', '--attendee', 'not-an-email'],
    ['--subject', 'X', '--start', '2026-11-25T13:00', '--optional', 'a@b'],
  ];
  for (const args of cases) {
    const { run, calls } = await calendar(['calendar', 'create', ...args], []);
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(calls.length, 0);
  }
});
