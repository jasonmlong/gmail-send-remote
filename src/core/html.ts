/**
 * HTML helpers that reproduce Gmail's compose-box serialization and Gmail's
 * HTML-to-plain-text conversion (used for the text/plain part, signatures and
 * quoted originals that only exist as HTML).
 */
import { normalizeNewlines } from './wrap.js';

/**
 * Gmail escapes &, <, > and turns apostrophes into &#39;. Double quotes stay,
 * which matches Gmail's own output, so do not add them here. Use escapeAttr
 * for anything going inside a double-quoted attribute.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

/**
 * Escaping for a value placed inside a double-quoted HTML attribute. Adds the
 * double quote on top of escapeHtml, so an attacker-chosen address in a
 * forwarded header cannot close the attribute and add one of its own.
 */
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Make an untrusted HTML fragment safe to embed inside a wrapper element.
 *
 * Gmail does not need this because its compose box round-trips through a DOM,
 * which rebalances tags on the way out. We concatenate strings, so a crafted
 * `</blockquote></div>` in an inbound message would close the quote block
 * early and land the attacker's text at top level in the reply, outside the
 * quote bar and directly above the sender's real signature.
 *
 * A closing tag with nothing to close is rendered as text. Anything still open
 * at the end is closed, so the fragment cannot swallow what follows it either.
 * Well-formed mail comes back unchanged.
 */
export function neutralizeUnbalancedTags(html: string): string {
  const stack: string[] = [];
  let out = '';
  let last = 0;
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    if (VOID_ELEMENTS.has(tag) || /\/>$/.test(m[0])) {
      out += m[0];
      continue;
    }
    if (!closing) {
      stack.push(tag);
      out += m[0];
      continue;
    }
    const idx = stack.lastIndexOf(tag);
    if (idx === -1) out += m[0].replace(/</g, '&lt;').replace(/>/g, '&gt;');
    else {
      stack.length = idx;
      out += m[0];
    }
  }
  out += html.slice(last);
  for (let i = stack.length - 1; i >= 0; i--) out += `</${stack[i]}>`;
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  bull: '•',
  middot: '·',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Above the Unicode maximum, fromCodePoint throws. A message containing
      // one such entity would otherwise be impossible to reply to at all.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      return String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v ?? m;
  });
}

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"]+)/gi;
const EMAIL_RE = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/**
 * Auto-link URLs and email addresses the way Gmail does on send. Input must
 * already be HTML-escaped (so "&" appears as "&amp;", which Gmail also keeps
 * inside href attributes).
 */
export function linkify(escaped: string): string {
  const pieces: string[] = [];
  let last = 0;
  for (const m of escaped.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    pieces.push(linkifyEmails(escaped.slice(last, start)));
    let url = m[1];
    let trail = '';
    const t = url.match(/[.,;:!?)\]]+$/);
    if (t) {
      trail = t[0];
      url = url.slice(0, -trail.length);
    }
    const href = /^www\./i.test(url) ? `http://${url}` : url;
    pieces.push(`<a href="${href}" target="_blank">${url}</a>${trail}`);
    last = start + m[1].length;
  }
  pieces.push(linkifyEmails(escaped.slice(last)));
  return pieces.join('');
}

function linkifyEmails(s: string): string {
  return s.replace(EMAIL_RE, (addr) => `<a href="mailto:${addr}" target="_blank">${addr}</a>`);
}

/**
 * Turn typed plain text into the HTML Gmail's compose box produces.
 *
 * - new/forward compose: every line lives in its own <div>; blank lines are <div><br></div>
 * - reply compose: the first line is a bare text node inside the outer <div dir="ltr">
 *   and only the following lines get <div> wrappers (this is what Gmail emits when
 *   you type into a reply box).
 */
export function textToGmailHtml(text: string, mode: 'new' | 'reply' | 'forward' = 'new'): string {
  const body = normalizeNewlines(text).replace(/^\n+/, '').replace(/\s+$/, '');
  if (body === '') return mode === 'reply' ? '' : '<div><br></div>';
  const parts = body.split('\n').map((l) => (l.trim() === '' ? '<br>' : linkify(escapeHtml(l))));
  if (mode === 'reply') {
    const [first, ...rest] = parts;
    const head = first === '<br>' ? '<div><br></div>' : first;
    return head + rest.map((p) => `<div>${p}</div>`).join('');
  }
  return parts.map((p) => `<div>${p}</div>`).join('');
}

