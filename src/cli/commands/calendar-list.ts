import { CliError } from '../../errors.ts';
import type { CalendarEvent } from '../../models.ts';
import { listEvents } from '../../teams/calendar.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { renderCalendarEvents } from '../output.ts';
import { teamsSession } from '../session.ts';

const command: Command<CalendarEvent[]> = {
  name: 'calendar list',
  summary: 'List your calendar events (this week by default)',
  usage: '[--from YYYY-MM-DD] [--to YYYY-MM-DD]',
  options: { from: { type: 'string' }, to: { type: 'string' } },
  optionHelp: {
    from: { valueName: 'YYYY-MM-DD', description: 'First day, local time (default: Monday of this week).' },
    to: { valueName: 'YYYY-MM-DD', description: 'Last day, inclusive (default: six days after --from).' },
  },
  mutates: false,
  async run(ctx, { values }) {
    const from = localDay(values.from, '--from') ?? startOfWeek(ctx.now());
    const to = localDay(values.to, '--to') ?? addDays(from, 6);
    if (to < from) throw new CliError('usage', '--to must not be before --from.');
    const client = createTeamsClient({ fetch: ctx.fetch, session: teamsSession(ctx) });
    return listEvents(client, from.toISOString(), addDays(to, 1).toISOString());
  },
  render: renderCalendarEvents,
};

/** Local midnight of a `YYYY-MM-DD` option; undefined when the option is absent. */
function localDay(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined;
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const day = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  // Date rolls 2026-13-01 or 2026-02-30 over into another day; refuse those instead.
  if (!match || !day || day.getMonth() !== Number(match[2]) - 1 || day.getDate() !== Number(match[3])) throw new CliError('usage', `${name} must be a date like 2026-11-23.`);
  return day;
}

/** Local midnight of the Monday of `now`'s week. */
function startOfWeek(now: Date): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** Calendar days in local time, so a daylight saving change does not shift midnight. */
function addDays(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

export default command;
