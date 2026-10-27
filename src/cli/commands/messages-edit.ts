import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage, upsertMessages } from '../../store/messages.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { toTeamsHtml } from '../../teams/compose.ts';
import { htmlToText } from '../../teams/html.ts';
import { editText } from '../../teams/send.ts';
import type { Command } from '../command.ts';
import { teamsSession } from '../session.ts';

const command: Command<Message> = {
  name: 'messages edit',
  summary: 'Edit one of your locally stored messages',
  usage: '<id> --chat ID --message TEXT',
  options: { chat: { type: 'string' }, message: { type: 'string' } },
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals, values }) {
    if (ctx.options.events) throw new CliError('usage', 'messages edit does not support --events.');
    const id = positionals[0];
    const conversationId = option(values, 'chat');
    const text = option(values, 'message');
    if (!id || !conversationId || !text?.trim()) {
      throw new CliError('usage', 'messages edit requires a message ID, --chat ID and non-empty --message TEXT.');
    }

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const message = getMessage(db, conversationId, id);
      if (!message) throw new CliError('usage', 'Only a locally stored message of your own can be edited.');
      const session = teamsSession(ctx);
      if (message.senderId !== (await session.account()).userId) {
        throw new CliError('usage', 'Only a message sent by your account can be edited.');
      }

      const client = createTeamsClient({ fetch: ctx.fetch, session });
      const refreshed = await editText(client, await session.endpoints(), message, text);
      const updated = refreshed ?? fallbackEdit(message, text);
      upsertMessages(db, [updated]);
      return getMessage(db, conversationId, id) ?? updated;
    } finally {
      db.close();
    }
  },
};

function option(values: Record<string, string | boolean | string[] | boolean[] | undefined>, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

function fallbackEdit(message: Message, text: string): Message {
  const content = toTeamsHtml(text);
  const version = Math.max(Date.now(), message.version + 1);
  return { ...message, content, text: htmlToText(content), editedAt: new Date(version).toISOString(), version };
}

export default command;
