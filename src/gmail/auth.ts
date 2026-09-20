/**
 * OAuth for a Google Cloud "Desktop app" client. Credentials come from
 * config/credentials.json (downloaded from the Cloud Console); the refresh
 * token lands in config/token.json after `gmail-send auth login`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { google } from 'googleapis';
import type { AppConfig } from '../config.js';

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  // Read-only, used only to learn the user's timezone for the attribution line.
  'https://www.googleapis.com/auth/calendar.readonly',
];

interface ClientSecrets {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
}

export function loadClientSecrets(credentialsPath: string): ClientSecrets {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `OAuth client file not found at ${credentialsPath}. Create a Desktop-app OAuth client in Google Cloud Console (Gmail API enabled), download the JSON and save it there. See docs/SETUP.md.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as { installed?: ClientSecrets; web?: ClientSecrets } & ClientSecrets;
  const s = raw.installed ?? raw.web ?? raw;
  if (!s.client_id || !s.client_secret) throw new Error(`No client_id/client_secret in ${credentialsPath}`);
  return s;
}

export function createOAuthClient(cfg: AppConfig, redirectUri?: string): OAuth2Client {
  const s = loadClientSecrets(cfg.credentialsPath);
  return new google.auth.OAuth2(s.client_id, s.client_secret, redirectUri ?? s.redirect_uris?.[0]);
}

export function hasToken(cfg: AppConfig): boolean {
  return fs.existsSync(cfg.tokenPath);
}

/** Returns an authorized client or throws with the exact command to run. */
export function getAuthorizedClient(cfg: AppConfig): OAuth2Client {
  if (!hasToken(cfg)) {
    throw new Error(`Not signed in to Gmail. Run: npm run cli -- auth login   (token will be saved to ${cfg.tokenPath})`);
  }
  const client = createOAuthClient(cfg);
  const token = JSON.parse(fs.readFileSync(cfg.tokenPath, 'utf8'));
  client.setCredentials(token);
  client.on('tokens', (t) => {
    const merged = { ...token, ...t };
    fs.writeFileSync(cfg.tokenPath, JSON.stringify(merged, null, 2));
  });
  return client;
}

/** Loopback OAuth flow: opens the browser, waits for the redirect, stores the token. */
export async function loginInteractive(cfg: AppConfig, log: (s: string) => void = console.log, openBrowser = true): Promise<void> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const client = createOAuthClient(cfg, redirectUri);
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES });

  log('Open this URL in your browser to authorize Gmail access:');
  log(url);
  if (openBrowser) tryOpen(url);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for OAuth redirect (5 minutes).')), 5 * 60 * 1000);
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', redirectUri);
      if (u.pathname !== '/oauth2callback') {
        res.writeHead(404).end();
        return;
      }
      const err = u.searchParams.get('error');
      const c = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(err ? `<h2>Authorization failed: ${err}</h2>` : '<h2>gmail-send is authorized. You can close this tab.</h2>');
      clearTimeout(timer);
      if (err || !c) reject(new Error(`OAuth error: ${err ?? 'no code returned'}`));
      else resolve(c);
    });
  }).finally(() => server.close());

  const { tokens } = await client.getToken(code);
  fs.mkdirSync(path.dirname(cfg.tokenPath), { recursive: true });
  fs.writeFileSync(cfg.tokenPath, JSON.stringify(tokens, null, 2));
  log(`Token saved to ${cfg.tokenPath}`);
}

function tryOpen(url: string): void {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* user can paste the URL */
  }
}
