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
    else if (label !== undefined && url !== undefined) html += link(url, emphasis(escapeHtml(label)));
    else if (bare !== undefined) {
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

// shortcut: emphasis does not span code spans or links, and markers cannot nest; enough for chat text.
function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?!\s)([^*]+?)(?<!\s)\*/g, '<em>$1</em>');
}
