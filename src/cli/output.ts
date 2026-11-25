import { CliError, EXIT_CODES, type ErrorCode } from '../errors.ts';
import type { CalendarEvent, CalendarEventDetail, Message, OnlineMeeting, Quote, Reaction } from '../models.ts';

/**
 * `--json` contract: stdout gets exactly one JSON document.
 *   success: {"ok":true,"data":<result>}
 *   failure: {"ok":false,"error":{"code":"not_found","message":"…","details":null}}
 */
export function jsonSuccess(data: unknown): string {
  return JSON.stringify({ ok: true, data: data ?? null });
}

export function jsonFailure(code: ErrorCode, message: string, details: unknown): string {
  return JSON.stringify({ ok: false, error: { code, message, details } });
}

/**
 * `--events` contract: one JSON object per line on stdout.
 *   {"v":1,"type":"sync.progress","at":"2026-10-27T12:00:00.000Z","data":{…}}
 * `v` changes only on breaking changes to the envelope or to an event's data.
 */
export function eventLine(type: string, data: unknown, at: Date): string {
  return JSON.stringify({ v: 1, type, at: at.toISOString(), data });
}

/** Default human rendering when a command has no `render`. */
export function renderHuman(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    if (result.every(isRecord)) return table(result);
    return result.map(String).join('\n');
  }
  if (isRecord(result)) {
    const width = Math.max(0, ...Object.keys(result).map((key) => key.length));
    return Object.entries(result)
      .map(([key, value]) => `${key.padEnd(width)}  ${cell(value, key)}`)
      .join('\n');
  }
  return String(result);
}

/** Aligned text table. `columns` defaults to the keys of the first row. */
export function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const keys = columns ?? Object.keys(rows[0] ?? {});
  const lines = [keys, ...rows.map((row) => keys.map((key) => cell(row[key], key)))];
  const widths = keys.map((_, i) => Math.max(...lines.map((line) => (line[i] ?? '').length)));
  return lines
    .map((line) => line.map((value, i) => value.padEnd(widths[i] ?? 0)).join('  ').trimEnd())
    .join('\n');
}

