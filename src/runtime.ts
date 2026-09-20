/**
 * Wires config -> provider -> DraftingService. Shared by the CLI and the MCP server.
 */
import path from 'node:path';
import { loadConfig, type AppConfig } from './config.js';
import { DraftingService } from './drafting.js';
import type { MailProvider } from './provider.js';
import { SignatureStore } from './signatures/store.js';
import { SimulatedGmail } from './simulator/simulator.js';

export interface Runtime {
  cfg: AppConfig;
  provider: MailProvider;
  drafting: DraftingService;
  signatureStore: SignatureStore;
}

export async function createRuntime(overrides: Partial<AppConfig> = {}): Promise<Runtime> {
  const cfg = { ...loadConfig(), ...overrides };
  const signatureStore = new SignatureStore(cfg.signaturesPath);
  const metaDir = path.join(cfg.rootDir, '.gmail-sim');
  let provider: MailProvider;
  if (cfg.provider === 'gmail') {
    const { getAuthorizedClient } = await import('./gmail/auth.js');
    const { GmailProvider } = await import('./gmail/client.js');
    provider = new GmailProvider(getAuthorizedClient(cfg), { metaPath: path.join(metaDir, 'gmail-draft-meta.json') });
  } else if (cfg.provider === 'appsscript') {
    const { AppsScriptProvider } = await import('./appsscript/client.js');
    provider = new AppsScriptProvider({ url: cfg.appsScriptUrl ?? '', token: cfg.appsScriptToken ?? '', metaPath: path.join(metaDir, 'appsscript-draft-meta.json') });
  } else {
    provider = new SimulatedGmail(cfg.simStorePath);
  }
  const drafting = new DraftingService(provider, {
    timeZone: cfg.timeZone,
    amPmSeparator: cfg.amPmSeparator,
    signaturePlacement: cfg.signaturePlacement,
    from: cfg.from,
    allowSend: cfg.allowSend,
    extraSignatures: signatureStore.load(),
  });
  return { cfg, provider, drafting, signatureStore };
}
