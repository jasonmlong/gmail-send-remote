/**
 * Runtime-agnostic byte helpers so the renderer and MIME builder run in Node,
 * browsers and Google Apps Script (V8, no Buffer, no TextEncoder, no crypto).
 * Fast paths use Buffer when it exists.
 */

declare const Buffer: any;

const hasBuffer = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

export function utf8Encode(s: string): Uint8Array {
  if (hasBuffer) return new Uint8Array(Buffer.from(s, 'utf8'));
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  if (hasBuffer) return Buffer.from(bytes).toString('utf8');
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp: number;
    let n: number;
    if (b < 0x80) {
      cp = b;
      n = 1;
    } else if ((b & 0xe0) === 0xc0) {
      cp = b & 0x1f;
      n = 2;
    } else if ((b & 0xf0) === 0xe0) {
      cp = b & 0x0f;
      n = 3;
    } else {
      cp = b & 0x07;
      n = 4;
    }
    for (let k = 1; k < n; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  if (hasBuffer) return Buffer.from(bytes).toString('base64');
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const c = i + 2 < bytes.length ? bytes[i + 2] : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    out += isNaN(b) ? '=' : B64[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    out += isNaN(c) ? '=' : B64[c & 63];
  }
  return out;
}

export function base64Decode(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  if (hasBuffer) return new Uint8Array(Buffer.from(clean, 'base64'));
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function randomHex(chars: number): string {
  const g = (globalThis as any).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    const arr = new Uint8Array(Math.ceil(chars / 2));
    g.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, chars);
  }
  let out = '';
  while (out.length < chars) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function randomAlnum(chars: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const hex = randomHex(chars * 2);
  let out = '';
  for (let i = 0; i < chars; i++) out += alphabet[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  return out;
}