const BLOCK_TAGS = new Set([
  'div',
  'p',
  'tr',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'table',
  'hr',
  'address',
  'section',
  'article',
  'header',
  'footer',
  'dd',
  'dt',
]);

/**
 * Gmail-style HTML to plain text:
 *  - block elements break lines, <p> gets a blank line, table cells join with a space
 *  - <img alt="X"> becomes "[image: X]"
 *  - links become "text <href>" unless the text already is the address; mailto:/tel:
 *    schemes are stripped from the shown href, http(s) is kept
 *  - a link whose only content is an alt-less image becomes "<href>"
 */
export function htmlToText(html: string): string {
  let src = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  let out = '';
  const linkStack: Array<{ href: string; start: number }> = [];
  let listStack: Array<{ ordered: boolean; n: number }> = [];
  let inPre = false;

  const ensureNewline = () => {
    if (out.length && !out.endsWith('\n')) out += '\n';
  };
  const ensureBlank = () => {
    ensureNewline();
    if (!out.endsWith('\n\n')) out += '\n';
  };

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) {
    const textChunk = src.slice(idx, m.index);
    out += renderText(textChunk, inPre);
    idx = m.index + m[0].length;

    const raw = m[0];
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? '';
    const closing = raw.startsWith('</');

    if (tag === 'br') {
      out += '\n';
      continue;
    }
    if (tag === 'img') {
      const alt = getAttr(attrs, 'alt');
      if (alt) out += `[image: ${decodeEntities(alt).trim()}]`;
      continue;
    }
    if (tag === 'a') {
      if (!closing) {
        linkStack.push({ href: decodeEntities(getAttr(attrs, 'href') ?? ''), start: out.length });
      } else {
        const link = linkStack.pop();
        if (link) {
          const content = out.slice(link.start);
          out = out.slice(0, link.start) + renderLink(content, link.href);
        }
      }
      continue;
    }
    if (tag === 'pre') {
      inPre = !closing;
      closing ? ensureNewline() : ensureNewline();
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      if (!closing) {
        listStack.push({ ordered: tag === 'ol', n: 0 });
        ensureNewline();
      } else {
        listStack.pop();
        ensureNewline();
      }
      continue;
    }
    if (tag === 'li') {
      if (!closing) {
        ensureNewline();
        const l = listStack[listStack.length - 1];
        if (l) {
          l.n++;
          out += l.ordered ? `   ${l.n}. ` : '   - ';
        } else out += '   - ';
      } else ensureNewline();
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      if (closing) {
        // Cells in the same row are separated by a single space.
        if (out.length && !out.endsWith('\n') && !out.endsWith(' ')) out += ' ';
      }
      continue;
    }
    if (tag === 'p') {
      closing ? ensureBlank() : ensureBlank();
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      ensureNewline();
      continue;
    }
    // inline tags: nothing
  }
  out += renderText(src.slice(idx), inPre);

  // Tidy: trim line ends, collapse 3+ newlines, trim whole.
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t ]+$/, '').replace(/^[ \t ]+(?=\S)/, (s) => (s.length >= 3 ? s : '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderText(chunk: string, inPre: boolean): string {
  if (!chunk) return '';
  let t = decodeEntities(chunk);
  if (inPre) return t;
  // Collapse all whitespace (including NBSP) to single spaces; newlines in source are not significant.
  t = t.replace(/[\s ]+/g, ' ');
  return t;
}

function renderLink(content: string, href: string): string {
  const text = content.trim();
  let shown = href.trim();
  if (!shown) return content;
  if (/^mailto:/i.test(shown)) shown = shown.replace(/^mailto:/i, '').split('?')[0];
  else if (/^tel:/i.test(shown)) shown = shown.replace(/^tel:/i, '');
  if (!text) return `<${shown}>`;
  if (text.toLowerCase() === shown.toLowerCase()) return content;
  const stripped = shown.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (text.toLowerCase() === stripped.toLowerCase()) return content;
  // keep any leading/trailing whitespace of the content outside the annotation
  const lead = content.match(/^\s*/)?.[0] ?? '';
  const trail = content.match(/\s*$/)?.[0] ?? '';
  return `${lead}${text} <${shown}>${trail}`;
}

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = attrs.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/** Very small guard: true when the string looks like it contains HTML tags. */
export function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}
