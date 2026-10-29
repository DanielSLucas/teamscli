import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { CliError } from '../../errors.ts';
import type { Message } from '../../models.ts';
import { readIdentity } from '../../auth/identity.ts';
import { databasePath } from '../../runtime/paths.ts';
import { resolveConversation } from '../../store/resolve.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage, upsertMessages } from '../../store/messages.ts';
import { listMembers } from '../../store/people.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { uploadFile, uploadImage } from '../../teams/files.ts';
import { sendAttachment } from '../../teams/send.ts';
import type { Command } from '../command.ts';
import { renderHuman, renderMessageDetail } from '../output.ts';
import { teamsSession } from '../session.ts';

type SendResult = Message | { sent: true; clientMessageId: string };

// Sent inline, like an image pasted in Teams; anything else is attached from OneDrive.
const IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

const command: Command<SendResult> = {
  name: 'send file',
  summary: 'Send a file or image to a chat',
  usage: '(--to TARGET | --chat ID) --file PATH [--message TEXT]',
  options: {
    to: { type: 'string' },
    chat: { type: 'string' },
    file: { type: 'string' },
    message: { type: 'string' },
  },
  optionHelp: {
    to: { valueName: 'TARGET', description: 'Chat or person to send to by id or name.' },
    chat: { valueName: 'ID', description: 'Chat to send to (id, short id or name).' },
    file: { valueName: 'PATH', description: 'File to send. Images (png, jpg, gif, webp) show inline; other files are uploaded to your OneDrive and shared with the chat members.' },
    message: { valueName: 'TEXT', description: 'Optional markdown text sent with the file.' },
  },
  mutates: true,
  async run(ctx, { values }) {
    const to = typeof values.to === 'string' ? values.to : undefined;
    const chat = typeof values.chat === 'string' ? values.chat : undefined;
    const path = typeof values.file === 'string' ? values.file : undefined;
    const text = typeof values.message === 'string' ? values.message : undefined;
    if ((to === undefined) === (chat === undefined)) throw new CliError('usage', 'Choose one destination: pass exactly one of --to or --chat.');
    if (!path) throw new CliError('usage', 'Missing --file: the file to send.');
    let data: Uint8Array<ArrayBuffer>;
    try {
      if (!statSync(path).isFile()) throw new CliError('usage', '--file must be a regular file.');
      data = new Uint8Array(readFileSync(path));
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError('usage', `Could not read --file: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}.`);
    }
    const name = basename(path);
    const format = extname(name).slice(1).toLowerCase();

    const db = openDatabase(databasePath(ctx.home, ctx.account));
    try {
      const session = teamsSession(ctx);
      const identity = readIdentity(ctx.home, ctx.account);
      const selfId = identity?.userId ?? (await session.account()).userId;
      const conversation = resolveConversation(db, to ?? chat!, selfId);
      // shortcut: channel files live in the team's SharePoint, not in OneDrive; chats only until that is validated.
      if (conversation.kind === 'channel') throw new CliError('usage', 'send file supports chats, group chats and meetings only.');

      const client = createTeamsClient({ fetch: ctx.fetch, session });
      const endpoints = await session.endpoints();
      const displayName = identity?.displayName || (await session.account()).displayName;
      let attachment: Parameters<typeof sendAttachment>[2];
      if (IMAGE_FORMATS.has(format)) {
        const image = await uploadImage(client, conversation.id, name, data);
        attachment = { conversationId: conversation.id, image: { ...image, format }, displayName };
      } else {
        const others = listMembers(db, conversation.id).map((member) => member.personId).filter((id) => id !== selfId);
        const readers = others.flatMap((id) => id.match(/^8:orgid:([\da-f-]{36})$/i)?.[1] ?? []);
        if (readers.length < others.length) ctx.log(`${others.length - readers.length} chat member(s) outside your organization will not get access to the file.`);
        attachment = { conversationId: conversation.id, file: await uploadFile(client, endpoints, name, data, readers), displayName };
      }
      const result = await sendAttachment(client, endpoints, { ...attachment, ...(text?.trim() ? { text } : {}) });
      if (!result.message) {
        ctx.log('Teams accepted the message, but it was not found in the first page; the local store was not updated.');
        return { sent: true, clientMessageId: result.clientMessageId };
      }
      upsertMessages(db, [result.message]);
      return getMessage(db, conversation.id, result.message.id) ?? result.message;
    } finally {
      db.close();
    }
  },
  render: (result) => 'sent' in result ? renderHuman(result) : renderMessageDetail(result),
};

export default command;
