import fs from 'node:fs';
import path from 'node:path';
import type { Draft, Signature, Thread } from '../core/types.js';
import type { SendAsIdentity } from '../provider.js';

export interface SimState {
  profile: { email: string; name?: string; timeZone?: string };
  sendAs: SendAsIdentity[];
  signatures: Signature[];
  threads: Record<string, Thread>;
  drafts: Record<string, Draft>;
  counter: number;
}

export function emptyState(email = 'me@example.com', name = 'Me', timeZone = 'America/New_York'): SimState {
  return {
    profile: { email, name, timeZone },
    sendAs: [{ email, name, isDefault: true }],
    signatures: [],
    threads: {},
    drafts: {},
    counter: 0,
  };
}

const DATE_KEYS = new Set(['date', 'updatedAt', 'lastDate']);

export function loadState(filePath: string): SimState | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'), (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : v)) as SimState;
}

export function saveState(filePath: string, state: SimState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
