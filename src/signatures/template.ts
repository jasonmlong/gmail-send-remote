import { escapeHtml } from '../core/html.js';
import type { Signature } from '../core/types.js';

export interface SignatureFields {
  name: string;
  title?: string;
  company?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  website?: string;
  /** Extra free-form lines appended after the contact block. */
  lines?: string[];
  /** Legal/confidentiality footer. */
  disclaimer?: string;
}

/**
 * Build a signature when the account has none. Two shapes:
 *  - "plain": the exact shape Gmail's own signature editor produces for a
 *    typed signature (lines separated by <br>), which is also what the Gmail
 *    mobile app emits: Name / Title / Company / Phone.
 *  - "card": a compact table-based card with labels, still plain enough to
 *    survive Gmail's sanitizer and convert cleanly to text.
 */
export function generateSignature(fields: SignatureFields, style: 'plain' | 'card' = 'plain'): Signature {
  const id = (fields.email ?? fields.name).toLowerCase().replace(/[^a-z0-9@.]+/g, '-');
  const html = style === 'card' ? cardHtml(fields) : plainHtml(fields);
  const text = plainText(fields);
  return { id, name: `${fields.name}${fields.company ? ` (${fields.company})` : ''}`, html, text, source: 'generated' };
}

function contactLines(f: SignatureFields): string[] {
  const lines = [f.name];
  if (f.title) lines.push(f.title);
  if (f.company) lines.push(f.company);
  if (f.phone) lines.push(f.phone);
  if (f.mobile && f.mobile !== f.phone) lines.push(f.mobile);
  if (f.website) lines.push(f.website);
  if (f.lines) lines.push(...f.lines);
  return lines;
}

function plainHtml(f: SignatureFields): string {
  const lines = contactLines(f).map((l) => linkLine(l));
  let html = `<div dir="ltr">${lines.join('<br>')}</div>`;
  if (f.disclaimer) html += `<div dir="ltr"><br></div><div dir="ltr"><span style="font-size:small;color:rgb(102,102,102)">${escapeHtml(f.disclaimer)}</span></div>`;
  return html;
}

function linkLine(line: string): string {
  if (/^https?:\/\/|^www\./i.test(line)) {
    const href = /^www\./i.test(line) ? `http://${line}` : line;
    return `<a href="${href}" target="_blank">${escapeHtml(line)}</a>`;
  }
  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(line)) return `<a href="mailto:${line}" target="_blank">${escapeHtml(line)}</a>`;
  return escapeHtml(line);
}

function cardHtml(f: SignatureFields): string {
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    rows.push(
      `<tr><td style="padding:2px 8px 2px 0;font-weight:600;color:rgb(68,68,68);white-space:nowrap">${escapeHtml(label)}</td><td style="padding:2px 0">${linkLine(value)}</td></tr>`,
    );
  if (f.phone) row('Phone', f.phone);
  if (f.mobile && f.mobile !== f.phone) row('Mobile', f.mobile);
  if (f.email) row('Email', f.email);
  if (f.website) row('Website', f.website);
  const head = `<div style="font-size:16px;font-weight:600;color:rgb(34,34,34)">${escapeHtml(f.name)}</div>` +
    (f.title || f.company
      ? `<div style="color:rgb(102,102,102)">${[f.title, f.company].filter(Boolean).map((s) => escapeHtml(s as string)).join(' · ')}</div>`
      : '');
  let html = `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:13px">${head}${rows.length ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px"><tbody>${rows.join('')}</tbody></table>` : ''}`;
  if (f.lines?.length) html += f.lines.map((l) => `<div>${linkLine(l)}</div>`).join('');
  if (f.disclaimer) html += `<div style="margin-top:10px;font-size:11px;color:rgb(153,153,153)">${escapeHtml(f.disclaimer)}</div>`;
  html += '</div>';
  return html;
}

function plainText(f: SignatureFields): string {
  const lines = contactLines(f);
  if (f.disclaimer) lines.push('', f.disclaimer);
  return lines.join('\n');
}
