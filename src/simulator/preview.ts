/**
 * Renders a thread (plus any drafts on it) as a static HTML page that mimics
 * Gmail's conversation view: message cards, collapsed quoted text behind a
 * "..." toggle, the red "Draft" label, and the compose box for the draft. It
 * lets a person eyeball exactly what the recipient and the sender will see
 * without opening Gmail.
 */
import { escapeHtml } from '../core/html.js';
import type { Draft, EmailAddress, Message, Thread } from '../core/types.js';
import { formatGmailDateTime } from '../core/attribution.js';

export interface PreviewOptions {
  timeZone?: string;
  me?: string;
  title?: string;
}

function initials(a: EmailAddress): string {
  const n = (a.name ?? a.email).trim();
  return n.charAt(0).toUpperCase();
}

function who(a: EmailAddress): string {
  return a.name ? `<span class="name">${escapeHtml(a.name)}</span> <span class="addr">&lt;${escapeHtml(a.email)}&gt;</span>` : `<span class="name">${escapeHtml(a.email)}</span>`;
}

function list(l: EmailAddress[]): string {
  return l.map((a) => escapeHtml(a.name ?? a.email)).join(', ');
}

function bodyHtml(m: Message): string {
  if (m.html) return m.html;
  return `<div dir="ltr">${escapeHtml(m.text ?? '').replace(/\n/g, '<br>')}</div>`;
}

function messageCard(m: Message, opts: PreviewOptions, isDraft = false): string {
  const date = formatGmailDateTime(m.date, { timeZone: opts.timeZone, amPmSeparator: ' ' });
  const recipients = [...m.to, ...m.cc];
  const toLine = `to ${list(recipients.length ? recipients : [{ email: opts.me ?? 'me' }])}`;
  return `
  <article class="msg${isDraft ? ' draft' : ''}">
    <div class="hdr">
      <div class="avatar">${initials(m.from)}</div>
      <div class="meta">
        <div class="from">${isDraft ? '<span class="draft-label">Draft</span>' : who(m.from)}</div>
        <div class="to">${toLine} <span class="caret">&#9662;</span></div>
      </div>
      <div class="date">${escapeHtml(date)}</div>
    </div>
    <div class="body">${bodyHtml(m)}</div>
  </article>`;
}

function draftComposeBox(d: Draft, opts: PreviewOptions): string {
  const m = d.message;
  const r = d.rendered;
  const subject = r?.subject ?? m.subject;
  const to = list(m.to);
  const cc = m.cc.length ? `<div class="row"><span class="lbl">Cc</span>${list(m.cc)}</div>` : '';
  const bcc = m.bcc.length ? `<div class="row"><span class="lbl">Bcc</span>${list(m.bcc)}</div>` : '';
  return `
  <section class="compose">
    <div class="compose-hdr">${r?.mode === 'reply' ? 'Reply' : r?.mode === 'forward' ? 'Forward' : 'New Message'}</div>
    <div class="row"><span class="lbl">To</span>${to || '<span class="ph">Recipients</span>'}</div>${cc}${bcc}
    <div class="row subj">${escapeHtml(subject)}</div>
    <div class="editor">${bodyHtml(m)}</div>
    <div class="compose-ft"><button class="send">Send</button><span class="hint">This is a preview. Nothing here sends.</span></div>
  </section>`;
}

export function renderConversationPreview(thread: Thread | null, drafts: Draft[], opts: PreviewOptions = {}): string {
  const subject = thread?.messages[0]?.subject ?? drafts[0]?.rendered?.subject ?? '(no subject)';
  const cards = (thread?.messages ?? []).map((m) => messageCard(m, opts)).join('\n');
  const draftCards = drafts.map((d) => messageCard(d.message, opts, true)).join('\n');
  const compose = drafts.map((d) => draftComposeBox(d, opts)).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(opts.title ?? subject)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#f6f8fc; --card:#fff; --ink:#1f1f1f; --muted:#5e5e5e; --line:#e0e3e7; --accent:#0b57d0; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Google Sans",Roboto,Arial,sans-serif; font-size:14px }
  .page { max-width: 980px; margin: 0 auto; padding: 16px }
  h1 { font-size:22px; font-weight:400; margin: 8px 0 16px }
  .msg { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin-bottom:10px }
  .msg.draft { border-color:#f2b8b5 }
  .hdr { display:flex; align-items:flex-start; gap:12px }
  .avatar { width:40px; height:40px; border-radius:50%; background:#8e63ce; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:500; flex:0 0 40px }
  .meta { flex:1; min-width:0 }
  .from .name { font-weight:700 } .from .addr { color:var(--muted) }
  .to { color:var(--muted); font-size:12px } .caret { font-size:10px }
  .draft-label { color:#d93025; font-weight:700 }
  .date { color:var(--muted); font-size:12px; white-space:nowrap }
  .body { margin: 14px 0 4px 52px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.4; overflow-wrap:anywhere }
  .body img { max-width:100% }
  .gmail_quote_container { display:none }
  .quote-toggle { display:inline-block; margin:6px 0 0 52px; background:#e8eaed; border-radius:6px; padding:0 6px; line-height:14px; font-size:12px; letter-spacing:2px; color:#444; cursor:pointer; border:0 }
  .quote-toggle.open + .body-quote .gmail_quote_container, .msg.show-quote .gmail_quote_container { display:block }
  .compose { background:var(--card); border:1px solid var(--line); border-radius:12px; margin:24px 0 40px; box-shadow:0 8px 24px rgba(0,0,0,.12) }
  .compose-hdr { background:#404040; color:#fff; padding:10px 16px; border-radius:12px 12px 0 0; font-weight:500 }
  .row { padding:8px 16px; border-bottom:1px solid var(--line) } .row .lbl { color:var(--muted); margin-right:12px } .row.subj { font-weight:500 }
  .ph { color:#999 }
  .editor { padding:16px; font-family:Arial,Helvetica,sans-serif; font-size:13px; min-height:120px; line-height:1.4 }
  .editor .gmail_quote_container { display:block; opacity:.9 }
  .compose-ft { display:flex; align-items:center; gap:12px; padding:12px 16px; border-top:1px solid var(--line) }
  .send { background:var(--accent); color:#fff; border:0; border-radius:18px; padding:8px 22px; font-weight:500 }
  .hint { color:var(--muted); font-size:12px }
  footer { color:var(--muted); font-size:12px; padding:8px 0 24px }
</style></head>
<body><div class="page">
  <h1>${escapeHtml(subject)}</h1>
  ${cards}
  ${draftCards}
  ${compose}
  <footer>Preview rendered by gmail-send. Quoted text in received messages is collapsed like Gmail does; click the &#8230; button to expand.</footer>
</div>
<script>
  document.querySelectorAll('.msg').forEach(function(card){
    var q = card.querySelector('.gmail_quote_container');
    if(!q) return;
    var b = document.createElement('button'); b.className='quote-toggle'; b.textContent='•••'; b.title='Show trimmed content';
    b.addEventListener('click', function(){ card.classList.toggle('show-quote'); });
    card.appendChild(b);
  });
</script>
</body></html>`;
}
