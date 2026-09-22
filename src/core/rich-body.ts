import { escapeAttr, escapeHtml, linkify } from './html.js';
import type { RichBodyBlock, RichTextRun } from './types.js';

const FONT_SIZES = { small: '2', normal: '3', large: '4', huge: '6' } as const;
const MAX_BLOCKS = 200;
const MAX_ITEMS = 100;
const MAX_RUNS = 50;
const MAX_BODY_CHARS = 50_000;
const MAX_RUN_CHARS = 10_000;
const MAX_LINK_CHARS = 2_048;
const UNSAFE_CONTROLS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

export function isSafeRichLink(url: string): boolean {
  if (UNSAFE_CONTROLS.test(url)) return false;
  if (/^mailto:[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/i.test(url)) return true;
  if (!/^https?:\/\/[^\x00-\x20\x7f<>"'\\]+$/i.test(url)) return false;
  const authority = url.match(/^https?:\/\/([^/?#]+)/i)?.[1];
  return !!authority && !authority.includes('@');
}

/** The core also validates because Apps Script's direct HTTP actions bypass MCP. */
export function validateRichBody(value: unknown): asserts value is RichBodyBlock[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BLOCKS) {
    throw new Error(`A formatted body needs 1 to ${MAX_BLOCKS} blocks.`);
  }
  let chars = 0;
  const validateRuns = (runs: unknown) => {
    if (!Array.isArray(runs) || runs.length < 1 || runs.length > MAX_RUNS) {
      throw new Error(`A formatted paragraph or list item needs 1 to ${MAX_RUNS} text runs.`);
    }
    for (const run of runs) {
      if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('A formatted run must be an object.');
      const r = run as Record<string, unknown>;
      if (Object.keys(r).some((key) => !['text', 'bold', 'italic', 'underline', 'size', 'link'].includes(key))) {
        throw new Error('Unknown formatted text property.');
      }
      if (typeof r.text !== 'string' || !r.text || r.text.length > MAX_RUN_CHARS || UNSAFE_CONTROLS.test(r.text)) {
        throw new Error('A formatted text run must contain one nonempty line. Use another block for a new line.');
      }
      chars += r.text.length;
      if (chars > MAX_BODY_CHARS) throw new Error('Formatted body is too long.');
      if (['bold', 'italic', 'underline'].some((key) => r[key] !== undefined && typeof r[key] !== 'boolean')) {
        throw new Error('Formatted emphasis values must be boolean.');
      }
      if (r.size !== undefined && (typeof r.size !== 'string' || !Object.prototype.hasOwnProperty.call(FONT_SIZES, r.size))) {
        throw new Error('Unknown formatted text size.');
      }
      if (r.link !== undefined && (typeof r.link !== 'string' || r.link.length > MAX_LINK_CHARS || !isSafeRichLink(r.link))) {
        throw new Error('Formatted links must use a safe https, http, or bare mailto address.');
      }
      if (typeof r.link === 'string') chars += r.link.length;
      if (chars > MAX_BODY_CHARS) throw new Error('Formatted body is too long.');
    }
  };
  for (const block of value) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('A formatted block must be an object.');
    if (block.type === 'blank') {
      if (Object.keys(block).some((key) => key !== 'type')) throw new Error('Unknown blank block property.');
    } else if (block.type === 'paragraph') {
      if (Object.keys(block).some((key) => !['type', 'runs'].includes(key))) throw new Error('Unknown paragraph property.');
      validateRuns(block.runs);
    } else if (block.type === 'bulletedList' || block.type === 'numberedList') {
      if (Object.keys(block).some((key) => !['type', 'items'].includes(key))) throw new Error('Unknown list property.');
      if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > MAX_ITEMS) {
        throw new Error(`A formatted list needs 1 to ${MAX_ITEMS} items.`);
      }
      for (const item of block.items) validateRuns(item);
    } else {
      throw new Error('Unknown formatted block type.');
    }
  }
}

function runHtml(run: RichTextRun): string {
  let html = run.link
    ? `<a href="${escapeAttr(run.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(run.text)}</a>`
    : linkify(escapeHtml(run.text));
  if (run.bold) html = `<b>${html}</b>`;
  if (run.italic) html = `<i>${html}</i>`;
  if (run.underline) html = `<u>${html}</u>`;
  if (run.size && run.size !== 'normal') html = `<font size="${FONT_SIZES[run.size]}">${html}</font>`;
  return html;
}

function runsHtml(runs: RichTextRun[]): string {
  if (!runs.length) throw new Error('A formatted paragraph or list item needs at least one text run.');
  return runs.map(runHtml).join('');
}

/** Standard email elements only. Caller text is never interpreted as HTML. */
export function richBodyToHtml(blocks: RichBodyBlock[]): string {
  validateRichBody(blocks);
  return blocks.map((block) => {
    if (block.type === 'paragraph') return `<div>${runsHtml(block.runs)}</div>`;
    if (block.type === 'blank') return '<div><br></div>';
    if (!block.items.length) throw new Error('A formatted list needs at least one item.');
    const tag = block.type === 'numberedList' ? 'ol' : 'ul';
    return `<${tag}>${block.items.map((item) => `<li>${runsHtml(item)}</li>`).join('')}</${tag}>`;
  }).join('<div><br></div>');
}

/** The same words for style checks and the MIME text/plain alternative. */
export function richBodyToText(blocks: RichBodyBlock[]): string {
  validateRichBody(blocks);
  const runText = (run: RichTextRun) => run.link && run.link !== run.text ? `${run.text} <${run.link}>` : run.text;
  return blocks.map((block) => {
    if (block.type === 'blank') return '';
    if (block.type === 'paragraph') return block.runs.map(runText).join('');
    return block.items.map((item, index) =>
      `${block.type === 'numberedList' ? `${index + 1}.` : '•'} ${item.map(runText).join('')}`,
    ).join('\n');
  }).join('\n\n').trim();
}
