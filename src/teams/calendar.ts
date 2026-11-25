import { CliError } from '../errors.ts';
import type { CalendarAttendee, CalendarEvent, CalendarEventDetail, CalendarPerson, CalendarResponse, OnlineMeeting } from '../models.ts';
import type { TeamsClient } from './client.ts';

// The Teams web Calendar app is Outlook on the web embedded in an iframe (docs/authentication.md, "Calendar").
// It calls OWA actions on service.svc and the Outlook GraphQL gateway with a Bearer token for outlook.office.com.
const OWA_URL = 'https://outlook.office.com/owa/service.svc';
const GATEWAY_URL = 'https://outlook.office.com/outlookgatewayb2/graphql';

/** Every time goes to Outlook and comes back in UTC, so models need no time zone mapping. */
const TIME_ZONE = 'UTC';

const HEADER = {
  __type: 'JsonRequestHeaders:#Exchange',
  RequestServerVersion: 'V2018_01_08',
  TimeZoneContext: { __type: 'TimeZoneContext:#Exchange', TimeZoneDefinition: { __type: 'TimeZoneDefinitionType:#Exchange', Id: TIME_ZONE } },
};

/** Named property holding the meeting chat (`{"cid":"19:meeting_…@thread.v2",…}`). */
const TEAMS_PROPERTIES = { __type: 'ExtendedPropertyUri:#Exchange', DistinguishedPropertySetId: 'PublicStrings', PropertyName: 'SkypeTeamsProperties', PropertyType: 'String' };

/** Property set Outlook uses for the Teams scheduling links of an event. */
const MEETING_PROPERTY_SET = '00020329-0000-0000-C000-000000000046';

const CREATE_ONLINE_MEETING = `mutation createOnlineMeeting($mailboxId: String!, $calendarId: String!, $providerType: OnlineMeetingProviderType!, $providerAdditionalProperties: [ProviderAdditionalPropertiesEntry]) {
  createOnlineMeeting(request: {mailboxId: $mailboxId, calendarId: $calendarId, providerType: $providerType, providerAdditionalProperties: $providerAdditionalProperties}) {
    onlineMeeting { joinUrl meetingDetails providerType providerProperties { key value } }
  }
}`;

interface RawMailbox {
  Name?: string;
  EmailAddress?: string;
  SmtpEmailAddress?: string;
}

interface RawAttendee {
  Mailbox?: RawMailbox;
  ResponseType?: string;
}

interface RawExtendedProperty {
  ExtendedFieldURI?: { PropertyName?: string };
  Value?: string;
}

interface RawCalendarItem {
  ItemId?: { Id?: string };
  Subject?: string;
  Start?: string;
  End?: string;
  IsAllDayEvent?: boolean;
  Organizer?: { Mailbox?: RawMailbox };
  ResponseType?: string;
  IsOrganizer?: boolean;
  IsOnlineMeeting?: boolean;
  IsMeeting?: boolean;
  IsRecurring?: boolean;
  CalendarItemType?: string;
  IsCancelled?: boolean;
  Location?: { DisplayName?: string };
  SkypeTeamsProperties?: string;
  ExtendedProperty?: RawExtendedProperty[];
  Body?: { Value?: string };
  RequiredAttendees?: RawAttendee[];
  OptionalAttendees?: RawAttendee[];
}

interface RawResponseMessage {
  ResponseClass?: string;
  ResponseCode?: string;
  Items?: RawCalendarItem[];
  Folders?: { FolderId?: { Id?: string } }[];
}

interface RawOnlineMeeting {
  joinUrl: string;
  meetingDetails: string | null;
  providerType: string;
  providerProperties: { key: string; value: string }[];
}

