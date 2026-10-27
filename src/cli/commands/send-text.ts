import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { readIdentity } from '../../auth/identity.ts';
import { databasePath } from '../../runtime/paths.ts';
import { resolveConversation } from '../../store/resolve.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage, upsertMessages } from '../../store/messages.ts';
import { getPersonName } from '../../store/people.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { sendText } from '../../teams/send.ts';
import type { Command } from '../command.ts';
import { teamsSession } from '../session.ts';

type SendResult = Message | { sent: true; clientMessageId: string };

const command: Command<SendResult> = {
  name: 'send text',
  summary: 'Send a text message to a chat or reply in a channel thread',
  usage: '(--to TARGET | --chat ID | --channel ID) --message TEXT [--reply-to ID] [--quote ID]',
  options: {
    to: { type: 'string' },
    chat: { type: 'string' },
    channel: { type: 'string' },
    message: { type: 'string' },
    'reply-to': { type: 'string' },
    quote: { type: 'string' },
  },
  mutates: true,
  async run(ctx, { values }) {
    if (ctx.options.events) throw new CliError('usage', 'send text does not support --events.');
    const to = option(values, 'to');
    const chat = option(values, 'chat');
    const channel = option(values, 'channel');
    const messageText = option(values, 'message');
    const replyTo = option(values, 'reply-to');
    const quoteId = option(values, 'quote');
    if ([to, chat, channel].filter((value) => value !== undefined).length !== 1 || !messageText?.trim()) {
      throw new CliError('usage', 'send text requires exactly one of --to, --chat or --channel, and a non-empty --message.');
    }
    if (replyTo === '' || quoteId === '') throw new CliError('usage', '--reply-to and --quote must not be empty.');

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const session = teamsSession(ctx);
      const identity = readIdentity(ctx.home, ctx.account);
      const query = to ?? chat ?? channel ?? '';
      let selfId = identity?.userId ?? null;
      if (to !== undefined && selfId === null) selfId = (await session.account()).userId;
      const conversation = resolveConversation(db, query, selfId);
      if (channel !== undefined && conversation.kind !== 'channel') throw new CliError('usage', '--channel must name a channel in the local data.');
      if (chat !== undefined && conversation.kind === 'channel') throw new CliError('usage', '--chat must name a chat in the local data.');

      if (conversation.kind === 'channel' && replyTo === undefined) {
        throw new CliError('usage', 'Posting a new channel message depends on D1 discovery; use --reply-to for a thread reply.');
      }
      if (conversation.kind !== 'channel' && replyTo !== undefined) {
        throw new CliError('usage', '--reply-to is only supported for channel messages.');
      }
      if (conversation.kind === 'channel' && quoteId !== undefined) {
        throw new CliError('usage', '--quote is only supported in chats.');
      }

      const reply = replyTo === undefined ? null : getMessage(db, conversation.id, replyTo);
      if (replyTo !== undefined && !reply) throw new CliError('not_found', 'Reply target not found in the local channel.');
      const quoted = quoteId === undefined ? null : getMessage(db, conversation.id, quoteId);
      if (quoteId !== undefined && !quoted) throw new CliError('not_found', 'Quoted message not found in the local chat.');
      if (quoted && (!quoted.senderId || !quoted.senderName)) {
        throw new CliError('usage', 'The quoted message has no sender details in local data.');
      }

      if (quoted) ctx.log('The quoted message is not verified by Teams.');
      const client = createTeamsClient({ fetch: ctx.fetch, session });
      const result = await sendText(client, await session.endpoints(), {
        conversationId: conversation.id,
        ...(reply ? { replyTo: reply.parentId ?? reply.id } : {}),
        text: messageText,
        ...(quoted ? { quote: { id: quoted.id, senderId: quoted.senderId!, senderName: quoted.senderName!, text: quoted.text } } : {}),
      });
      if (!result.message) {
        ctx.log('Teams accepted the message, but it was not found in the first page; the local store was not updated.');
        return { sent: true, clientMessageId: result.clientMessageId };
      }
      let message = result.message;
      if (message.senderName === null) {
        let senderName = identity?.displayName || null;
        if (senderName === null) {
          const account = await session.account();
          senderName = getPersonName(db, account.userId) ?? account.displayName;
        }
        if (senderName !== null) message = { ...message, senderName };
      }
      upsertMessages(db, [message]);
      return getMessage(db, conversation.id, message.id) ?? message;
    } finally {
      db.close();
    }
  },
};

function option(values: Record<string, string | boolean | string[] | boolean[] | undefined>, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

export default command;
