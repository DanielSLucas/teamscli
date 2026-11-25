import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatIdFromJoinUrl, createEvent, createMeetNow, getEvent, listEvents, respondToEvent } from '../../src/teams/calendar.ts';
import { createTeamsClient } from '../../src/teams/client.ts';
import { fakeFetch, fakeSession, type FakeRoute, type RecordedRequest } from '../helpers/fake-fetch.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/teams/${name}.json`, import.meta.url), 'utf8'));
const owaUrl = (action: string) => `https://outlook.office.com/owa/service.svc?action=${action}&app=Calendar`;
const GATEWAY = 'https://outlook.office.com/outlookgatewayb2/graphql';
const JOIN_URL = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_bmV3LW1lZXRpbmc%40thread.v2/0?context=%7b%7d';

function client(routes: FakeRoute[]) {
  const fake = fakeFetch(routes);
  return { teams: createTeamsClient({ fetch: fake.fetch, session: fakeSession() }), calls: fake.calls };
}

/** The OWA request JSON, from the header or the body. */
function owaRequest(call: RecordedRequest | undefined): any {
  const header = call?.headers['x-owa-urlpostdata'];
  return header ? JSON.parse(decodeURIComponent(header)) : call?.body;
}

const success = (body: Record<string, unknown> = {}) => ({ Body: { ResponseClass: 'Success', ResponseCode: 'NoError', ...body } });
const folderRoute: FakeRoute = {
  method: 'POST',
  url: owaUrl('GetFolder'),
  json: { Body: { ResponseMessages: { Items: [{ ResponseClass: 'Success', Folders: [{ FolderId: { Id: 'calendar-folder' } }] }] } } },
};
const onlineMeeting = {
  joinUrl: JOIN_URL,
  meetingDetails: '',
  providerType: 'TeamsForBusiness',
  providerProperties: [
    { key: 'links.update', value: 'https://scheduler.example.test/update', __typename: 'ProviderPropertiesEntry' },
    { key: 'links.options', value: 'https://teams.example.test/options', __typename: 'ProviderPropertiesEntry' },
    { key: 'links.shortJoinUrl', value: 'https://teams.microsoft.com/meet/1234567890123?p=ExAmPlE', __typename: 'ProviderPropertiesEntry' },
  ],
};
const meetingRoute: FakeRoute = { method: 'POST', url: GATEWAY, json: [{ data: { createOnlineMeeting: { onlineMeeting } } }] };

test('listEvents maps the calendar view in UTC, sorted by start, with organizer and chat', async () => {
  const { teams, calls } = client([{ method: 'POST', url: owaUrl('GetCalendarView'), json: fixture('calendar-view') }]);

  const events = await listEvents(teams, '2026-11-23T03:00:00.000Z', '2026-11-30T03:00:00.000Z');

  assert.deepEqual(events.map((event) => [event.subject, event.startAt, event.myResponse]), [
    ['Daily standup', '2026-11-25T12:00:00.000Z', 'accepted'],
    ['Planning', '2026-11-25T16:00:00.000Z', 'tentative'],
    ['Holiday', '2026-11-27T00:00:00.000Z', 'organizer'],
  ]);
  assert.deepEqual(events[1], {
    id: 'event-planning',
    subject: 'Planning',
    startAt: '2026-11-25T16:00:00.000Z',
    endAt: '2026-11-25T17:00:00.000Z',
    isAllDay: false,
    organizer: { name: 'Bob Example', email: 'bob@example.com' },
    myResponse: 'tentative',
    isOrganizer: false,
    isOnlineMeeting: true,
    isRecurring: false,
    isCancelled: false,
    location: 'Microsoft Teams Meeting',
    chatId: '19:meeting_cGxhbm5pbmc@thread.v2',
  });
  assert.equal(events[0]?.isRecurring, true);
  assert.equal(events[2]?.isAllDay, true);

  const call = calls[0];
  assert.equal(call?.headers.action, 'GetCalendarView');
  assert.equal(call?.headers.authorization, 'Bearer test-token');
  const request = owaRequest(call);
  assert.equal(request.Header.TimeZoneContext.TimeZoneDefinition.Id, 'UTC');
  assert.equal(request.Body.RangeStart, '2026-11-23T03:00:00.000');
  assert.equal(request.Body.RangeEnd, '2026-11-30T03:00:00.000');
  assert.equal(request.Body.OptimizeExtendedPropertyLoading, true);
});

test('getEvent returns attendees, the join link and the description without the Teams block', async () => {
  const { teams, calls } = client([{ method: 'POST', url: owaUrl('GetItem'), json: fixture('calendar-item') }]);

  const event = await getEvent(teams, 'event-planning');

  assert.equal(event.joinUrl, 'https://teams.microsoft.com/meet/1234567890123?p=ExAmPlE');
  assert.equal(event.chatId, '19:meeting_cGxhbm5pbmc@thread.v2');
  assert.equal(event.description, 'Agenda: review the release.');
  assert.deepEqual(event.attendees, [
    { name: 'Bob Example', email: 'bob@example.com', type: 'required', response: 'organizer' },
    { name: 'Alex Example', email: 'alex@example.com', type: 'required', response: 'tentative' },
    { name: 'Dave Example', email: 'dave@example.com', type: 'optional', response: 'none' },
  ]);
  assert.deepEqual(owaRequest(calls[0]).Body.ItemIds, [{ __type: 'ItemId:#Exchange', Id: 'event-planning' }]);
});

test('getEvent maps an unknown id to not_found', async () => {
  const { teams } = client([{
    method: 'POST',
    url: owaUrl('GetItem'),
    json: { Body: { ResponseMessages: { Items: [{ ResponseClass: 'Error', ResponseCode: 'ErrorItemNotFound' }] } } },
  }]);
  await assert.rejects(getEvent(teams, 'missing'), { code: 'not_found' });
});

