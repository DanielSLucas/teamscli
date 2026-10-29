import { CliError } from '../errors.ts';
import type { MessageFile } from '../models.ts';
import type { Endpoints, TeamsClient } from './client.ts';

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

// shortcut: uploads go to the amer media host, the only one validated; find the host per region when another region is tested.
const MEDIA_UPLOAD = 'https://us-api.asm.skype.com';

/** An inline image stored in Teams media, readable by the members of one conversation. */
export interface UploadedImage {
  id: string;
  url: string;
}

/** Uploads an inline image for `conversationId`; send it with `sendAttachment`. */
export async function uploadImage(client: TeamsClient, conversationId: string, name: string, data: Uint8Array<ArrayBuffer>): Promise<UploadedImage> {
  const created = await client.json<{ id?: unknown } | null>('media', `${MEDIA_UPLOAD}/v1/objects`, {
    method: 'POST',
    body: { type: 'pish/image', permissions: { [conversationId]: ['read'] }, filename: name },
  });
  const id = created?.id;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new CliError('remote', 'Teams did not create the image.');
  await client.json('media', `${MEDIA_UPLOAD}/v1/objects/${id}/content/imgpsh`, { method: 'PUT', data });
  return { id, url: `${MEDIA_UPLOAD}/v1/objects/${id}/views/imgo` };
}

/**
 * Uploads a file to the user's OneDrive, in the folder Teams uses for chat files, and lets `readers`
 * (Azure AD object ids) read it without an email. Returns the entry Teams expects in `properties.files`.
 */
export async function uploadFile(client: TeamsClient, endpoints: Endpoints, name: string, data: Uint8Array<ArrayBuffer>, readers: string[]): Promise<Record<string, unknown>> {
  const drive = `${await oneDriveOrigin(client, endpoints)}/_api/v2.0/me/drive`;
  const folder = await chatFilesFolder(client, drive);
  const uploaded = await client.json<{ id?: unknown } | null>(
    'sharepoint',
    `${drive}/root:/${encodeURIComponent(folder)}/${encodeURIComponent(name)}:/content?@name.conflictBehavior=rename`,
    { method: 'PUT', data },
  );
  if (typeof uploaded?.id !== 'string') throw new CliError('remote', 'OneDrive did not store the file.');
  const item = `${drive}/items/${encodeURIComponent(uploaded.id)}`;
  if (readers.length > 0) {
    await client.json('sharepoint', `${item}/invite`, {
      method: 'POST',
      body: { recipients: readers.map((objectId) => ({ objectId })), roles: ['read'], requireSignIn: true, sendInvitation: false },
    });
  }
  const file = await client.json<DriveItem>('sharepoint', `${item}?$select=id,name,webUrl,sharepointIds`);
  const uniqueId = file.sharepointIds?.listItemUniqueId;
  const siteUrl = `${file.sharepointIds?.siteUrl}/`;
  if (!file.name || !file.webUrl || !uniqueId) throw new CliError('remote', 'OneDrive returned an unexpected file description.');
  const type = file.name.includes('.') ? file.name.split('.').at(-1)!.toLowerCase() : '';
  // Shape copied from files Teams web sends (docs/teams-payloads.md); readers get access through the invite, not a share link.
  return {
    '@type': 'http://schema.skype.com/File',
    version: 2,
    id: uniqueId,
    baseUrl: siteUrl,
    type,
    title: file.name,
    state: 'active',
    objectUrl: file.webUrl,
    providerData: '',
    itemid: uniqueId,
    fileName: file.name,
    fileType: type,
    fileInfo: { itemId: file.id, fileUrl: file.webUrl, siteUrl, serverRelativeUrl: '', shareUrl: '', shareId: '' },
    botFileProperties: {},
    permissionScope: '',
    filePreview: {},
    fileChicletState: { serviceName: 'p2p', state: 'active' },
  };
}

interface DriveItem {
  id?: string;
  name?: string;
  webUrl?: string;
  sharepointIds?: { listItemUniqueId?: string; siteUrl?: string };
}

/** The user's OneDrive, next to the SharePoint of their teams: `contoso.sharepoint.com` -> `contoso-my.sharepoint.com`. */
async function oneDriveOrigin(client: TeamsClient, endpoints: Endpoints): Promise<string> {
  const response = await client.json<{ teams?: Array<{ teamSiteInformation?: { sharepointSiteUrl?: unknown } }> | null } | null>(
    'csa',
    `${endpoints.csa}/api/v1/teams/users/me?isPrefetch=false&enableMembershipSummary=true`,
  );
  for (const team of response?.teams ?? []) {
    const site = team.teamSiteInformation?.sharepointSiteUrl;
    const host = typeof site === 'string' ? URL.parse(site)?.hostname.match(/^([a-z\d-]+)\.sharepoint\.com$/)?.[1] : undefined;
    if (host) return `https://${host}-my.sharepoint.com`;
  }
  // shortcut: found only through a team the user belongs to; ask for the OneDrive URL if users without teams need this.
  throw new CliError('remote', 'Could not find your OneDrive: sending files needs membership in at least one team.');
}

/** The localized folder Teams creates for chat files ("Microsoft Teams Chat Files"); created with the English name if missing. */
async function chatFilesFolder(client: TeamsClient, drive: string): Promise<string> {
  const children = await client.json<{ value?: Array<{ name?: string; folder?: unknown }> } | null>('sharepoint', `${drive}/root/children?$select=name,folder&$top=999`);
  // shortcut: matched by name in any language; switch to a drive facet if Teams ever exposes one for this folder.
  const folder = children?.value?.find((item) => item.folder && item.name && /microsoft teams/i.test(item.name) && /chat/i.test(item.name));
  return folder?.name ?? 'Microsoft Teams Chat Files';
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
