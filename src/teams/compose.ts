// Builds the HTML body Teams expects (`messagetype: RichText/Html`) from user text. Nothing the user
// types reaches the output as markup: every segment is escaped, and only the markdown below is rendered.

/**
 * Plain text or simple markdown to Teams HTML. Blank lines separate paragraphs, single newlines
 * become `<br>`. Inline: `**bold**`, `*italic*`, `` `code` ``, `[text](url)` and bare URLs; links
 * only with http or https (anything else stays literal text).
 */
export function toTeamsHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.split('\n').map(inline).join('<br>')}</p>`)
    .join('');
}

export interface PersonMention {
  query: string;
  mri: string;
  displayName: string;
}

export interface MentionReference {
  '@type': 'http://schema.skype.com/Mention';
  itemid: string;
  mri: string;
  mentionType: 'person';
  displayName: string;
}

/** Renders mentions as Teams HTML and returns the references in content order. */
export function toTeamsHtmlWithMentions(text: string, people: PersonMention[]): { content: string; mentions: MentionReference[] } {
  const body = text.replace(/\r\n?/g, '\n');
  const normalized = normalizeWithOffsets(body);
  const ranges: Array<{ start: number; end: number; person: number }> = [];
  people.forEach((person, index) => {
    const candidates = [person.query, person.displayName]
      .flatMap((name) => mentionRanges(normalized, `@${name}`))
      .filter((range) => !ranges.some((used) => range.start < used.end && range.end > used.start))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const range = candidates[0];
    if (range) ranges.push({ ...range, person: index });
  });

  let markerPrefix = '\uE000teamscli-mention-0-';
  for (let nonce = 1; people.some((_, index) => body.includes(`${markerPrefix}${index}\uE001`)); nonce++) {
    markerPrefix = `\uE000teamscli-mention-${nonce}-`;
  }
  const marker = (index: number) => `${markerPrefix}${index}\uE001`;
  const missing = people.map((_, index) => index).filter((index) => !ranges.some((range) => range.person === index));
  const ordered = [...missing, ...ranges.toSorted((a, b) => a.start - b.start).map(({ person }) => person)];
  const itemids = new Map(ordered.map((person, index) => [person, String(index)]));
  let marked = body;
  for (const range of ranges.toSorted((a, b) => b.start - a.start)) {
    marked = `${marked.slice(0, range.start)}${marker(range.person)}${marked.slice(range.end)}`;
  }
  if (missing.length > 0) marked = `${missing.map(marker).join(' ')} ${marked}`;

  const mentions = ordered.map((person): MentionReference => ({
    '@type': 'http://schema.skype.com/Mention',
    itemid: itemids.get(person)!,
    mri: people[person]!.mri,
    mentionType: 'person',
    displayName: people[person]!.displayName,
  }));
  // shortcut: multiple mention itemid sequencing is not live-verified; validate when Teams is available.
  let content = toTeamsHtml(marked);
  for (let index = 0; index < people.length; index++) {
    const person = people[index]!;
    content = content.replaceAll(marker(index), `<readonly class="skipProofing" itemtype="http://schema.skype.com/Mention" spellcheck="false">`
      + `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${itemids.get(index)}">${escapeHtml(person.displayName)}</span></readonly>`);
  }
  return { content, mentions };
}

export interface QuotedMessage {
  id: string;
  senderId: string;
  senderName: string;
  /** Plain text preview of the quoted message. */
  text: string;
}

/** Reply-quote block (docs/authentication.md); goes right before the reply's own HTML. */
export function quoteHtml({ id, senderId, senderName, text }: QuotedMessage): string {
  return `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="${escapeHtml(id)}">`
    + `<strong itemprop="mri" itemid="${escapeHtml(senderId)}">${escapeHtml(senderName)}</strong>`
    + `<span itemprop="time" itemid="${escapeHtml(id)}"></span>`
    + `<p itemprop="preview">${escapeHtml(text)}</p>`
    + '</blockquote>';
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

// Code span | [text](http url) | bare http url. Matched on raw text; each piece is escaped on its own.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`]+)/gi;

function inline(line: string): string {
  let html = '';
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    html += emphasis(escapeHtml(line.slice(last, match.index)));
    const [whole, code, label, url, bare] = match;
    if (code !== undefined) html += `<code>${escapeHtml(code)}</code>`;
    else if (label !== undefined && url !== undefined) {
      html += url.includes('\uE000teamscli-mention-') ? escapeHtml(whole) : link(url, emphasis(escapeHtml(label)));
    }
    else if (bare !== undefined) {
      if (bare.includes('\uE000teamscli-mention-')) {
        html += escapeHtml(bare);
        last = match.index + whole.length;
        continue;
      }
      // Sentence punctuation after a bare URL is not part of it.
      const trimmed = bare.replace(/[.,;:!?)]+$/, '');
      html += link(trimmed, escapeHtml(trimmed)) + escapeHtml(bare.slice(trimmed.length));
    }
    last = match.index + whole.length;
  }
  return html + emphasis(escapeHtml(line.slice(last)));
}

function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${label}</a>`;
}

function mentionRanges(text: { value: string; starts: number[]; ends: number[] }, name: string): Array<{ start: number; end: number }> {
  const wanted = normalizeMention(name);
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (wanted !== '' && offset <= text.value.length - wanted.length) {
    const index = text.value.indexOf(wanted, offset);
    if (index < 0) break;
    ranges.push({ start: text.starts[index]!, end: text.ends[index + wanted.length - 1]! });
    offset = index + 1;
  }
  return ranges;
}

function normalizeWithOffsets(value: string): { value: string; starts: number[]; ends: number[] } {
  let normalized = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length;) {
    const char = String.fromCodePoint(value.codePointAt(index)!);
    const end = index + char.length;
    const folded = normalizeMention(char);
    if (folded === '' && ends.length > 0) ends[ends.length - 1] = end;
    normalized += folded;
    for (let unit = 0; unit < folded.length; unit++) {
      starts.push(index);
      ends.push(end);
    }
    index = end;
  }
  return { value: normalized, starts, ends };
}

function normalizeMention(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// shortcut: emphasis does not span code spans or links, and markers cannot nest; enough for chat text.
function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?!\s)([^*]+?)(?<!\s)\*/g, '<em>$1</em>');
}
