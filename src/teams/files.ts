import { CliError } from '../errors.ts';
import type { MessageFile } from '../models.ts';
import type { TeamsClient } from './client.ts';

// Message content comes from other people: credentials only go to these hosts, never to a URL taken from it as is.
const MEDIA_HOSTS = /^[a-z\d-]+\.(?:asm\.skype\.com|asyncgw\.teams\.microsoft\.com)$/;
const SHAREPOINT_HOSTS = /^[a-z\d-]+\.sharepoint\.com$/;

export interface Download {
  /** File name for an attached file; null for an inline image. */
  name: string | null;
  /** MIME type Teams or SharePoint returned, e.g. `image/jpeg`. */
  contentType: string | null;
  data: Uint8Array;
}

/** URLs of the inline images (AMS objects) in a message's HTML content. */
export function imageUrls(content: string): string[] {
  return [...content.matchAll(/<img\b[^>]*\bitemtype="http:\/\/schema\.skype\.com\/AMSImage"[^>]*>/gi)]
    .map((tag) => tag[0].match(/\bsrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, '&'))
    .filter((url): url is string => url !== undefined);
}

/** Downloads an inline image, in the original size Teams stored. */
export async function downloadImage(client: TeamsClient, url: string): Promise<Download> {
  trusted(url, MEDIA_HOSTS);
  const { contentType, data } = await client.bytes('media', url);
  return { name: null, contentType, data };
}

/** Downloads an attached file through the SharePoint shares API of the site that stores it. */
export async function downloadFile(client: TeamsClient, file: MessageFile): Promise<Download> {
  const origin = trusted(file.url, SHAREPOINT_HOSTS).origin;
  const share = `u!${Buffer.from(file.url).toString('base64url')}`;
  const item = await client.json<{ '@content.downloadUrl'?: unknown } | null>('sharepoint', `${origin}/_api/v2.0/shares/${share}/driveItem`);
  const downloadUrl = item?.['@content.downloadUrl'];
  if (typeof downloadUrl !== 'string' || trusted(downloadUrl, SHAREPOINT_HOSTS).origin !== origin) {
    throw new CliError('remote', 'SharePoint returned no download link for the file.');
  }
  const { contentType, data } = await client.bytes('sharepoint', downloadUrl);
  return { name: file.name, contentType, data };
}

function trusted(value: string, hosts: RegExp): URL {
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    // Reported below with the same error as an unexpected host.
  }
  if (url?.protocol !== 'https:' || !hosts.test(url.hostname)) throw new CliError('remote', 'The attachment is on an unexpected host; refusing to download it.');
  return url;
}
