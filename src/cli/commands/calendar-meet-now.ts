import { CliError } from '../../errors.ts';
import type { OnlineMeeting } from '../../models.ts';
import { createMeetNow } from '../../teams/calendar.ts';
import { createTeamsClient } from '../../teams/client.ts';
import type { Command } from '../command.ts';
import { renderOnlineMeeting } from '../output.ts';
import { teamsSession } from '../session.ts';

const command: Command<OnlineMeeting> = {
  name: 'calendar meet-now',
  summary: 'Create a Teams meeting link to use right away, without a calendar event',
  usage: '[--subject TEXT]',
  options: { subject: { type: 'string' } },
  optionHelp: { subject: { valueName: 'TEXT', description: 'Meeting name shown to people who join.' } },
  mutates: true,
  async run(ctx, { values }) {
    const subject = typeof values.subject === 'string' && values.subject.trim() ? values.subject.trim() : null;
    const session = teamsSession(ctx);
    const mailbox = await session.userPrincipalName();
    if (!mailbox) throw new CliError('auth_required', 'The login does not say which mailbox is yours; run "teamscli auth" again.');
    return createMeetNow(createTeamsClient({ fetch: ctx.fetch, session }), mailbox, subject);
  },
  render: renderOnlineMeeting,
};

export default command;
