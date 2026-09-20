// ==========================================
// FILE: GmailAdapter.gs
// Gmail access for the gmail-send Apps Script API: profile, threads,
// messages, signatures (sendAs settings) and drafts (raw MIME through the
// Advanced Gmail Service so To/Cc/Bcc and threading headers are exact).
// ==========================================

/**
 * @param {{label: string, caps: string[]}} [auth] the calling token's record,
 *   when there is one. Reporting its capabilities back lets a client hide
 *   actions it cannot perform rather than discovering that by failing.
 */
function getProfile_(auth) {
  var email = Session.getEffectiveUser().getEmail();
  var sendAs = [];
  try {
    var res = Gmail.Users.Settings.SendAs.list('me');
    sendAs = (res.sendAs || []).map(function (s) {
      return { email: s.sendAsEmail, name: s.displayName || undefined, isDefault: !!s.isDefault, replyTo: s.replyToAddress || undefined };
    });
  } catch (e) {
    sendAs = [{ email: email, isDefault: true }];
  }
  var def = null;
  for (var i = 0; i < sendAs.length; i++) if (sendAs[i].isDefault) def = sendAs[i];

  var caps = auth ? auth.caps : CAPABILITIES;
  return {
    email: email,
    name: def ? def.name : undefined,
    sendAs: sendAs,
    timeZone: userTimeZone_(),
    tokenLabel: auth ? auth.label : undefined,
    capabilities: caps,
    // What this caller can actually do, once both gates are applied.
    canSend: caps.indexOf('send') !== -1 && allowSend_(),
    canWriteSettings: caps.indexOf('settings') !== -1 && allowSettingsWrite_(),
  };
}

/** The user's timezone from their primary Google Calendar; falls back to the script timezone. */
function userTimeZone_() {
  try {
    var tz = CalendarApp.getDefaultCalendar().getTimeZone();
    if (tz) return tz;
  } catch (e) {
    /* calendar scope not granted */
  }
  return Session.getScriptTimeZone();
}

/** The signatures Gmail itself inserts, one per sendAs identity. */
function listSignatures_() {
  var res = Gmail.Users.Settings.SendAs.list('me');
  return (res.sendAs || []).map(function (s) {
    return {
      id: s.sendAsEmail,
      name: s.displayName ? s.displayName + ' <' + s.sendAsEmail + '>' : s.sendAsEmail,
      html: s.signature || '',
      sendAsEmail: s.sendAsEmail,
      displayName: s.displayName || undefined,
      isDefault: !!s.isDefault,
      source: 'gmail',
    };
  });
}

/**
 * Writes the Gmail signature. Gated, because this is the only write in the
 * API that lands outside the Drafts folder: it changes every message the
 * owner types by hand from then on, Gmail keeps no signature history, and an
 * empty value silently wipes the existing one. The previous value is stashed
 * in User Properties first so the change can be undone.
 */
function saveSignature_(sendAsEmail, html) {
  if (!allowSettingsWrite_()) {
    throw new Error('Writing Gmail settings is disabled on this deployment. Run setAllowSettingsWrite(true) in the editor to enable it.');
  }
  if (!html || !String(html).trim()) {
    throw new Error('Refusing to save an empty signature; that would wipe the existing one with no way back.');
  }
  var email = sendAsEmail || Session.getEffectiveUser().getEmail();
  var before = '';
  try {
    before = Gmail.Users.Settings.SendAs.get('me', email).signature || '';
  } catch (e) {
    before = '';
  }
  PropertiesService.getUserProperties().setProperty('gmail-send:signature-backup:' + email, before);
  var res = Gmail.Users.Settings.SendAs.patch({ signature: html }, 'me', email);
  return { id: email, name: res.displayName ? res.displayName + ' <' + email + '>' : email, html: res.signature || '', sendAsEmail: email, isDefault: !!res.isDefault, source: 'gmail' };
}

/** Restore the signature stashed by the last saveSignature_. Editor-only, via restoreSignature(). */
function restoreSignature_(sendAsEmail) {
  var email = sendAsEmail || Session.getEffectiveUser().getEmail();
  var key = 'gmail-send:signature-backup:' + email;
  var before = PropertiesService.getUserProperties().getProperty(key);
  if (before === null) throw new Error('No signature backup stored for ' + email);
  Gmail.Users.Settings.SendAs.patch({ signature: before }, 'me', email);
  return { restored: email, length: before.length };
}

