// ==========================================
// FILE: Drafting.gs
// High-level actions: the script renders Gmail-identical drafts itself using
// GmailSendCore (same code as the Node library), so an agent can POST just
// { action: "draftReply", threadId, body } and get a native draft in Gmail.
// ==========================================

function addrs_(v) {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) v = v.join(', ');
  return GmailSendCore.parseAddressList(String(v));
}

/** Resolve From, aliases, signature and timezone for this account. */
function context_(signatureId) {
  var profile = getProfile_();
  var def = null;
  for (var i = 0; i < profile.sendAs.length; i++) if (profile.sendAs[i].isDefault) def = profile.sendAs[i];
  def = def || profile.sendAs[0] || { email: profile.email };
  var from = { name: def.name, email: def.email };
  var myEmails = [profile.email].concat(profile.sendAs.map(function (s) { return s.email; }));

  var signature = null;
  if (signatureId !== 'none') {
    var sigs = listSignatures_().filter(function (s) { return s.html && s.html.trim(); });
    if (signatureId) {
      for (var j = 0; j < sigs.length; j++) {
        var s = sigs[j];
        if (s.id === signatureId || s.name.toLowerCase() === String(signatureId).toLowerCase() || (s.sendAsEmail || '').toLowerCase() === String(signatureId).toLowerCase()) signature = s;
      }
      if (!signature) throw new Error('Signature not found: ' + signatureId);
    } else {
      // The signature Gmail shows in Settings for the default identity wins.
      for (var k = 0; k < sigs.length; k++) if (sigs[k].isDefault) signature = sigs[k];
      if (!signature && sigs.length) signature = sigs[0];
    }
  }

  var timeZone = profile.timeZone || Session.getScriptTimeZone();
  return {
    profile: profile,
    timeZone: timeZone,
    composeOptions: {
      from: from,
      myEmails: myEmails,
      signature: signature,
      signaturePlacement: signaturePlacement_(),
      timeZone: timeZone,
    },
  };
}

function summarize_(draft, rendered) {
  return {
    draftId: draft.id,
    threadId: draft.threadId,
    mode: rendered.mode,
    subject: rendered.subject,
    from: rendered.from,
    to: rendered.to,
    cc: rendered.cc,
    bcc: rendered.bcc,
    inReplyTo: rendered.inReplyTo,
    text: rendered.text,
    htmlLength: rendered.html.length,
  };
}

function store_(rendered, ctx, existingDraftId, extraMeta) {
  var raw = GmailSendCore.buildMime(rendered, { date: new Date(), timeZone: ctx.timeZone });
  var draft = existingDraftId ? updateDraftFromRaw_(existingDraftId, raw, rendered.threadId) : createDraftFromRaw_(raw, rendered.threadId);
  var meta = {
    mode: rendered.mode,
    originalMessageId: rendered.originalMessageId,
    threadId: rendered.threadId,
    subject: rendered.subject,
    to: rendered.to,
    cc: rendered.cc,
    bcc: rendered.bcc,
    body: extraMeta.body,
    replyAll: !!extraMeta.replyAll,
    signatureId: extraMeta.signatureId || undefined,
  };
  saveMeta_(draft.id, meta);
  return summarize_(draft, rendered);
}

function draftReply_(r) {
  if (!r.body) throw new Error('body is required');
  var ctx = context_(r.signatureId);
  var original = r.messageId ? toCoreMessage_(GmailApp.getMessageById(r.messageId)) : lastMessage_(r.threadId);
  var rendered = GmailSendCore.composeReply(
    original,
    { body: r.body, replyAll: !!r.replyAll, to: addrs_(r.to), cc: addrs_(r.cc), addCc: addrs_(r.addCc), bcc: addrs_(r.bcc), addBcc: addrs_(r.addBcc) },
    ctx.composeOptions
  );
  return store_(rendered, ctx, null, r);
}

function draftNew_(r) {
  if (!r.body) throw new Error('body is required');
  var ctx = context_(r.signatureId);
  var rendered = GmailSendCore.composeNew(
    { to: addrs_(r.to) || [], cc: addrs_(r.cc), bcc: addrs_(r.bcc), subject: r.subject || '', body: r.body },
    ctx.composeOptions
  );
  return store_(rendered, ctx, null, r);
}

function draftForward_(r) {
  if (!r.messageId) throw new Error('messageId is required');
  var ctx = context_(r.signatureId);
  var original = toCoreMessage_(GmailApp.getMessageById(r.messageId));
  var rendered = GmailSendCore.composeForward(
    original,
    { to: addrs_(r.to) || [], cc: addrs_(r.cc), bcc: addrs_(r.bcc), body: r.body, includeAttachments: r.includeAttachments !== false },
    ctx.composeOptions
  );
  return store_(rendered, ctx, null, r);
}

/** Re-render an existing draft (made by this API) with a new body and/or recipients. */
function redraft_(r) {
  if (!r.draftId) throw new Error('draftId is required');
  var meta = loadMeta_(r.draftId);
  if (!meta) throw new Error('Draft ' + r.draftId + ' was not created by gmail-send; delete it and draft again.');
  var signatureId = r.signatureId !== undefined ? r.signatureId : meta.signatureId;
  var ctx = context_(signatureId);
  var body = r.body !== undefined ? r.body : meta.body;
  var to = r.to !== undefined ? addrs_(r.to) : meta.to;
  var cc = r.cc !== undefined ? addrs_(r.cc) : meta.cc;
  var bcc = r.bcc !== undefined ? addrs_(r.bcc) : meta.bcc;
  var rendered;
  if (meta.mode === 'new') {
    rendered = GmailSendCore.composeNew({ to: to || [], cc: cc, bcc: bcc, subject: r.subject !== undefined ? r.subject : meta.subject, body: body || '' }, ctx.composeOptions);
  } else if (meta.mode === 'reply') {
    var original = toCoreMessage_(GmailApp.getMessageById(meta.originalMessageId));
    rendered = GmailSendCore.composeReply(original, { body: body || '', replyAll: r.replyAll !== undefined ? !!r.replyAll : meta.replyAll, to: to, cc: cc, bcc: bcc }, ctx.composeOptions);
  } else {
    var orig = toCoreMessage_(GmailApp.getMessageById(meta.originalMessageId));
    rendered = GmailSendCore.composeForward(orig, { to: to || [], cc: cc, bcc: bcc, body: body }, ctx.composeOptions);
  }
  return store_(rendered, ctx, r.draftId, { body: body, replyAll: meta.replyAll, signatureId: signatureId });
}
