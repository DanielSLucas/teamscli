import { CliError } from '../../errors.ts';
import type { CalendarEventDetail } from '../../models.ts';
import { getEvent } from '../../teams/calendar.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { renderCalendarEventDetail } from '../output.ts';
import { teamsSession } from '../session.ts';

const command: Command<CalendarEventDetail> = {
  name: 'calendar show',
  summary: 'Show a calendar event: attendees, description, join link and meeting chat',
  usage: '<id>',
  arguments: '<id>  Event id from "calendar list"',
  maxPositionals: 1,
  mutates: false,
  async run(ctx, { positionals }) {
    const id = positionals[0];
    if (!id) throw new CliError('usage', 'Missing the event ID: pass the id from "teamscli calendar list".');
    const client = createTeamsClient({ fetch: ctx.fetch, session: teamsSession(ctx) });
    return getEvent(client, id);
  },
  render: renderCalendarEventDetail,
};

export default command;
