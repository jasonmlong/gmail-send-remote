import fs from 'node:fs';
import path from 'node:path';
import type { Signature } from '../core/types.js';

interface SignatureFile {
  signatures: Signature[];
}

/** Local signature library (config/signatures.json). Used by the simulator and as extras for Gmail. */
export class SignatureStore {
  constructor(private readonly filePath: string) {}

  load(): Signature[] {
    if (!fs.existsSync(this.filePath)) return [];
    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as SignatureFile;
    return (data.signatures ?? []).map((s) => ({ source: 'local', ...s }));
  }

  save(list: Signature[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({ signatures: list }, null, 2) + '\n', 'utf8');
  }

  upsert(sig: Signature): Signature {
    const list = this.load();
    const idx = list.findIndex((s) => s.id === sig.id);
    if (sig.isDefault) for (const s of list) s.isDefault = false;
    if (idx >= 0) list[idx] = { ...list[idx], ...sig };
    else list.push(sig);
    this.save(list);
    return sig;
  }

  remove(id: string): boolean {
    const list = this.load();
    const next = list.filter((s) => s.id !== id);
    this.save(next);
    return next.length !== list.length;
  }
}
