import type { Message, Signature } from '../core/types.js';

/**
 * Deterministic signature detection from sent mail. Gmail marks the signature
 * it inserted with class="gmail_signature" (web) or data-smartmail="gmail_signature"
 * (mobile), so the reliable approach is to pull that block out of recent sent
 * messages and keep the variant that repeats most. No AI call needed; this
 * replaces EmailDrafter's heuristic + LLM extraction for Gmail-authored mail.
 */
export function extractSignatureBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<div\b[^>]*(?:class="[^"]*gmail_signature[^"]*"|data-smartmail="gmail_signature")[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const inner = balancedInner(html, m.index + m[0].length);
    if (inner !== null) out.push(inner);
  }
  return out;
}

function balancedInner(html: string, from: number): string | null {
  const re = /<div\b[^>]*>|<\/div>/gi;
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index);
  }
  return null;
}

export interface DetectedSignature extends Signature {
  occurrences: number;
  sampleCount: number;
}

/**
 * Look at the outermost signature block of each sent message (the sender's own,
 * not ones nested inside quoted replies) and return the most common one.
 */
export function detectSignature(sent: Message[], sendAsEmail: string): DetectedSignature | null {
  const counts = new Map<string, number>();
  let samples = 0;
  for (const msg of sent) {
    if (!msg.html) continue;
    // Skip the quoted part: only look at HTML before the first gmail_quote container.
    const own = msg.html.split(/<div class="gmail_quote(?: gmail_quote_container)?">/)[0];
    const blocks = extractSignatureBlocks(own);
    if (!blocks.length) continue;
    samples++;
    const key = normalize(blocks[blocks.length - 1]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const [html, occurrences] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    id: sendAsEmail,
    name: `Detected signature for ${sendAsEmail}`,
    html,
    sendAsEmail,
    source: 'detected',
    occurrences,
    sampleCount: samples,
  };
}

function normalize(html: string): string {
  return html.replace(/\s+/g, ' ').trim();
}
