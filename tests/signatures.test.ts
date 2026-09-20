import { describe, expect, it } from 'vitest';
import { htmlToText } from '../src/core/html.js';
import { detectSignature, extractSignatureBlocks } from '../src/signatures/detect.js';
import { generateSignature } from '../src/signatures/template.js';
import { ME, vendorMessage } from './helpers.js';

describe('generateSignature', () => {
  it('builds the plain shape Gmail itself produces and a clean text form', () => {
    const s = generateSignature({ name: 'Sam Rivera', title: 'CEO', company: 'Northwind Labs', phone: '+1 (555) 010-4477', website: 'northwind.example' });
    expect(s.html).toBe('<div dir="ltr">Sam Rivera<br>CEO<br>Northwind Labs<br>+1 (555) 010-4477<br>northwind.example</div>');
    expect(s.text).toBe('Sam Rivera\nCEO\nNorthwind Labs\n+1 (555) 010-4477\nnorthwind.example');
    expect(htmlToText(s.html)).toBe(s.text);
  });
  it('builds a card with labels and links that converts to text like Gmail', () => {
    const s = generateSignature({ name: 'Sam Rivera', title: 'CEO', company: 'Northwind Labs', mobile: '+1 (555) 010-4477', email: 'sam@x.com', website: 'https://northwind.example' }, 'card');
    expect(s.html).toContain('<td style="padding:2px 0"><a href="mailto:sam@x.com" target="_blank">sam@x.com</a></td>');
    expect(htmlToText(s.html)).toBe('Sam Rivera\nCEO · Northwind Labs\nMobile +1 (555) 010-4477\nEmail sam@x.com\nWebsite https://northwind.example');
  });
});

describe('detectSignature', () => {
  const sig = 'Sam Rivera<br>CEO';
  const sent = (n: number) =>
    vendorMessage({
      id: `s${n}`,
      from: ME,
      html: `<div dir="ltr"><div>Hey</div><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${sig}</div></div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_signature">OLD SIG IN QUOTE</div></div>\r\n`,
    });
  it('extracts balanced gmail_signature blocks', () => {
    expect(extractSignatureBlocks('<div class="gmail_signature"><div>a</div><div>b</div></div>tail')).toEqual(['<div>a</div><div>b</div>']);
  });
  it('picks the most common outer signature and ignores quoted ones', () => {
    const d = detectSignature([sent(1), sent(2), vendorMessage({ id: 's3', from: ME, html: '<div>no sig</div>' })], ME.email);
    expect(d?.html).toBe(sig);
    expect(d?.occurrences).toBe(2);
    expect(d?.sampleCount).toBe(2);
  });
  it('returns null when nothing is found', () => {
    expect(detectSignature([vendorMessage({ from: ME, html: '<div>x</div>' })], ME.email)).toBeNull();
  });
});
