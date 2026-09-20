/**
 * Exercises the REAL Apps Script files (Api.gs, GmailAdapter.gs, Drafting.gs,
 * Setup.gs plus the generated GmailSendCore bundle) by loading them into a VM
 * with stubbed Google services.
 *
 * The other Apps Script test checks the Node client against a stand-in. This
 * one checks the server: the dispatcher, the token gate, the capability
 * switches and the raw-message allowlist are what actually face the internet.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '..', 'apps-script');
const FILES = ['GmailSendCore.js', 'Api.js', 'GmailAdapter.js', 'Drafting.js', 'Setup.js'];

interface Ctx {
  doGet: (e?: unknown) => { getContent(): string };
  doPost: (e: unknown) => { getContent(): string };
  setup: () => void;
  setAllowSend: (f: boolean) => void;
  setAllowSettingsWrite: (f: boolean) => void;
  setSearchScope: (q: string) => void;
  mintToken_: (label: string, caps: string[]) => string;
  revokeTokenByLabel: () => void;
  __props: Record<string, string>;
  __userProps: Record<string, string>;
  __searches: string[];
  __patched: Array<{ email: string; signature: string }>;
  __deleted: string[];
  [k: string]: unknown;
}

const ME = 'owner@example.com';
let uuidCounter = 1;

function makeContext(): Ctx {
  const props: Record<string, string> = {};
  const userProps: Record<string, string> = {};
  const searches: string[] = [];
  const patched: Array<{ email: string; signature: string }> = [];
  const deleted: string[] = [];

  const store = (bag: Record<string, string>) => ({
    getProperty: (k: string) => (k in bag ? bag[k] : null),
    setProperty: (k: string, v: string) => {
      bag[k] = v;
    },
    deleteProperty: (k: string) => {
      delete bag[k];
    },
  });

  const message = {
    getId: () => 'msg1',
    getThread: () => thread,
    getFrom: () => 'Dana <dana@partner.example>',
    getTo: () => `Owner <${ME}>`,
    getCc: () => '',
    getBcc: () => '',
    getReplyTo: () => '',
    getSubject: () => 'Numbers',
    getDate: () => new Date('2026-09-18T12:00:26Z'),
    getHeader: (n: string) => (n === 'Message-ID' ? '<abc@mail.example>' : ''),
    getBody: () => '<div dir="ltr">Totals attached.</div>',
    getPlainBody: () => 'Totals attached.',
    getAttachments: () => [],
    isInInbox: () => true,
    isUnread: () => false,
    isDraft: () => false,
  };
  const thread = {
    getId: () => 'thr1',
    getMessages: () => [message],
    getFirstMessageSubject: () => 'Numbers',
    getLastMessageDate: () => new Date('2026-09-18T12:00:26Z'),
    getMessageCount: () => 1,
    getLabels: () => [],
    isInInbox: () => true,
    isUnread: () => false,
  };

  const drafts: Record<string, { id: string; deleted?: boolean }> = { rOWNED: { id: 'rOWNED' }, rHUMAN: { id: 'rHUMAN' } };
  const draftObj = (id: string) => ({
    getId: () => id,
    getMessage: () => message,
    deleteDraft: () => {
      drafts[id].deleted = true;
      deleted.push(id);
    },
    send: () => message,
  });

  const sandbox: Record<string, unknown> = {
    console,
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s: string) => ({ setMimeType: () => ({ getContent: () => s }) }),
    },
    PropertiesService: { getScriptProperties: () => store(props), getUserProperties: () => store(userProps) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }), getScriptTimeZone: () => 'America/New_York' },
    CalendarApp: { getDefaultCalendar: () => ({ getTimeZone: () => 'America/Cancun' }) },
    Logger: { log: () => {} },
    Utilities: {
      // Unique per call, the way Apps Script's own does, so minting two tokens
      // in one test does not silently produce the same secret twice.
      getUuid: () => `${(uuidCounter++).toString(16).padStart(8, '0')}-2222-3333-4444-555555555555`,
      base64EncodeWebSafe: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
      computeDigest: (_algo: string, value: string) => Array.from(createHash('sha256').update(value, 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'utf8' },
      formatDate: (d: Date, tz: string, fmt: string) =>
        fmt === 'EEE|MMM|d|yyyy|h|mm|a'
          ? 'Fri|Sep|18|2026|7|00|AM'
          : 'Fri, 18 Sep 2026 07:00:26 -0500',
    },
    GmailApp: {
      search: (q: string) => {
        searches.push(q);
        return [thread];
      },
      getThreadById: (id: string) => (id === 'thr1' ? thread : null),
      getMessageById: (id: string) => (id === 'msg1' ? message : null),
      getDrafts: () => Object.keys(drafts).filter((k) => !drafts[k].deleted).map(draftObj),
      getDraft: (id: string) => (drafts[id] && !drafts[id].deleted ? draftObj(id) : null),
    },
    Gmail: {
      Users: {
        Settings: {
          SendAs: {
            list: () => ({ sendAs: [{ sendAsEmail: ME, displayName: 'Owner', isDefault: true, signature: 'Owner<br>CEO' }] }),
            get: () => ({ signature: 'Owner<br>CEO' }),
            patch: (res: { signature: string }, _u: string, email: string) => {
              patched.push({ email, signature: res.signature });
              return { signature: res.signature, displayName: 'Owner', isDefault: true };
            },
          },
        },
        Drafts: {
          create: () => ({ id: 'rNEW' }),
          update: (_r: unknown, _u: string, id: string) => ({ id }),
        },
      },
    },
  };
  drafts.rNEW = { id: 'rNEW' };

  const ctx = vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f });
  sandbox.__props = props;
  sandbox.__userProps = userProps;
  sandbox.__searches = searches;
  sandbox.__patched = patched;
  sandbox.__deleted = deleted;
  return sandbox as unknown as Ctx;
}

const post = (ctx: Ctx, body: unknown) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());

describe('Apps Script endpoint', () => {
  let ctx: Ctx;
  let token: string;

  beforeEach(() => {
    ctx = makeContext();
    ctx.setup();
    token = ctx.__props.GMAIL_SEND_TOKEN;
  });

  it('S3: the unauthenticated probe says nothing beyond the product name', () => {
    expect(JSON.parse(ctx.doGet().getContent())).toEqual({ ok: true, result: { name: 'gmail-send' } });
  });

  it('rejects a missing, wrong or non-string token', () => {
    expect(post(ctx, { action: 'profile' }).error).toBe('Unauthorized');
    expect(post(ctx, { token: 'wrong', action: 'profile' }).error).toBe('Unauthorized');
    expect(post(ctx, { token: true, action: 'profile' }).error).toBe('Unauthorized');
    expect(post(ctx, { token: { a: 1 }, action: 'profile' }).error).toBe('Unauthorized');
  });

  it('S4: inherited property names are not actions', () => {
    for (const action of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', '__defineGetter__']) {
      const res = post(ctx, { token, action });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Unknown action');
    }
  });

  it('does not leak the token back through a dispatch trick', () => {
    expect(JSON.stringify(post(ctx, { token, action: 'constructor' }))).not.toContain(token);
  });

  it('serves a real action once authenticated, with the calendar timezone', () => {
    const res = post(ctx, { token, action: 'profile' });
    expect(res.ok).toBe(true);
    expect(res.result.email).toBe(ME);
    expect(res.result.timeZone).toBe('America/Cancun');
  });

  it('S7: the search scope is applied to every search', () => {
    post(ctx, { token, action: 'listThreads', query: 'from:dana' });
    expect(ctx.__searches.pop()).toBe('from:dana');
    ctx.setSearchScope('-in:spam -in:trash newer_than:180d');
    post(ctx, { token, action: 'listThreads', query: 'from:dana' });
    expect(ctx.__searches.pop()).toBe('-in:spam -in:trash newer_than:180d from:dana');
  });

  it('returns a clean error for an unknown message id instead of dying on null', () => {
    const res = post(ctx, { token, action: 'getMessage', messageId: 'nope' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Message not found: nope');
  });

  it('S5: writing the Gmail signature is refused until deliberately enabled', () => {
    const blocked = post(ctx, { token, action: 'saveSignature', html: '<div>New</div>' });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/setAllowSettingsWrite/);
    expect(ctx.__patched).toHaveLength(0);

    ctx.setAllowSettingsWrite(true);
    expect(post(ctx, { token, action: 'saveSignature', html: '' }).error).toMatch(/empty signature/);
    expect(ctx.__patched).toHaveLength(0);

    const okRes = post(ctx, { token, action: 'saveSignature', html: '<div>New</div>' });
    expect(okRes.ok).toBe(true);
    expect(ctx.__patched).toEqual([{ email: ME, signature: '<div>New</div>' }]);
    // the previous value is stashed so the change can be undone
    expect(ctx.__userProps[`gmail-send:signature-backup:${ME}`]).toBe('Owner<br>CEO');
  });

  it('S6: only drafts this API created can be deleted', () => {
    const refused = post(ctx, { token, action: 'deleteDraft', draftId: 'rHUMAN' });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/did not create it/);
    expect(ctx.__deleted).toHaveLength(0);

    const created = post(ctx, { token, action: 'createDraft', raw: 'Subject: hi\r\nTo: a@b.com\r\n\r\nbody' });
    expect(created.ok).toBe(true);
    expect(post(ctx, { token, action: 'deleteDraft', draftId: created.result.id }).ok).toBe(true);
    expect(ctx.__deleted).toContain(created.result.id);
  });

  it('a raw message may only carry headers the renderer produces', () => {
    const good = 'MIME-Version: 1.0\r\nDate: Fri, 18 Sep 2026 07:00:26 -0500\r\nSubject: hi\r\nFrom: a@b.com\r\nTo: c@d.com\r\nContent-Type: multipart/alternative; boundary="B"\r\n\r\nbody';
    expect(post(ctx, { token, action: 'createDraft', raw: good }).ok).toBe(true);

    const evil = 'Subject: hi\r\nTo: c@d.com\r\nX-Forward-To: attacker@evil.com\r\n\r\nbody';
    const res = post(ctx, { token, action: 'createDraft', raw: evil });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Header not permitted in a raw draft: x-forward-to');
  });

  it('accepts a folded header line as a continuation rather than a new header', () => {
    const folded = 'Subject: hi\r\nTo: Lena <lena@x.com>,\r\n Alex <alex@x.com>\r\n\r\nbody';
    expect(post(ctx, { token, action: 'createDraft', raw: folded }).ok).toBe(true);
  });

  it('sending stays refused until the editor switch is thrown', () => {
    const res = post(ctx, { token, action: 'sendDraft', draftId: 'rOWNED' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Sending is disabled/);
  });

  describe('per-token capabilities', () => {
    it('a draft-only token can read and draft', () => {
      const t = ctx.mintToken_('openclaw', ['read', 'draft']);
      expect(post(ctx, { token: t, action: 'listThreads' }).ok).toBe(true);
      expect(post(ctx, { token: t, action: 'draftReply', threadId: 'thr1', body: 'Hey,\n\nOk.\n\nThank you!' }).ok).toBe(true);
    });

    it('a draft-only token cannot send, even once sending is enabled globally', () => {
      const t = ctx.mintToken_('openclaw', ['read', 'draft']);
      ctx.setAllowSend(true);
      const res = post(ctx, { token: t, action: 'sendDraft', draftId: 'rOWNED' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/cannot sendDraft/);
      expect(res.error).toMatch(/needs "send"/);
      // and the primary token, which does hold "send", now can
      expect(post(ctx, { token, action: 'sendDraft', draftId: 'rOWNED' }).ok).toBe(true);
    });

    it('a draft-only token cannot touch Gmail settings', () => {
      const t = ctx.mintToken_('openclaw', ['read', 'draft']);
      ctx.setAllowSettingsWrite(true);
      const res = post(ctx, { token: t, action: 'saveSignature', html: '<div>x</div>' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/needs "settings"/);
      expect(ctx.__patched).toHaveLength(0);
    });

    it('a read-only token cannot create or delete drafts', () => {
      const t = ctx.mintToken_('viewer', ['read']);
      expect(post(ctx, { token: t, action: 'getThread', threadId: 'thr1' }).ok).toBe(true);
      expect(post(ctx, { token: t, action: 'draftNew', to: 'a@b.com', subject: 's', body: 'Hey,\n\nx\n\nThank you!' }).error).toMatch(/needs "draft"/);
      expect(post(ctx, { token: t, action: 'createDraft', raw: 'Subject: x\r\n\r\nbody' }).error).toMatch(/needs "draft"/);
      expect(post(ctx, { token: t, action: 'deleteDraft', draftId: 'rOWNED' }).error).toMatch(/needs "draft"/);
    });

    it('profile reports what the calling token may do', () => {
      const t = ctx.mintToken_('openclaw', ['read', 'draft']);
      ctx.setAllowSend(true);
      const asRemote = post(ctx, { token: t, action: 'profile' }).result;
      expect(asRemote.tokenLabel).toBe('openclaw');
      expect(asRemote.capabilities).toEqual(['read', 'draft']);
      expect(asRemote.canSend).toBe(false);

      const asPrimary = post(ctx, { token, action: 'profile' }).result;
      expect(asPrimary.tokenLabel).toBe('primary');
      expect(asPrimary.canSend).toBe(true);
    });

    it('a revoked token stops working, and the others keep working', () => {
      const t = ctx.mintToken_('openclaw', ['read', 'draft']);
      expect(post(ctx, { token: t, action: 'profile' }).ok).toBe(true);
      ctx.revokeTokenByLabel(); // the editable label in that function is 'openclaw'
      expect(post(ctx, { token: t, action: 'profile' }).error).toBe('Unauthorized');
      expect(post(ctx, { token, action: 'profile' }).ok).toBe(true);
    });

    it('stores only hashes, so the properties hold no usable secret', () => {
      const t = ctx.mintToken_('openclaw', ['read', 'draft']);
      const registry = ctx.__props.GMAIL_SEND_TOKENS;
      expect(registry).not.toContain(t);
      expect(JSON.parse(registry)[createHash('sha256').update(t, 'utf8').digest('hex')].label).toBe('openclaw');
    });

    it('refuses a duplicate live label so tokens stay tellable apart', () => {
      ctx.mintToken_('openclaw', ['read', 'draft']);
      expect(() => ctx.mintToken_('openclaw', ['read'])).toThrow(/already labelled/);
    });

    it('refuses a capability that does not exist', () => {
      expect(() => ctx.mintToken_('bad', ['read', 'admin'])).toThrow(/Unknown capability: admin/);
    });
  });

  it('there is no action that can arm sending or settings writes over the wire', () => {
    for (const action of ['setAllowSend', 'setAllowSettingsWrite', 'setup', 'rotateToken', 'setSearchScope', 'restoreSignature']) {
      expect(post(ctx, { token, action }).error).toBe('Unknown action');
    }
    post(ctx, { token, action: 'profile', allowSend: true, GMAIL_SEND_ALLOW_SEND: '1' });
    expect(ctx.__props.GMAIL_SEND_ALLOW_SEND).toBe('0');
    expect(ctx.__props.GMAIL_SEND_ALLOW_SETTINGS_WRITE).toBe('0');
  });

  it('malformed input fails closed without a stack trace', () => {
    expect(JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).getContent())).toEqual({ ok: false, error: 'Bad request' });
    expect(JSON.parse(ctx.doPost({}).getContent())).toEqual({ ok: false, error: 'Unauthorized' });
    expect(JSON.parse(ctx.doPost({ postData: { contents: 'null' } }).getContent())).toEqual({ ok: false, error: 'Bad request' });
  });

  it('drafts a Gmail-identical reply through the high-level action', () => {
    const res = post(ctx, { token, action: 'draftReply', threadId: 'thr1', body: 'Hey Dana,\n\nGot it.\n\nThank you!' });
    expect(res.ok).toBe(true);
    expect(res.result.subject).toBe('Re: Numbers');
    expect(res.result.to).toEqual([{ name: 'Dana', email: 'dana@partner.example' }]);
    expect(res.result.text).toContain('On Fri, Sep 18, 2026 at 7:00 AM Dana <dana@partner.example> wrote:');
    expect(res.result.text).toContain('> Totals attached.');
  });
});