/** Events overlapping `[startAt, endAt)`, sorted by start. Recurring events come as one item per occurrence. */
export async function listEvents(client: TeamsClient, startAt: string, endAt: string): Promise<CalendarEvent[]> {
  const body = await owa<{ ResponseClass?: string; ResponseCode?: string; Items?: RawCalendarItem[] }>(client, 'GetCalendarView', {
    __type: 'GetCalendarViewRequest:#Exchange',
    CalendarId: { __type: 'TargetFolderId:#Exchange', BaseFolderId: { __type: 'DistinguishedFolderId:#Exchange', Id: 'calendar' } },
    RangeStart: owaTime(startAt),
    RangeEnd: owaTime(endAt),
    IncludeSkypeTeamsProperties: true,
    // Without it Outlook leaves out SkypeTeamsProperties, which holds the meeting chat id.
    OptimizeExtendedPropertyLoading: true,
  });
  assertSuccess(body);
  return (body.Items ?? []).map(mapEvent).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** One event with attendees, description and join link. */
export async function getEvent(client: TeamsClient, id: string): Promise<CalendarEventDetail> {
  const body = await owa<{ ResponseMessages?: { Items?: RawResponseMessage[] } }>(client, 'GetItem', {
    __type: 'GetItemRequest:#Exchange',
    ItemShape: { __type: 'ItemResponseShape:#Exchange', BaseShape: 'AllProperties', BodyType: 'Text', AdditionalProperties: [TEAMS_PROPERTIES] },
    ItemIds: [{ __type: 'ItemId:#Exchange', Id: id }],
  });
  const message = firstMessage(body);
  const item = message.Items?.[0];
  if (!item) throw new CliError('not_found', 'Calendar event not found.');
  return mapEventDetail(item);
}

export type RsvpAnswer = 'accept' | 'tentative' | 'decline';

const RSVP_RESPONSES: Record<RsvpAnswer, string> = { accept: 'Accept', tentative: 'Tentative', decline: 'Decline' };

/** Answers an invitation. With `notify` the organizer gets your answer (and `message`, if any) by email. */
export async function respondToEvent(client: TeamsClient, id: string, answer: RsvpAnswer, { notify, message }: { notify: boolean; message: string | null }): Promise<void> {
  const body = await owa<{ ResponseClass?: string; ResponseCode?: string }>(client, 'RespondToCalendarEvent', {
    __type: 'RespondToCalendarEventRequest:#Exchange',
    EventId: { __type: 'ItemId:#Exchange', Id: id },
    Response: RSVP_RESPONSES[answer],
    SendResponse: notify,
    Notes: { __type: 'BodyContentType:#Exchange', BodyType: 'HTML', Value: message === null ? '' : textToHtml(message) },
    ProposedStartTime: '',
    ProposedEndTime: '',
    Attendance: 0,
    Mode: 0,
  });
  assertSuccess(body);
}

/** A Teams meeting you can join right away, without a calendar event (the "Meet now" button). */
export async function createMeetNow(client: TeamsClient, mailbox: string, subject: string | null): Promise<OnlineMeeting> {
  const properties = [...(subject === null ? [] : [{ key: 'subject', value: subject }]), { key: 'meetingType', value: 'MeetNow' }];
  const meeting = await createOnlineMeeting(client, mailbox, await calendarFolderId(client), properties);
  return {
    subject,
    joinUrl: meeting.joinUrl,
    shortJoinUrl: providerProperty(meeting, 'links.shortJoinUrl'),
    chatId: chatIdFromJoinUrl(meeting.joinUrl),
  };
}

export interface NewEvent {
  subject: string;
  startAt: string;
  endAt: string;
  attendees: string[];
  optionalAttendees: string[];
  description: string | null;
  /** Adds a Teams meeting (join link and chat), as the Teams Calendar does by default. */
  online: boolean;
}

/** Creates an event in your calendar and invites the attendees, as the Teams Calendar "New event" form does. */
export async function createEvent(client: TeamsClient, mailbox: string, event: NewEvent): Promise<CalendarEventDetail> {
  const calendarId = await calendarFolderId(client);
  const meeting = event.online ? await createOnlineMeeting(client, mailbox, calendarId, [{ key: 'meetingType', value: 'Scheduled' }]) : null;
  const attendees = (emails: string[]) => emails.map((email) => ({ Mailbox: { EmailAddress: email, RoutingType: 'SMTP' } }));
  const item = {
    __type: 'CalendarItem:#Exchange',
    Subject: event.subject,
    Body: { BodyType: 'HTML', Value: event.description === null ? '' : textToHtml(event.description) },
    Start: owaTime(event.startAt),
    End: owaTime(event.endAt),
    StartTimeZoneId: TIME_ZONE,
    EndTimeZoneId: TIME_ZONE,
    IsAllDayEvent: false,
    FreeBusyType: 'Busy',
    IsResponseRequested: true,
    IsDraft: false,
    RequiredAttendees: attendees(event.attendees),
    OptionalAttendees: attendees(event.optionalAttendees),
    ...(meeting === null ? {} : {
      IsOnlineMeeting: true,
      OnlineMeetingProvider: 'TeamsForBusiness',
      OnlineMeeting: meeting,
      ExtendedProperty: [
        meetingProperty('SchedulingServiceUpdateUrl', providerProperty(meeting, 'links.update')),
        meetingProperty('SchedulingServiceMeetingOptionsUrl', providerProperty(meeting, 'links.options')),
      ].filter((property) => property !== null),
    }),
  };
  // The web client sends SendToNone and Outlook still sends the invitations for this action (validated).
  const body = await owa<{ ResponseMessages?: { Items?: RawResponseMessage[] } }>(client, 'CreateCalendarEvent', {
    __type: 'CreateItemRequest:#Exchange',
    SavedItemFolderId: { __type: 'TargetFolderId:#Exchange', BaseFolderId: { __type: 'FolderId:#Exchange', Id: calendarId } },
    ItemShape: { __type: 'ItemResponseShape:#Exchange', BaseShape: 'IdOnly' },
    SendMeetingInvitations: 'SendToNone',
    Items: [item],
  }, 'body');
  const id = firstMessage(body).Items?.[0]?.ItemId?.Id;
  if (!id) throw new CliError('remote', 'Outlook did not return the id of the new event.');
  return getEvent(client, id);
}

/**
 * Calls an OWA action. Most actions take the request JSON URL-encoded in `x-owa-urlpostdata` with an empty body;
 * `CreateCalendarEvent` takes it as the body.
 */
async function owa<T>(client: TeamsClient, action: string, body: Record<string, unknown>, carrier: 'header' | 'body' = 'header'): Promise<T> {
  const request = { __type: `${action}JsonRequest:#Exchange`, Header: HEADER, Body: body };
  const headers: Record<string, string> = { action, prefer: 'IdType="ImmutableId"' };
  if (carrier === 'header') {
    headers['x-owa-urlpostdata'] = encodeURIComponent(JSON.stringify(request));
    headers['content-type'] = 'application/json; charset=utf-8';
  }
  const response = await client.json<{ Body?: T } | null>('outlook', `${OWA_URL}?action=${action}&app=Calendar`, {
    method: 'POST',
    headers,
    ...(carrier === 'body' ? { body: request } : {}),
  });
  if (!response?.Body) throw new CliError('remote', `Outlook returned an unexpected answer to ${action}.`);
  return response.Body;
}

async function calendarFolderId(client: TeamsClient): Promise<string> {
  const body = await owa<{ ResponseMessages?: { Items?: RawResponseMessage[] } }>(client, 'GetFolder', {
    __type: 'GetFolderRequest:#Exchange',
    FolderShape: { __type: 'FolderResponseShape:#Exchange', BaseShape: 'IdOnly' },
    FolderIds: [{ __type: 'DistinguishedFolderId:#Exchange', Id: 'calendar' }],
  });
  const id = firstMessage(body).Folders?.[0]?.FolderId?.Id;
  if (!id) throw new CliError('remote', 'Outlook did not return the calendar folder.');
  return id;
}

async function createOnlineMeeting(client: TeamsClient, mailbox: string, calendarId: string, properties: { key: string; value: string }[]): Promise<RawOnlineMeeting> {
  const response = await client.json<{ data?: { createOnlineMeeting?: { onlineMeeting?: RawOnlineMeeting } }; errors?: unknown[] }[]>('outlook', GATEWAY_URL, {
    method: 'POST',
    body: [{
      operationName: 'createOnlineMeeting',
      variables: { mailboxId: mailbox, calendarId, providerType: 'TeamsForBusiness', providerAdditionalProperties: properties },
      query: CREATE_ONLINE_MEETING,
    }],
  });
  const meeting = response?.[0]?.data?.createOnlineMeeting?.onlineMeeting;
  if (!meeting?.joinUrl) throw new CliError('remote', 'Outlook could not create the Teams meeting.');
  return {
    joinUrl: meeting.joinUrl,
    meetingDetails: meeting.meetingDetails ?? '',
    providerType: meeting.providerType,
    providerProperties: (meeting.providerProperties ?? []).map(({ key, value }) => ({ key, value })),
  };
}

function firstMessage(body: { ResponseMessages?: { Items?: RawResponseMessage[] } }): RawResponseMessage {
  const message = body.ResponseMessages?.Items?.[0];
  if (!message) throw new CliError('remote', 'Outlook returned an empty answer.');
  assertSuccess(message);
  return message;
}

/** Outlook answers HTTP 200 with `ResponseClass: Error` for failed operations. */
function assertSuccess({ ResponseClass, ResponseCode }: { ResponseClass?: string; ResponseCode?: string }): void {
  if (ResponseClass === undefined || ResponseClass === 'Success') return;
  if (ResponseCode === 'ErrorItemNotFound' || ResponseCode?.startsWith('ErrorInvalidId')) {
    throw new CliError('not_found', 'Calendar event not found; take the id from "teamscli calendar list".');
  }
  throw new CliError('remote', `Outlook refused the request (${ResponseCode ?? 'unknown error'}).`, { responseCode: ResponseCode ?? null });
}

function mapEvent(item: RawCalendarItem): CalendarEvent {
  const isOrganizer = item.IsOrganizer === true;
  return {
    id: item.ItemId?.Id ?? '',
    subject: item.Subject || null,
    startAt: utc(item.Start),
    endAt: utc(item.End),
    isAllDay: item.IsAllDayEvent === true,
    organizer: item.Organizer?.Mailbox ? person(item.Organizer.Mailbox) : null,
    myResponse: isOrganizer ? 'organizer' : response(item.ResponseType),
    isOrganizer,
    isOnlineMeeting: item.IsOnlineMeeting === true || teamsChatId(item) !== null,
    isRecurring: item.IsRecurring === true || (item.CalendarItemType !== undefined && item.CalendarItemType !== 'Single'),
    isCancelled: item.IsCancelled === true,
    location: item.Location?.DisplayName || null,
    chatId: teamsChatId(item),
  };
}

function mapEventDetail(item: RawCalendarItem): CalendarEventDetail {
  const text = (item.Body?.Value ?? '').replace(/\r\n/g, '\n');
  const attendees = (raw: RawAttendee[] | undefined, type: CalendarAttendee['type']): CalendarAttendee[] =>
    (raw ?? []).map((attendee) => ({ ...person(attendee.Mailbox ?? {}), type, response: response(attendee.ResponseType) }));
  return {
    ...mapEvent(item),
    joinUrl: /https:\/\/teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s<>"]+/.exec(text)?.[0] ?? null,
    attendees: [...attendees(item.RequiredAttendees, 'required'), ...attendees(item.OptionalAttendees, 'optional')],
    // The Teams invitation block sits between lines of underscores.
    description: text.replace(/_{20,}[\s\S]*_{20,}/, '').trim() || null,
  };
}

function response(value: string | undefined): CalendarResponse {
  switch (value) {
    case 'Organizer': return 'organizer';
    case 'Accept': return 'accepted';
    case 'Tentative': return 'tentative';
    case 'Decline': return 'declined';
    default: return 'none';
  }
}

/** Outlook gives an SMTP address or, for some mailboxes, an Exchange path (`/O=…`) plus a separate SMTP field. */
function person({ Name, EmailAddress, SmtpEmailAddress }: RawMailbox): CalendarPerson {
  const email = SmtpEmailAddress || (EmailAddress?.includes('@') && !EmailAddress.startsWith('/') ? EmailAddress : null);
  return { name: Name || null, email: email || null };
}

function teamsChatId(item: RawCalendarItem): string | null {
  const raw = item.SkypeTeamsProperties ?? item.ExtendedProperty?.find((property) => property.ExtendedFieldURI?.PropertyName === 'SkypeTeamsProperties')?.Value;
  if (!raw) return null;
  try {
    const cid = (JSON.parse(raw) as { cid?: unknown }).cid;
    return typeof cid === 'string' && cid.startsWith('19:') ? cid : null;
  } catch {
    return null;
  }
}

/** `https://teams.microsoft.com/l/meetup-join/19%3ameeting_…%40thread.v2/0?…` -> `19:meeting_…@thread.v2`. */
export function chatIdFromJoinUrl(url: string): string | null {
  const segment = /\/l\/meetup-join\/([^/?]+)/.exec(url)?.[1];
  if (!segment) return null;
  try {
    const id = decodeURIComponent(segment);
    return id.startsWith('19:') ? id : null;
  } catch {
    return null;
  }
}

function providerProperty(meeting: RawOnlineMeeting, key: string): string | null {
  return meeting.providerProperties.find((property) => property.key === key)?.value ?? null;
}

function meetingProperty(name: string, value: string | null) {
  if (value === null) return null;
  return {
    __type: 'ExtendedPropertyType:#Exchange',
    ExtendedFieldURI: { __type: 'ExtendedPropertyUri:#Exchange', PropertySetId: MEETING_PROPERTY_SET, PropertyName: name, PropertyType: 'String' },
    Value: value,
  };
}

/** `2026-11-25T14:00:00.000Z` -> `2026-11-25T14:00:00.000`, read by Outlook in the request time zone (UTC). */
function owaTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 23);
}

function utc(value: string | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) throw new CliError('remote', 'Outlook returned an event without a valid time.');
  return new Date(time).toISOString();
}

function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return escaped.split('\n').map((line) => `<div>${line || '<br>'}</div>`).join('');
}