function isMe_(address) {
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  return !!address && address.email && address.email.toLowerCase() === me;
}

function safeHeader_(message, name) {
  try {
    return message.getHeader(name) || undefined;
  } catch (e) {
    return undefined;
  }
}

function snippet_(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** GmailMessage -> the provider-agnostic Message shape GmailSendCore expects. */
function toCoreMessage_(m) {
  var refs = String(safeHeader_(m, 'References') || '').split(/\s+/).filter(Boolean);
  var from = GmailSendCore.parseAddress(m.getFrom());
  var labels = [];
  if (m.isInInbox()) labels.push('INBOX');
  if (m.isUnread()) labels.push('UNREAD');
  if (m.isDraft()) labels.push('DRAFT');
  if (isMe_(from)) labels.push('SENT');
  var attachments = m.getAttachments().map(function (a) {
    return { filename: a.getName(), mimeType: a.getContentType(), size: a.getSize() };
  });
  var replyTo = m.getReplyTo();
  return {
    id: m.getId(),
    threadId: m.getThread().getId(),
    from: from,
    to: GmailSendCore.parseAddressList(m.getTo()),
    cc: GmailSendCore.parseAddressList(m.getCc()),
    bcc: GmailSendCore.parseAddressList(m.getBcc()),
    replyTo: replyTo ? GmailSendCore.parseAddressList(replyTo) : undefined,
    subject: m.getSubject(),
    date: m.getDate(),
    messageId: safeHeader_(m, 'Message-ID'),
    inReplyTo: safeHeader_(m, 'In-Reply-To'),
    references: refs.length ? refs : undefined,
    html: m.getBody(),
    text: m.getPlainBody(),
    snippet: snippet_(m.getPlainBody()),
    labelIds: labels,
    attachments: attachments.length ? attachments : undefined,
  };
}

function summarizeThread_(t) {
  var msgs = t.getMessages();
  var seen = {};
  var participants = [];
  msgs.forEach(function (m) {
    [GmailSendCore.parseAddress(m.getFrom())].concat(GmailSendCore.parseAddressList(m.getTo()), GmailSendCore.parseAddressList(m.getCc())).forEach(function (a) {
      var k = (a.email || '').toLowerCase();
      if (k && !seen[k]) {
        seen[k] = true;
        participants.push(a);
      }
    });
  });
  var last = msgs[msgs.length - 1];
  return {
    id: t.getId(),
    subject: t.getFirstMessageSubject(),
    snippet: last ? snippet_(last.getPlainBody()) : '',
    lastDate: t.getLastMessageDate(),
    messageCount: t.getMessageCount(),
    participants: participants,
    labelIds: t.getLabels().map(function (l) { return l.getName(); }).concat(t.isInInbox() ? ['INBOX'] : [], t.isUnread() ? ['UNREAD'] : []),
  };
}

/**
 * Search, narrowed by the deployment's scope if one is set. The scope is
 * enforced here rather than in the Node client so that it also binds anyone
 * calling the endpoint directly with the token.
 */
function listThreads_(query, max) {
  var scope = searchScope_();
  var q = [scope, query || ''].filter(function (s) { return s && s.trim(); }).join(' ');
  var threads = GmailApp.search(q, 0, Math.min(max || 15, 50));
  return threads.map(summarizeThread_);
}

function getMessage_(messageId) {
  // getMessageById returns null for an unknown or foreign id, and reaching
  // into null further down produced a confusing internal error that also
  // worked as an existence oracle.
  var m = GmailApp.getMessageById(messageId);
  if (!m) throw new Error('Message not found: ' + messageId);
  return toCoreMessage_(m);
}

function getThread_(threadId) {
  var t = GmailApp.getThreadById(threadId);
  if (!t) throw new Error('Thread not found: ' + threadId);
  return { id: t.getId(), messages: t.getMessages().map(toCoreMessage_) };
}

function lastMessage_(threadId) {
  var t = GmailApp.getThreadById(threadId);
  if (!t) throw new Error('Thread not found: ' + threadId);
  var msgs = t.getMessages();
  if (!msgs.length) throw new Error('Thread has no messages: ' + threadId);
  return toCoreMessage_(msgs[msgs.length - 1]);
}

// ---- drafts ------------------------------------------------------------------

function draftToWire_(gmailDraft) {
  var msg = toCoreMessage_(gmailDraft.getMessage());
  var meta = loadMeta_(gmailDraft.getId());
  return { id: gmailDraft.getId(), threadId: msg.threadId || (meta && meta.threadId) || undefined, message: msg, updatedAt: msg.date, meta: meta || undefined };
}

function listDrafts_(threadId) {
  var out = [];
  GmailApp.getDrafts().forEach(function (d) {
    try {
      var w = draftToWire_(d);
      if (!threadId || w.threadId === threadId) out.push(w);
    } catch (e) {
      /* a draft with no message yet */
    }
  });
  return out;
}

function getDraft_(draftId) {
  var d = GmailApp.getDraft(draftId);
  if (!d) throw new Error('Draft not found: ' + draftId);
  return draftToWire_(d);
}

function rawToWebSafe_(raw) {
  return Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8);
}

