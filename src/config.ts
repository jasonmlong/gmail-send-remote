import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAddress } from './core/address.js';
import type { EmailAddress, SignaturePlacement } from './core/types.js';
import type { ProviderKind } from './provider.js';

export interface AppConfig {
  provider: ProviderKind;
  credentialsPath: string;
  tokenPath: string;
  appsScriptUrl?: string;
  appsScriptToken?: string;
  simStorePath: string;
  signaturesPath: string;
  styleConfigPath: string;
  styleGuidePath?: string;
  allowSend: boolean;
  /** Undefined means "use the provider's timezone (Google Calendar), else America/New_York". */
  timeZone?: string;
  signaturePlacement: SignaturePlacement;
  amPmSeparator: string;
  from?: EmailAddress;
  previewDir: string;
  rootDir: string;
}

/** Project root = the folder that holds package.json (works from src/ and dist/). */
export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** Minimal .env loader (KEY=VALUE, # comments). Real environment variables win. */
export function loadDotEnv(rootDir: string): void {
  const p = path.join(rootDir, '.env');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function loadConfig(rootDir = projectRoot()): AppConfig {
  loadDotEnv(rootDir);
  const env = process.env;
  const r = (p: string) => (path.isAbsolute(p) ? p : path.resolve(rootDir, p));
  const provider: ProviderKind = env.GMAIL_SEND_PROVIDER === 'gmail' ? 'gmail' : env.GMAIL_SEND_PROVIDER === 'appsscript' ? 'appsscript' : 'sim';
  return {
    provider,
    credentialsPath: r(env.GMAIL_SEND_CREDENTIALS ?? 'config/credentials.json'),
    tokenPath: r(env.GMAIL_SEND_TOKEN ?? 'config/token.json'),
    appsScriptUrl: env.GMAIL_SEND_APPS_SCRIPT_URL,
    appsScriptToken: env.GMAIL_SEND_APPS_SCRIPT_TOKEN,
    simStorePath: r(env.GMAIL_SEND_SIM_STORE ?? '.gmail-sim/store.json'),
    signaturesPath: r(env.GMAIL_SEND_SIGNATURES ?? 'config/signatures.json'),
    styleConfigPath: r(env.GMAIL_SEND_STYLE_CONFIG ?? 'config/style.json'),
    styleGuidePath: env.GMAIL_SEND_STYLE_GUIDE ? r(env.GMAIL_SEND_STYLE_GUIDE) : undefined,
    allowSend: env.GMAIL_SEND_ALLOW_SEND === '1',
    timeZone: env.GMAIL_SEND_TIMEZONE || undefined,
    signaturePlacement: env.GMAIL_SEND_SIGNATURE_PLACEMENT === 'before-quote' ? 'before-quote' : 'after-quote',
    amPmSeparator: env.GMAIL_SEND_AMPM_SEPARATOR === 'space' ? ' ' : ' ',
    from: env.GMAIL_SEND_FROM ? parseAddress(env.GMAIL_SEND_FROM) : undefined,
    previewDir: r(env.GMAIL_SEND_PREVIEW_DIR ?? 'preview'),
    rootDir,
  };
}
