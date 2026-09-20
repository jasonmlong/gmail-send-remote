// ==========================================
// FILE: Setup.gs
// One-time setup, token management and self-tests.
// Run these from the Apps Script editor. None of them is reachable over the
// web app, which is the point: capabilities can only be granted in person.
//
// The editor's Run button cannot pass arguments, so functions that need one
// carry an editable constant on the first line. Edit it, then Run.
// ==========================================

/**
 * Run once after pasting the project in, and again after any change here.
 * Creates the primary token if missing, registers it, makes sure the safety
 * switches exist in their off position, and prints what to put in .env.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();

  var token = props.getProperty('GMAIL_SEND_TOKEN');
  if (!token) {
    token = newSecret_();
    props.setProperty('GMAIL_SEND_TOKEN', token);
  }
  // The primary token is kept in plaintext so this function can reprint it.
  // Every other token is stored as a hash and shown only once, at mint time.
  var tokens = loadTokens_();
  tokens[hashToken_(token)] = { label: 'primary', caps: ['read', 'draft', 'send', 'settings'], created: new Date().toISOString(), primary: true };
  saveTokens_(tokens);

  if (!props.getProperty('GMAIL_SEND_ALLOW_SEND')) props.setProperty('GMAIL_SEND_ALLOW_SEND', '0');
  if (!props.getProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE')) props.setProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE', '0');

  installFormatters_();
  var profile = getProfile_();
  var sigs = listSignatures_();
  Logger.log('gmail-send ' + GMAIL_SEND_VERSION + ' is set up for ' + profile.email);
  Logger.log('Timezone (from Calendar): ' + profile.timeZone);
  Logger.log('Signatures: ' + sigs.map(function (s) { return s.id + (s.isDefault ? ' (default)' : '') + (s.html ? '' : ' [empty]'); }).join(', '));
  Logger.log('');
  Logger.log('Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone. Copy the /exec URL.');
  Logger.log('Then in gmail-send/.env:');
  Logger.log('  GMAIL_SEND_PROVIDER=appsscript');
  Logger.log('  GMAIL_SEND_APPS_SCRIPT_URL=<the /exec URL>');
  Logger.log('  GMAIL_SEND_APPS_SCRIPT_TOKEN=' + token);
}

function newSecret_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

// ---- tokens ------------------------------------------------------------------

function mintToken_(label, caps) {
  if (!label) throw new Error('A label is required, so you can tell tokens apart later.');
  for (var i = 0; i < caps.length; i++) {
    if (CAPABILITIES.indexOf(caps[i]) === -1) throw new Error('Unknown capability: ' + caps[i] + '. Valid: ' + CAPABILITIES.join(', '));
  }
  var tokens = loadTokens_();
  for (var h in tokens) {
    if (tokens[h].label === label && !tokens[h].revoked) throw new Error('A live token is already labelled "' + label + '". Revoke it first or pick another label.');
  }
  var secret = newSecret_();
  tokens[hashToken_(secret)] = { label: label, caps: caps, created: new Date().toISOString() };
  saveTokens_(tokens);

  Logger.log('Minted "' + label + '" with capabilities [' + caps.join(', ') + ']');
  Logger.log('');
  Logger.log('  ' + secret);
  Logger.log('');
  Logger.log('Copy it now. Only its hash is stored, so this is the one and only time it can be shown.');
  if (caps.indexOf('send') === -1) Logger.log('This token CANNOT send mail. That is fixed at mint time and no switch overrides it.');
  return secret;
}

/**
 * Mint a token that can read the mailbox and stage drafts, and nothing else.
 * This is the one to hand to a remote or unattended agent: it cannot send,
 * cannot touch Gmail settings, and that limit travels with the credential
 * rather than depending on a switch someone might flip later.
 */
function mintDraftOnlyToken() {
  var LABEL = 'openclaw'; // <-- edit, then Run
  mintToken_(LABEL, ['read', 'draft']);
}

/** Mint a read-only token: it can look at mail but cannot write anything at all. */
function mintReadOnlyToken() {
  var LABEL = 'read-only'; // <-- edit, then Run
  mintToken_(LABEL, ['read']);
}

