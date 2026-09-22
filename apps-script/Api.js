// ==========================================
// FILE: Api.gs
// gmail-send lightweight Apps Script API.
//
// Deploy this project as a web app (Execute as: me, Access: Anyone) inside
// any Google account. An agent then POSTs JSON to the /exec URL with a
// token and gets Gmail-identical drafts written straight into that
// account's Drafts folder. No Cloud OAuth client, no payments, no tiers.
//
// Protocol:  POST { token, action, ...params }  ->  { ok: true, result } | { ok: false, error }
// Actions are listed in ACTIONS below and documented in docs/APPS-SCRIPT-API.md.
//
// SECURITY POSTURE (see docs/SECURITY-REVIEW.md)
// The deployment is reachable by anyone on the internet, so a token is the
// only guard and is treated accordingly. Two independent limits apply to
// every request:
//
//   1. The token's OWN capabilities. Each token is minted with a fixed set,
//      so a token issued for drafting cannot send, ever, regardless of any
//      switch. This is the durable limit: it travels with the credential.
//   2. The deployment's global switches. Even a token holding "send" cannot
//      send while GMAIL_SEND_ALLOW_SEND is off. These can only be changed
//      from the Apps Script editor, never over the wire.
//
// A request must pass both. Giving a remote machine a read+draft token means
// it cannot send even if someone later arms sending for the primary token.
// ==========================================

var GMAIL_SEND_VERSION = '0.4.1';

function profileForRequest_(auth) {
  var profile = getProfile_(auth);
  profile.deploymentVersion = GMAIL_SEND_VERSION;
  return profile;
}

/**
 * Unauthenticated probe. Deliberately says almost nothing: anyone who finds
 * the URL should not thereby learn whose mailbox is behind it, what version
 * is running, or what it can do. Everything else needs a token.
 */
function doGet(e) {
  return json_({ ok: true, result: { name: 'gmail-send' } });
}

// A draft with attachments is the largest legitimate body. Anything beyond
// this is someone making the script do parsing work for free.
var MAX_REQUEST_BYTES = 12 * 1024 * 1024;

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '{}';
  if (body.length > MAX_REQUEST_BYTES) return json_({ ok: false, error: 'Bad request' });

  var req;
  try {
    req = JSON.parse(body);
  } catch (parseError) {
    return json_({ ok: false, error: 'Bad request' });
  }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'Bad request' });

  // Authenticate before doing any work, so an anonymous caller cannot make
  // the script burn the owner's execution quota.
  var auth = authenticate_(req.token);
  if (!auth) return json_({ ok: false, error: 'Unauthorized' });

  // hasOwnProperty matters: a plain object literal also answers to
  // "constructor", "valueOf" and friends through its prototype, which would
  // make this allowlist not an allowlist.
  if (typeof req.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) {
    return json_({ ok: false, error: 'Unknown action' });
  }
  var entry = ACTIONS[req.action];
  if (!entry || typeof entry.fn !== 'function') return json_({ ok: false, error: 'Unknown action' });

  // Says what the action needs, not what this token holds: a stolen credential
  // should not be able to enumerate its own reach from an error message.
  if (auth.caps.indexOf(entry.cap) === -1) {
    return json_({ ok: false, error: 'This token cannot ' + req.action + '. That action needs the "' + entry.cap + '" capability.' });
  }

  try {
    installFormatters_();
    return json_({ ok: true, result: entry.fn(req, auth) });
  } catch (err) {
    var message = String((err && err.message) || err);
    console.error('gmail-send ' + req.action + ' [' + auth.label + '] failed: ' + message);
    return json_({ ok: false, error: message });
  }
}

var ACTIONS = {
  // ---- read ----
  profile: { cap: 'read', fn: function (r, auth) { return profileForRequest_(auth); } },
  listThreads: { cap: 'read', fn: function (r) { return listThreads_(r.query, r.max); } },
  getThread: { cap: 'read', fn: function (r) { return getThread_(r.threadId); } },
  getMessage: { cap: 'read', fn: function (r) { return getMessage_(r.messageId); } },
  listSignatures: { cap: 'read', fn: function () { return listSignatures_(); } },
  listDrafts: { cap: 'read', fn: function (r) { return listDrafts_(r.threadId); } },
  getDraft: { cap: 'read', fn: function (r) { return getDraft_(r.draftId); } },

  // ---- write: drafts only ----
  createDraft: { cap: 'draft', fn: function (r) { return createDraftFromRaw_(r.raw, r.threadId); } },
  updateDraft: { cap: 'draft', fn: function (r) { return updateDraftFromRaw_(r.draftId, r.raw, r.threadId); } },
  deleteDraft: { cap: 'draft', fn: function (r) { return deleteOwnDraft_(r.draftId); } },

  // ---- high-level: the script renders the Gmail-identical draft itself ----
  draftReply: { cap: 'draft', fn: function (r) { return draftReply_(r); } },
  draftNew: { cap: 'draft', fn: function (r) { return draftNew_(r); } },
  draftForward: { cap: 'draft', fn: function (r) { return draftForward_(r); } },
  redraft: { cap: 'draft', fn: function (r) { return redraft_(r); } },

  // ---- capability-gated AND switch-gated ----
  saveSignature: { cap: 'settings', fn: function (r) { return saveSignature_(r.sendAsEmail, r.html); } },
  sendDraft: { cap: 'send', fn: function (r) { return sendDraft_(r.draftId); } },
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- tokens ------------------------------------------------------------------

/**
 * Tokens are stored as SHA-256 hashes, so a dump of the script properties
 * yields nothing usable. A minted token is therefore shown exactly once, at
 * mint time; if it is lost, revoke it and mint another.
 */
function hashToken_(token) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  return out;
}

function loadTokens_() {
  var raw = PropertiesService.getScriptProperties().getProperty('GMAIL_SEND_TOKENS');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveTokens_(map) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_TOKENS', JSON.stringify(map));
}

/** Every token this script mints is 64 hex characters. */
var TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * Returns the token's record, or null. Never reveals which part failed.
 *
 * The shape check comes first and costs nothing: an anonymous flood of junk
 * tokens is refused without a Script Properties read, a registry parse or a
 * SHA-256, which is the difference between a cheap rejection and one that
 * spends the owner's daily quota.
 */
function authenticate_(token) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  var rec = loadTokens_()[hashToken_(token)];
  if (!rec || rec.revoked) return null;
  if (!Array.isArray(rec.caps) || !rec.caps.length) return null;
  return rec;
}

/**
 * Apps Script's V8 Intl has no timezone database, so the renderer's date
 * formatting is routed through Utilities.formatDate, which does.
 */
function installFormatters_() {
  GmailSendCore.setDateTimeFormatter(function (date, tz) {
    var p = Utilities.formatDate(date, tz, 'EEE|MMM|d|yyyy|h|mm|a').split('|');
    return { weekday: p[0], month: p[1], day: p[2], year: p[3], hour: p[4], minute: p[5], dayPeriod: p[6] };
  });
  GmailSendCore.setRfc2822Formatter(function (date, tz) {
    return Utilities.formatDate(date, tz, 'EEE, dd MMM yyyy HH:mm:ss Z');
  });
}
