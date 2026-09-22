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
  var meta = {
    mode: rendered.mode,
    originalMessageId: rendered.originalMessageId,
    threadId: rendered.threadId,
    subject: rendered.subject,
    to: rendered.to,
    cc: rendered.cc,
    bcc: rendered.bcc,
    body: extraMeta.body,
    bodyBlocks: extraMeta.bodyBlocks,
    replyAll: !!extraMeta.replyAll,
    signatureId: extraMeta.signatureId || undefined,
  };
  // Check the PropertiesService per-value limit before changing a Gmail draft.
  // Each percent escape represents one UTF-8 byte; unescaped characters are ASCII.
  var metaBytes = encodeURIComponent(JSON.stringify(meta)).replace(/%[0-9a-f]{2}/gi, 'x').length;
  if (metaBytes > 8500) throw new Error('Formatted draft metadata is too large for Apps Script. Shorten the body.');
  var raw = GmailSendCore.buildMime(rendered, { date: new Date(), timeZone: ctx.timeZone });
  var draft = existingDraftId ? updateDraftFromRaw_(existingDraftId, raw, rendered.threadId) : createDraftFromRaw_(raw, rendered.threadId);
  saveMeta_(draft.id, meta);
  return summarize_(draft, rendered);
}

function draftReply_(r) {
  if (r.body === undefined && r.bodyBlocks === undefined) throw new Error('body or bodyBlocks is required');
  var ctx = context_(r.signatureId);
  var original = r.messageId ? toCoreMessage_(GmailApp.getMessageById(r.messageId)) : lastMessage_(r.threadId);
  var rendered = GmailSendCore.composeReply(
    original,
    { body: r.body, bodyBlocks: r.bodyBlocks, replyAll: !!r.replyAll, to: addrs_(r.to), cc: addrs_(r.cc), addCc: addrs_(r.addCc) },
    ctx.composeOptions
  );
  return store_(rendered, ctx, null, r);
}

function draftNew_(r) {
  if (r.body === undefined && r.bodyBlocks === undefined) throw new Error('body or bodyBlocks is required');
  var ctx = context_(r.signatureId);
  var rendered = GmailSendCore.composeNew(
    { to: addrs_(r.to) || [], cc: addrs_(r.cc), subject: r.subject || '', body: r.body, bodyBlocks: r.bodyBlocks },
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
    { to: addrs_(r.to) || [], cc: addrs_(r.cc), body: r.body, bodyBlocks: r.bodyBlocks, includeAttachments: r.includeAttachments !== false },
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
  if (r.body !== undefined && r.bodyBlocks !== undefined) throw new Error('Pass body or bodyBlocks, not both.');
  var bodyBlocks = r.bodyBlocks !== undefined ? r.bodyBlocks : (r.body === undefined ? meta.bodyBlocks : undefined);
  var body = bodyBlocks !== undefined ? undefined : (r.body !== undefined ? r.body : meta.body);
  var to = r.to !== undefined ? addrs_(r.to) : meta.to;
  var cc = r.cc !== undefined ? addrs_(r.cc) : meta.cc;
  var rendered;
  if (meta.mode === 'new') {
    rendered = GmailSendCore.composeNew({ to: to || [], cc: cc, subject: r.subject !== undefined ? r.subject : meta.subject, body: body, bodyBlocks: bodyBlocks }, ctx.composeOptions);
  } else if (meta.mode === 'reply') {
    var original = toCoreMessage_(GmailApp.getMessageById(meta.originalMessageId));
    rendered = GmailSendCore.composeReply(original, { body: body, bodyBlocks: bodyBlocks, replyAll: r.replyAll !== undefined ? !!r.replyAll : meta.replyAll, to: to, cc: cc }, ctx.composeOptions);
  } else {
    var orig = toCoreMessage_(GmailApp.getMessageById(meta.originalMessageId));
    rendered = GmailSendCore.composeForward(orig, { to: to || [], cc: cc, body: body, bodyBlocks: bodyBlocks }, ctx.composeOptions);
  }
  return store_(rendered, ctx, r.draftId, { body: body, bodyBlocks: bodyBlocks, replyAll: meta.replyAll, signatureId: signatureId });
}