// Headers the renderer legitimately produces. Anything else in a submitted raw
// message is refused, so holding the token does not confer arbitrary control
// over the headers of a staged draft.
var ALLOWED_RAW_HEADERS = {
  'mime-version': true,
  date: true,
  subject: true,
  from: true,
  to: true,
  cc: true,
  bcc: true,
  'reply-to': true,
  'in-reply-to': true,
  references: true,
  'content-type': true,
  'message-id': true,
};

function assertSafeRaw_(raw) {
  if (typeof raw !== 'string' || !raw) throw new Error('raw is required');
  var lines = raw.split(/\r?\n\r?\n/)[0].split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === '' || /^[ \t]/.test(line)) continue; // folded continuation of the line above
    var idx = line.indexOf(':');
    if (idx < 1) throw new Error('Malformed header line in raw message');
    var name = line.slice(0, idx).trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_RAW_HEADERS, name)) {
      throw new Error('Header not permitted in a raw draft: ' + name);
    }
  }
  return raw;
}

/** Creates the draft from RFC 822 source. threadId files it into the conversation like a typed reply. */
function createDraftFromRaw_(raw, threadId) {
  var resource = { message: { raw: rawToWebSafe_(assertSafeRaw_(raw)) } };
  if (threadId) resource.message.threadId = threadId;
  var created = Gmail.Users.Drafts.create(resource, 'me');
  // Mark it as ours so it can later be updated or deleted through this API.
  if (!loadMeta_(created.id)) saveMeta_(created.id, { mode: 'raw', threadId: threadId });
  return getDraft_(created.id);
}

function updateDraftFromRaw_(draftId, raw, threadId) {
  var resource = { message: { raw: rawToWebSafe_(assertSafeRaw_(raw)) } };
  if (threadId) resource.message.threadId = threadId;
  var updated = Gmail.Users.Drafts.update(resource, 'me', draftId);
  var id = updated.id || draftId;
  if (!loadMeta_(id)) saveMeta_(id, { mode: 'raw', threadId: threadId });
  return getDraft_(id);
}

/**
 * Deletes a draft, but only one this API created. Gmail's delete bypasses
 * Trash and cannot be undone, and the agent can enumerate every draft in the
 * mailbox, including half-written personal ones it had no part in.
 */
function deleteOwnDraft_(draftId) {
  if (!loadMeta_(draftId)) {
    throw new Error('Refusing to delete draft ' + draftId + ': gmail-send did not create it. Delete it in Gmail if that is what you meant.');
  }
  var d = GmailApp.getDraft(draftId);
  if (!d) throw new Error('Draft not found: ' + draftId);
  d.deleteDraft();
  clearMeta_(draftId);
  return { deleted: draftId };
}

function sendDraft_(draftId) {
  if (!allowSend_()) throw new Error('Sending is disabled on this deployment. Run setAllowSend(true) in the editor to enable it.');
  var d = GmailApp.getDraft(draftId);
  if (!d) throw new Error('Draft not found: ' + draftId);
  var sent = d.send();
  clearMeta_(draftId);
  return toCoreMessage_(sent);
}

// ---- per-draft metadata so redraft() can re-render from the typed body ------

function metaKey_(draftId) {
  return 'gmail-send:draft:' + draftId;
}

function saveMeta_(draftId, meta) {
  PropertiesService.getUserProperties().setProperty(metaKey_(draftId), JSON.stringify(meta));
}

function loadMeta_(draftId) {
  var s = PropertiesService.getUserProperties().getProperty(metaKey_(draftId));
  return s ? JSON.parse(s) : null;
}

function clearMeta_(draftId) {
  PropertiesService.getUserProperties().deleteProperty(metaKey_(draftId));
}