/** Show every token: label, capabilities, when it was made. Secrets are not recoverable. */
function listTokens() {
  var tokens = loadTokens_();
  var keys = Object.keys(tokens);
  if (!keys.length) {
    Logger.log('No tokens. Run setup() first.');
    return;
  }
  Logger.log('label                caps                          created              state');
  keys.forEach(function (h) {
    var t = tokens[h];
    Logger.log(
      pad_(t.label, 20) + ' ' + pad_('[' + t.caps.join(', ') + ']', 29) + ' ' + pad_(String(t.created).slice(0, 19), 20) + ' ' + (t.revoked ? 'REVOKED' : 'live') + (t.primary ? ' (primary)' : '')
    );
  });
  Logger.log('');
  Logger.log('Global switches still apply on top: send=' + (allowSend_() ? 'ENABLED' : 'disabled') + ', settingsWrite=' + (allowSettingsWrite_() ? 'ENABLED' : 'disabled'));
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/** Revoke a token by its label. Takes effect on the next request; no redeploy needed. */
function revokeTokenByLabel() {
  var LABEL = 'openclaw'; // <-- edit, then Run
  var tokens = loadTokens_();
  var found = 0;
  for (var h in tokens) {
    if (tokens[h].label === LABEL && !tokens[h].revoked) {
      tokens[h].revoked = true;
      tokens[h].revokedAt = new Date().toISOString();
      found++;
    }
  }
  if (!found) throw new Error('No live token labelled "' + LABEL + '".');
  saveTokens_(tokens);
  Logger.log('Revoked "' + LABEL + '". It will be refused from the next request.');
}

/** Forget revoked tokens entirely, once you no longer need the audit trail. */
function purgeRevokedTokens() {
  var tokens = loadTokens_();
  var kept = {};
  var dropped = 0;
  for (var h in tokens) {
    if (tokens[h].revoked) dropped++;
    else kept[h] = tokens[h];
  }
  saveTokens_(kept);
  Logger.log('Purged ' + dropped + ' revoked token(s).');
}

/** Rotate the primary token. Update .env and the Claude Desktop config afterwards. */
function rotateToken() {
  var props = PropertiesService.getScriptProperties();
  var old = props.getProperty('GMAIL_SEND_TOKEN');
  var tokens = loadTokens_();
  if (old) delete tokens[hashToken_(old)];
  var secret = newSecret_();
  props.setProperty('GMAIL_SEND_TOKEN', secret);
  tokens[hashToken_(secret)] = { label: 'primary', caps: ['read', 'draft', 'send', 'settings'], created: new Date().toISOString(), primary: true };
  saveTokens_(tokens);
  Logger.log('New primary token: ' + secret);
  Logger.log('Other tokens are unaffected. Update GMAIL_SEND_APPS_SCRIPT_TOKEN in .env.');
}

// ---- switches ----------------------------------------------------------------

/**
 * Allow or forbid the sendDraft action for this deployment. Off by default.
 * This is the second gate, not the only one: a token minted without the
 * "send" capability still cannot send when this is on.
 */
function setAllowSend(flag) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_ALLOW_SEND', flag ? '1' : '0');
  Logger.log('sendDraft is now ' + (flag ? 'ENABLED for tokens holding "send"' : 'disabled for every token'));
}

/**
 * Allow or forbid writing the Gmail signature over the API. Off by default,
 * because that write changes every message you type by hand afterwards.
 */
function setAllowSettingsWrite(flag) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE', flag ? '1' : '0');
  Logger.log('saveSignature is now ' + (flag ? 'ENABLED for tokens holding "settings"' : 'disabled for every token'));
}

/** Put back the signature that the last saveSignature call replaced. */
function restoreSignature() {
  Logger.log(JSON.stringify(restoreSignature_()));
}

/**
 * Narrow what the API can read. The value is Gmail search syntax ANDed into
 * every search, so it also binds anyone calling the endpoint directly.
 */
function setSearchScope(query) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_QUERY_SCOPE', query || '');
  Logger.log('Search scope is now: ' + (query || '(none)'));
}

/** Apply the recommended scope in one click. Edit the string to change it. */
function applyRecommendedSearchScope() {
  setSearchScope('-in:spam -in:trash newer_than:180d');
}

/** Undo the above: let the API search the whole mailbox again. */
function clearSearchScope() {
  setSearchScope('');
}

/** Put the signature above the quoted text (Gmail's "insert signature before quoted text" setting). */
function setSignatureBeforeQuote(flag) {
  PropertiesService.getScriptProperties().setProperty('GMAIL_SEND_SIGNATURE_PLACEMENT', flag ? 'before-quote' : 'after-quote');
  Logger.log('Signature placement: ' + (flag ? 'before-quote' : 'after-quote'));
}

/** Print the current switches and tokens without changing anything. */
function showSettings() {
  var p = PropertiesService.getScriptProperties();
  Logger.log('version:              ' + GMAIL_SEND_VERSION);
  Logger.log('allowSend:            ' + (p.getProperty('GMAIL_SEND_ALLOW_SEND') === '1' ? 'ENABLED' : 'disabled'));
  Logger.log('allowSettingsWrite:   ' + (p.getProperty('GMAIL_SEND_ALLOW_SETTINGS_WRITE') === '1' ? 'ENABLED' : 'disabled'));
  Logger.log('searchScope:          ' + (p.getProperty('GMAIL_SEND_QUERY_SCOPE') || '(none, whole mailbox)'));
  Logger.log('signaturePlacement:   ' + (p.getProperty('GMAIL_SEND_SIGNATURE_PLACEMENT') || 'after-quote'));
  Logger.log('');
  listTokens();
}

// ---- self-tests --------------------------------------------------------------

/** Profile, signature, and a rendered (not stored) reply to the newest inbox thread. */
function selfTest() {
  installFormatters_();
  Logger.log(JSON.stringify(getProfile_(), null, 2));
  var ctx = context_();
  Logger.log('Signature in use: ' + (ctx.composeOptions.signature ? ctx.composeOptions.signature.id + ' (' + ctx.composeOptions.signature.html.length + ' chars)' : 'none'));
  var threads = GmailApp.search('in:inbox', 0, 1);
  if (!threads.length) {
    Logger.log('Inbox empty; nothing to render.');
    return;
  }
  var original = lastMessage_(threads[0].getId());
  var rendered = GmailSendCore.composeReply(original, { body: 'Hey,\n\nThis is a gmail-send self test. Nothing was saved.\n\nThank you!' }, ctx.composeOptions);
  Logger.log('Subject: ' + rendered.subject + ' | To: ' + rendered.to.map(GmailSendCore.formatAddress).join(', '));
  Logger.log(rendered.text);
}

/**
 * Creates a REAL draft (not sent) replying to the newest inbox thread, so you
 * can open Gmail and compare it with a hand-typed reply. Delete it afterwards.
 */
function testDraftLatestInbox() {
  installFormatters_();
  var threads = GmailApp.search('in:inbox', 0, 1);
  if (!threads.length) throw new Error('Inbox empty');
  var result = draftReply_({ threadId: threads[0].getId(), body: 'Hey,\n\nThis is a gmail-send test draft. It was not sent.\n\nThank you!' });
  Logger.log('Draft created: ' + result.draftId + ' in thread ' + result.threadId);
  Logger.log(result.text);
}
