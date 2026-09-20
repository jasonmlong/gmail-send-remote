import fs from 'node:fs';

/**
 * Writes a file owner-only.
 *
 * Previews and the draft cache hold whole conversations in the clear. On a
 * shared host they sit next to a .env that was deliberately locked down, and
 * a default umask would leave them world-readable. writeFileSync applies the
 * mode only when creating the file, so it is reasserted; chmod is a no-op on
 * Windows, hence the catch.
 */
export function writePrivateFile(file: string, contents: string): void {
  fs.writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* not a POSIX filesystem */
  }
}
