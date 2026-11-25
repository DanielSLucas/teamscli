import { CliError } from '../../errors.ts';
import type { CalendarEventDetail } from '../../models.ts';
import { createEvent } from '../../teams/calendar.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { renderCalendarEventDetail } from '../output.ts';
import { teamsSession } from '../session.ts';

const DEFAULT_MINUTES = 30;

const command: Command<CalendarEventDetail> = {
  name: 'calendar create',
  summary: 'Create a calendar event with a Teams meeting and send the invitations',
  usage: '--subject TEXT --start TIME [--end TIME | --duration MIN] [--attendee EMAIL]... [--optional EMAIL]... [--description TEXT] [--no-teams]',
  options: {
    subject: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    duration: { type: 'string' },
    attendee: { type: 'string', multiple: true },
    optional: { type: 'string', multiple: true },
    description: { type: 'string' },
    'no-teams': { type: 'boolean' },
  },
  optionHelp: {
    subject: { valueName: 'TEXT', description: 'Event title.' },
    start: { valueName: 'TIME', description: 'Local time like 2026-11-26T10:00, or ISO 8601 with an offset.' },
    end: { valueName: 'TIME', description: 'End time, same formats as --start.' },
    duration: { valueName: 'MIN', description: `Length in minutes when --end is not given (default: ${DEFAULT_MINUTES}).` },
    attendee: { valueName: 'EMAIL', description: 'Required attendee; repeat for more. Invitations are sent.' },
    optional: { valueName: 'EMAIL', description: 'Optional attendee; repeat for more.' },
    description: { valueName: 'TEXT', description: 'Invitation text.' },
    'no-teams': { description: 'Create the event without a Teams meeting.' },
  },
  mutates: true,
  async run(ctx, { values }) {
    const subject = typeof values.subject === 'string' ? values.subject.trim() : '';
    if (!subject) throw new CliError('usage', 'Missing --subject: the event title.');
    const start = time(values.start, '--start');
    if (start === null) throw new CliError('usage', 'Missing --start: a local time like 2026-11-26T10:00.');
    if (values.end !== undefined && values.duration !== undefined) throw new CliError('usage', 'Pass --end or --duration, not both.');
    const end = time(values.end, '--end') ?? new Date(start.getTime() + minutes(values.duration) * 60_000);
    if (end <= start) throw new CliError('usage', '--end must be after --start.');

    const session = teamsSession(ctx);
    const mailbox = await session.userPrincipalName();
    if (!mailbox) throw new CliError('auth_required', 'The login does not say which mailbox is yours; run "teamscli auth" again.');
    return createEvent(createTeamsClient({ fetch: ctx.fetch, session }), mailbox, {
      subject,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      attendees: emails(values.attendee, '--attendee'),
      optionalAttendees: emails(values.optional, '--optional'),
      description: typeof values.description === 'string' && values.description.trim() ? values.description : null,
      online: values['no-teams'] !== true,
    });
  },
  render: renderCalendarEventDetail,
};

/**
 * `2026-11-26T10:00` (local time) or ISO 8601 with `Z` or an offset. A bare date is refused:
 * JavaScript would read it as UTC midnight.
 */
function time(value: unknown, name: string): Date | null {
  if (value === undefined) return null;
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value) : null;
  const date = match && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3])) ? new Date(match[0]) : null;
  if (!date || Number.isNaN(date.getTime())) throw new CliError('usage', `${name} must be a time like 2026-11-26T10:00.`);
  return date;
}

/** Date rolls 2026-02-30 over into March; this refuses days the month does not have. */
function isCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function minutes(value: unknown): number {
  if (value === undefined) return DEFAULT_MINUTES;
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0;
  if (parsed <= 0) throw new CliError('usage', '--duration must be a whole number of minutes.');
  return parsed;
}

function emails(value: unknown, name: string): string[] {
  const list = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()) : [];
  const invalid = list.find((email) => !/^[^\s@]+@[^\s@]+$/.test(email));
  if (invalid !== undefined) throw new CliError('usage', `${name} must be an email address.`);
  return list;
}

export default command;
