import { CliError } from '../../errors.ts';
import type { CalendarEventDetail } from '../../models.ts';
import { getEvent, respondToEvent, type RsvpAnswer } from '../../teams/calendar.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { renderCalendarEventDetail } from '../output.ts';
import { teamsSession } from '../session.ts';

const ANSWERS: readonly RsvpAnswer[] = ['accept', 'tentative', 'decline'];

const command: Command<CalendarEventDetail> = {
  name: 'calendar rsvp',
  summary: 'Accept, tentatively accept or decline a calendar invitation',
  usage: '<id> accept|tentative|decline [--message TEXT] [--no-notify]',
  arguments: '<id>  Event id from "calendar list"; then your answer: accept, tentative or decline',
  options: { message: { type: 'string' }, 'no-notify': { type: 'boolean' } },
  optionHelp: {
    message: { valueName: 'TEXT', description: 'Note sent to the organizer with your answer.' },
    'no-notify': { description: 'Change your answer without emailing the organizer.' },
  },
  maxPositionals: 2,
  mutates: true,
  async run(ctx, { positionals, values }) {
    const [id, answer] = positionals;
    if (!id) throw new CliError('usage', 'Missing the event ID: pass the id from "teamscli calendar list".');
    if (!ANSWERS.includes(answer as RsvpAnswer)) throw new CliError('usage', 'Missing or unknown answer: pass accept, tentative or decline after the id.');
    const notify = values['no-notify'] !== true;
    const message = typeof values.message === 'string' ? values.message : null;
    if (message !== null && !notify) throw new CliError('usage', '--message is sent to the organizer; it cannot be combined with --no-notify.');

    const client = createTeamsClient({ fetch: ctx.fetch, session: teamsSession(ctx) });
    await respondToEvent(client, id, answer as RsvpAnswer, { notify, message });
    return getEvent(client, id);
  },
  render: renderCalendarEventDetail,
};

export default command;
