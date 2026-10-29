import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CliError } from '../../errors.ts';
import { accountDir, databasePath } from '../../runtime/paths.ts';
import { openDatabase } from '../../store/database.ts';
import { getMessage } from '../../store/messages.ts';
import { createTeamsClient } from '../../teams/client.ts';
import { downloadFile, downloadImage, imageUrls, type Download } from '../../teams/files.ts';
import type { Command } from '../command.ts';
import { resolveConversationTarget, teamsSession } from '../session.ts';

interface SavedFile {
  path: string;
  bytes: number;
  contentType: string | null;
}

const command: Command<SavedFile[]> = {
  name: 'files download',
  summary: 'Download the images and files of a message',
  usage: '<id> --chat ID [--out DIR]',
  arguments: '<id>  Id of the message',
  options: { chat: { type: 'string' }, out: { type: 'string' } },
  optionHelp: {
    chat: { valueName: 'ID', description: 'Chat containing the message (id, short id or name).' },
    out: { valueName: 'DIR', description: 'Directory to save into; defaults to media/<message id> in the account directory.' },
  },
  maxPositionals: 1,
  mutates: true,
  async run(ctx, { positionals, values }) {
    const id = positionals[0];
    const query = values.chat;
    if (!id) throw new CliError('usage', 'Missing the message ID: pass it after the command.');
    if (typeof query !== 'string' || !query) throw new CliError('usage', 'Missing --chat: the chat containing the message (id, short id or name).');
    if (values.out !== undefined && (typeof values.out !== 'string' || !values.out)) throw new CliError('usage', '--out must be a directory.');

    const db = openDatabase(databasePath(ctx.home, ctx.account), { readOnly: true });
    let message;
    try {
      message = getMessage(db, resolveConversationTarget(ctx, db, query).id, id);
    } finally {
      db.close();
    }
    if (!message) throw new CliError('not_found', 'Message not found in the specified chat.');
    const images = message.deletedAt ? [] : imageUrls(message.content);
    if (images.length === 0 && message.files.length === 0) {
      throw new CliError('not_found', 'The message has no images or files; if it shows a placeholder, run "teamscli history fetch" for the chat first.');
    }

    const dir = typeof values.out === 'string' ? resolve(values.out) : join(accountDir(ctx.home, ctx.account), 'media', safeName(message.id));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const client = createTeamsClient({ fetch: ctx.fetch, session: teamsSession(ctx) });
    const saved: SavedFile[] = [];
    for (const [index, url] of images.entries()) saved.push(save(dir, `image-${index + 1}`, await downloadImage(client, url)));
    for (const file of message.files) saved.push(save(dir, null, await downloadFile(client, file)));
    return saved;
  },
};

function save(dir: string, imageName: string | null, download: Download): SavedFile {
  const name = imageName ? `${imageName}.${extension(download.contentType)}` : safeName(download.name ?? '');
  const path = join(dir, name);
  try {
    writeFileSync(path, download.data, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CliError('usage', `${path} already exists; remove it or choose another --out.`);
    throw error;
  }
  return { path, bytes: download.data.byteLength, contentType: download.contentType };
}

/** A name from Teams as one plain file name inside the target directory. */
function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '');
  return base === '' || base === '.' || base === '..' ? 'file' : base;
}

function extension(contentType: string | null): string {
  const subtype = contentType?.match(/^image\/([a-z\d.+-]+)/i)?.[1]?.toLowerCase();
  return subtype === 'jpeg' ? 'jpg' : subtype ?? 'bin';
}

export default command;
