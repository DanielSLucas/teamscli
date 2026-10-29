import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage, upsertMessages } from '../../store/messages.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { toTeamsHtml } from '../../teams/compose.ts';
import { messageText } from '../../teams/messages.ts';
import { editText } from '../../teams/send.ts';
import type { Command } from '../command.ts';
import { renderMessageDetail } from '../output.ts';
import { resolveConversationTarget, teamsSession } from '../session.ts';

const command: Command<Message> = {
  name: 'messages edit',
  summary: 'Edit one of your locally stored messages',
  usage: '<id> --chat ID [TEXT | --message TEXT]',
  arguments: '<id> [TEXT]  Message id and optional replacement text',
  options: { chat: { type: 'string' }, message: { type: 'string' } },
  optionHelp: {
    chat: { valueName: 'ID', description: 'Chat containing the message (id, short id or name).' },
    message: { valueName: 'TEXT', description: 'Replacement message text.' },
  },
  maxPositionals: 2,
  mutates: true,
  async run(ctx, { positionals, values }) {
    if (ctx.options.events) throw new CliError('usage', 'messages edit does not support --events.');
    const id = positionals[0];
    const query = option(values, 'chat');
    if (!id) throw new CliError('usage', 'Missing the message ID: pass it after the command.');
    if (!query) throw new CliError('usage', 'Missing --chat: the chat containing the message (id, short id or name).');
    const positionalText = positionals[1];
    const optionText = option(values, 'message');
    if (positionalText !== undefined && optionText !== undefined) {
      throw new CliError('usage', 'Pass the message text either after the options or with --message, not both.');
    }
    const text = optionText ?? positionalText;
    if (!text?.trim()) throw new CliError('usage', 'Missing the message text: pass it after the options or with --message.');

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const conversationId = resolveConversationTarget(ctx, db, query).id;
      const message = getMessage(db, conversationId, id);
      if (!message) throw new CliError('usage', 'Only a locally stored message of your own can be edited.');
      const session = teamsSession(ctx);
      if (message.senderId !== (await session.account()).userId) {
        throw new CliError('usage', 'Only a message sent by your account can be edited.');
      }

      const client = createTeamsClient({ fetch: ctx.fetch, session });
      const refreshed = await editText(client, await session.endpoints(), message, text);
      const updated = refreshed ?? fallbackEdit(message, text, ctx.now());
      upsertMessages(db, [updated]);
      return getMessage(db, conversationId, id) ?? updated;
    } finally {
      db.close();
    }
  },
  render: (message) => renderMessageDetail(message),
};

function option(values: Record<string, string | boolean | string[] | boolean[] | undefined>, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

function fallbackEdit(message: Message, text: string, now: Date): Message {
  const content = toTeamsHtml(text);
  const version = Math.max(now.getTime(), message.version + 1);
  return { ...message, content, text: messageText(content, message.files), editedAt: new Date(version).toISOString(), version };
}

export default command;
