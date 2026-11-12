import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage, upsertMessages } from '../../store/messages.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { reactionEmoji, reactionKey } from '../../teams/messages.ts';
import { setReaction } from '../../teams/send.ts';
import type { Command } from '../command.ts';
import { renderMessageDetail } from '../output.ts';
import { resolveConversationTarget, teamsSession } from '../session.ts';

const command: Command<Message> = {
  name: 'messages react',
  summary: 'Add or remove your reaction on a locally stored chat message',
  usage: '<id> --chat ID [--emoji EMOJI] [--remove]',
  arguments: '<id>  Id of the message to react to',
  options: { chat: { type: 'string' }, emoji: { type: 'string' }, remove: { type: 'boolean' } },
  optionHelp: {
    chat: { valueName: 'ID', description: 'Chat containing the message (id, short id or name).' },
    emoji: { valueName: 'EMOJI', description: 'Emoji or Teams key, e.g. 👍, ❤️, heart, fire (default: like).' },
    remove: { description: 'Remove your reaction instead of adding it.' },
  },
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals, values }) {
    if (ctx.options.events) throw new CliError('usage', 'messages react does not support --events.');
    const id = positionals[0];
    const query = option(values, 'chat');
    const emoji = option(values, 'emoji') ?? 'like';
    if (!id) throw new CliError('usage', 'Missing the message ID: pass it after the command.');
    if (!query) throw new CliError('usage', 'Missing --chat: the chat containing the message (id, short id or name).');
    const key = reactionKey(emoji);
    if (!key) throw new CliError('usage', 'Unknown --emoji: pass an emoji or a Teams reaction key such as heart.');

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const conversation = resolveConversationTarget(ctx, db, query);
      // Reactions were validated in chats only (docs/authentication.md, "Reactions").
      if (conversation.kind === 'channel') throw new CliError('usage', 'messages react is only supported in chats.');
      const message = getMessage(db, conversation.id, id);
      if (!message) throw new CliError('not_found', 'Message not found in the local chat; run sync first.');
      const session = teamsSession(ctx);
      const userId = (await session.account()).userId;
      const add = values.remove !== true;
      const client = createTeamsClient({ fetch: ctx.fetch, session });
      const refreshed = await setReaction(client, await session.endpoints(), message, key, add, ctx.now());
      upsertMessages(db, [refreshed ?? withReaction(message, key, userId, add, ctx.now())]);
      return getMessage(db, conversation.id, id) ?? message;
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

/** Local update when the message is not on the first remote page; the next sync brings Teams' version. */
function withReaction(message: Message, key: string, userId: string | null, add: boolean, now: Date): Message {
  if (!userId) return message;
  const user = { id: userId, name: null, reactedAt: now.toISOString() };
  const reactions = message.reactions.map((reaction) =>
    reaction.key === key ? { ...reaction, users: [...reaction.users.filter((other) => other.id !== userId), ...(add ? [user] : [])] } : reaction);
  if (add && !reactions.some((reaction) => reaction.key === key)) reactions.push({ key, emoji: reactionEmoji(key), users: [user] });
  return { ...message, reactions: reactions.filter((reaction) => reaction.users.length > 0) };
}

export default command;
