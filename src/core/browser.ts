/**
 * Entry point for the Apps Script / browser bundle. Everything in core,
 * including the MIME builder, which is runtime-agnostic. Bundled by
 * scripts/build-apps-script.mjs into apps-script/GmailSendCore.js as the
 * global `GmailSendCore`.
 */
export * from './types.js';
export * from './address.js';
export * from './wrap.js';
export * from './html.js';
export * from './rich-body.js';
export * from './attribution.js';
export * from './subject.js';
export * from './recipients.js';
export * from './compose.js';
export * from './mime.js';
export * from './encoding.js';