test('respondToEvent sends the answer, the notify flag and the message as HTML', async () => {
  const { teams, calls } = client([{ method: 'POST', url: owaUrl('RespondToCalendarEvent'), json: success() }]);

  await respondToEvent(teams, 'event-planning', 'decline', { notify: false, message: 'Out <today>' });

  const body = owaRequest(calls[0]).Body;
  assert.deepEqual(body.EventId, { __type: 'ItemId:#Exchange', Id: 'event-planning' });
  assert.equal(body.Response, 'Decline');
  assert.equal(body.SendResponse, false);
  assert.equal(body.Notes.Value, '<div>Out &lt;today&gt;</div>');
});

test('respondToEvent turns an Outlook error into a remote error', async () => {
  const { teams } = client([{ method: 'POST', url: owaUrl('RespondToCalendarEvent'), json: { Body: { ResponseClass: 'Error', ResponseCode: 'ErrorAccessDenied' } } }]);
  await assert.rejects(respondToEvent(teams, 'event-planning', 'accept', { notify: true, message: null }), { code: 'remote', message: /ErrorAccessDenied/ });
});

test('createMeetNow asks for a MeetNow meeting in the calendar folder and returns its links and chat', async () => {
  const { teams, calls } = client([folderRoute, meetingRoute]);

  const meeting = await createMeetNow(teams, 'alex@example.com', 'Quick sync');

  assert.deepEqual(meeting, {
    subject: 'Quick sync',
    joinUrl: JOIN_URL,
    shortJoinUrl: 'https://teams.microsoft.com/meet/1234567890123?p=ExAmPlE',
    chatId: '19:meeting_bmV3LW1lZXRpbmc@thread.v2',
  });
  const variables = (calls[1]?.body as any)[0].variables;
  assert.deepEqual(variables, {
    mailboxId: 'alex@example.com',
    calendarId: 'calendar-folder',
    providerType: 'TeamsForBusiness',
    providerAdditionalProperties: [{ key: 'subject', value: 'Quick sync' }, { key: 'meetingType', value: 'MeetNow' }],
  });
});

test('createEvent creates the Teams meeting, posts the event in the body and returns it', async () => {
  const { teams, calls } = client([
    folderRoute,
    meetingRoute,
    { method: 'POST', url: owaUrl('CreateCalendarEvent'), json: { Body: { ResponseMessages: { Items: [{ ResponseClass: 'Success', Items: [{ ItemId: { Id: 'event-planning' } }] }] } } } },
    { method: 'POST', url: owaUrl('GetItem'), json: fixture('calendar-item') },
  ]);

  const event = await createEvent(teams, 'alex@example.com', {
    subject: 'Planning',
    startAt: '2026-11-25T16:00:00.000Z',
    endAt: '2026-11-25T17:00:00.000Z',
    attendees: ['bob@example.com'],
    optionalAttendees: ['dave@example.com'],
    description: 'Agenda',
    online: true,
  });

  assert.equal(event.id, 'event-planning');
  assert.equal((calls[1]?.body as any)[0].variables.providerAdditionalProperties[0].value, 'Scheduled');
  const create = calls[2];
  assert.equal(create?.headers['x-owa-urlpostdata'], undefined);
  const item = (create?.body as any).Body.Items[0];
  assert.equal(item.Subject, 'Planning');
  assert.equal(item.Start, '2026-11-25T16:00:00.000');
  assert.equal(item.StartTimeZoneId, 'UTC');
  assert.deepEqual(item.RequiredAttendees, [{ Mailbox: { EmailAddress: 'bob@example.com', RoutingType: 'SMTP' } }]);
  assert.deepEqual(item.OptionalAttendees, [{ Mailbox: { EmailAddress: 'dave@example.com', RoutingType: 'SMTP' } }]);
  assert.equal(item.OnlineMeeting.joinUrl, JOIN_URL);
  assert.equal(item.OnlineMeetingProvider, 'TeamsForBusiness');
  assert.deepEqual(item.ExtendedProperty.map((property: any) => [property.ExtendedFieldURI.PropertyName, property.Value]), [
    ['SchedulingServiceUpdateUrl', 'https://scheduler.example.test/update'],
    ['SchedulingServiceMeetingOptionsUrl', 'https://teams.example.test/options'],
  ]);
  assert.equal((create?.body as any).Body.SavedItemFolderId.BaseFolderId.Id, 'calendar-folder');
});

test('createEvent without online skips the Teams meeting', async () => {
  const { teams, calls } = client([
    folderRoute,
    { method: 'POST', url: owaUrl('CreateCalendarEvent'), json: { Body: { ResponseMessages: { Items: [{ ResponseClass: 'Success', Items: [{ ItemId: { Id: 'event-planning' } }] }] } } } },
    { method: 'POST', url: owaUrl('GetItem'), json: fixture('calendar-item') },
  ]);

  await createEvent(teams, 'alex@example.com', {
    subject: 'Focus', startAt: '2026-11-25T16:00:00.000Z', endAt: '2026-11-25T17:00:00.000Z', attendees: [], optionalAttendees: [], description: null, online: false,
  });

  assert.equal(calls.some((call) => call.url === GATEWAY), false);
  assert.equal((calls[1]?.body as any).Body.Items[0].IsOnlineMeeting, undefined);
});

test('chatIdFromJoinUrl decodes the meeting thread and ignores other links', () => {
  assert.equal(chatIdFromJoinUrl(JOIN_URL), '19:meeting_bmV3LW1lZXRpbmc@thread.v2');
  assert.equal(chatIdFromJoinUrl('https://teams.microsoft.com/meet/123?p=x'), null);
});
