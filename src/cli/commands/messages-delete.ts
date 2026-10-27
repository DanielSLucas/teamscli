import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage, upsertMessages } from '../../store/messages.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { deleteMessage } from '../../teams/send.ts';
import type { Command } from '../command.ts';
import { resolveConversationTarget, teamsSession } from '../session.ts';

const command: Command<Message> = {
  name: 'messages delete',
  summary: 'Soft-delete one of your locally stored messages',
  usage: '<id> --chat ID --yes',
  options: { chat: { type: 'string' }, yes: { type: 'boolean' } },
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals, values }) {
    if (ctx.options.events) throw new CliError('usage', 'messages delete does not support --events.');
    const id = positionals[0];
    const query = option(values, 'chat');
    if (!id || !query) throw new CliError('usage', 'messages delete requires a message ID and --chat ID.');
    if (values.yes !== true) throw new CliError('usage', 'messages delete requires --yes.');

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const conversationId = resolveConversationTarget(ctx, db, query).id;
      const message = getMessage(db, conversationId, id);
      if (!message) throw new CliError('usage', 'Only a locally stored message of your own can be deleted.');
      const session = teamsSession(ctx);
      if (message.senderId !== (await session.account()).userId) {
        throw new CliError('usage', 'Only a message sent by your account can be deleted.');
      }

      const client = createTeamsClient({ fetch: ctx.fetch, session });
      const refreshed = await deleteMessage(client, await session.endpoints(), message);
      const updated = refreshed ?? fallbackDelete(message);
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

function fallbackDelete(message: Message): Message {
  const version = Math.max(Date.now(), message.version + 1);
  return { ...message, content: '', text: '', deletedAt: new Date(version).toISOString(), version };
}

export default command;