/** Formats an ISO timestamp in the process timezone, or in `tz` when supplied. */
export function formatTime(iso: string, tz?: string): string {
  if (!isIsoTimestamp(iso)) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

export function renderMessage(message: Message): string {
  const reactions = message.reactions.map((reaction) => `  ${reactionLabel(reaction)} ${reaction.users.length}`).join('');
  const time = formatTime(message.createdAt);
  const quote = message.quote ? `\n${' '.repeat(time.length + 2)}↪ ${quoteText(message.quote, 80)}` : '';
  return `${time}  ${oneLine(message.senderName ?? message.senderId ?? '-')}: ${forwardLabel(message)}${messageText(message)}${reactions}${quote}`;
}

export function renderMessages(messages: Message[]): string {
  return messages.map(renderMessage).join('\n');
}

export function renderMessageDetail(message: Message): string {
  return [
    `id            ${message.id}`,
    `conversation  ${message.conversationId}`,
    ...(message.parentId === null ? [] : ['reply to  ' + message.parentId]),
    `time          ${formatTime(message.createdAt)}`,
    `sender        ${oneLine(message.senderName ?? message.senderId ?? '-')}`,
    ...(message.quote === null ? [] : [`quote         ${quoteText(message.quote)}`]),
    `text          ${forwardLabel(message)}${messageText(message)}`,
    ...(message.reactions.length === 0 ? [] : [`reactions     ${message.reactions
      .map((reaction) => `${reactionLabel(reaction)} ${reaction.users.map((user) => oneLine(user.name ?? user.id)).join(', ')}`)
      .join(' · ')}`]),
  ].join('\n');
}

/** `Sender: preview`, cut to `max` characters with an ellipsis when given. */
function quoteText({ senderName, senderId, text }: Quote, max = Infinity): string {
  const line = `${oneLine(senderName ?? senderId ?? '-')}: ${oneLine(text)}`;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The emoji, or `:name:` for custom emoji (`name;id`) and keys missing from the catalog. */
function reactionLabel({ key, emoji }: Reaction): string {
  return emoji ?? `:${key.split(';')[0]}:`;
}

/** `[↪ Original sender: time] ` for a forwarded message, else empty. */
function forwardLabel({ forwardedFrom }: Message): string {
  if (!forwardedFrom) return '';
  const who = oneLine(forwardedFrom.senderName ?? forwardedFrom.senderId);
  return `[↪ ${who}${forwardedFrom.sentAt ? `: ${formatTime(forwardedFrom.sentAt)}` : ''}] `;
}

/** One line per event: day, local time range, subject, organizer, your answer and the full id for `calendar show`. */
export function renderCalendarEvents(events: CalendarEvent[]): string {
  if (events.length === 0) return 'No events.';
  return table(events.map((event) => ({
    date: formatTime(event.startAt).slice(0, 10),
    time: eventTime(event),
    subject: `${event.isCancelled ? '[cancelled] ' : ''}${oneLine(event.subject ?? '(no subject)')}`,
    organizer: event.isOrganizer ? 'you' : oneLine(event.organizer?.name ?? event.organizer?.email ?? '-'),
    rsvp: event.myResponse,
    id: event.id,
  })));
}

export function renderCalendarEventDetail(event: CalendarEventDetail): string {
  const organizer = event.organizer ? personLabel(event.organizer.name, event.organizer.email) : '-';
  return [
    `${event.isCancelled ? '[cancelled] ' : ''}${oneLine(event.subject ?? '(no subject)')}`,
    `${formatTime(event.startAt).slice(0, 10)} ${eventTime(event)}${event.isRecurring ? ' (recurring)' : ''}`,
    `organizer     ${organizer}`,
    `your answer   ${event.myResponse}`,
    ...(event.location === null ? [] : [`location      ${oneLine(event.location)}`]),
    ...(event.joinUrl === null ? [] : [`join          ${event.joinUrl}`]),
    ...(event.chatId === null ? [] : [`chat          ${event.chatId}`]),
    `id            ${event.id}`,
    ...(event.attendees.length === 0 ? [] : ['', `Attendees (${event.attendees.length})`, ...event.attendees.map((attendee) =>
      `  ${attendee.type.padEnd(8)}  ${attendee.response.padEnd(9)}  ${personLabel(attendee.name, attendee.email)}`)]),
    ...(event.description === null ? [] : ['', 'Description', ...event.description.split('\n').map((line) => `  ${line}`)]),
  ].join('\n');
}

export function renderOnlineMeeting(meeting: OnlineMeeting): string {
  return [
    ...(meeting.subject === null ? [] : [oneLine(meeting.subject)]),
    `join   ${meeting.shortJoinUrl ?? meeting.joinUrl}`,
    ...(meeting.chatId === null ? [] : [`chat   ${meeting.chatId}`]),
  ].join('\n');
}

/** `09:00–09:15` in the local timezone, or `all day`. */
function eventTime({ startAt, endAt, isAllDay }: CalendarEvent): string {
  return isAllDay ? 'all day' : `${formatTime(startAt).slice(11)}–${formatTime(endAt).slice(11)}`;
}

function personLabel(name: string | null, email: string | null): string {
  if (name && email) return `${oneLine(name)} <${email}>`;
  return oneLine(name ?? email ?? '-');
}

/** Maps any thrown value to what the CLI prints and the exit code. */
export function describeError(error: unknown): { code: ErrorCode; message: string; details: unknown; exitCode: number } {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message, details: error.details, exitCode: EXIT_CODES[error.code] };
  }
  return { code: 'internal', message: 'Unexpected error; rerun with TEAMSCLI_DEBUG=1 for details.', details: null, exitCode: EXIT_CODES.internal };
}

function cell(value: unknown, key?: string): string {
  if (value === null || value === undefined) return '-';
  if (key?.endsWith('At') && typeof value === 'string' && isIsoTimestamp(value)) return formatTime(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/\s+/g, ' ');
}

function messageText(message: Message): string {
  if (message.deletedAt) return '[deleted]';
  return `${oneLine(message.text)}${message.editedAt ? ' (edited)' : ''}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
