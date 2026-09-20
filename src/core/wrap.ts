/**
 * Plain-text layout helpers matching what Gmail generates for the text/plain
 * part of a message: greedy word wrap at 72 columns, "> " quoting that stacks
 * to ">>" on re-quote, and blank quoted lines rendered as a lone ">".
 */

export const GMAIL_WRAP_WIDTH = 72;

export function wrapLine(line: string, width = GMAIL_WRAP_WIDTH): string[] {
  if (line.length <= width) return [line];
  const words = line.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') {
      cur = w;
      continue;
    }
    if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

export function wrapText(text: string, width = GMAIL_WRAP_WIDTH): string {
  return normalizeNewlines(text)
    .split('\n')
    .flatMap((l) => wrapLine(l.replace(/\s+$/, ''), width))
    .join('\n');
}

export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

/** Prefix every line the way Gmail quotes a previous message in plain text. */
export function quoteText(text: string): string {
  return normalizeNewlines(text)
    .split('\n')
    .map((l) => {
      if (l === '') return '>';
      if (l.startsWith('>')) return '>' + l;
      return '> ' + l;
    })
    .join('\n');
}

/** Collapse runs of 3+ blank lines into 2 and trim trailing whitespace on lines. */
export function tidyText(text: string): string {
  return normalizeNewlines(text)
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
