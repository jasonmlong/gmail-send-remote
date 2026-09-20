import { describe, expect, it } from 'vitest';
import { escapeHtml, htmlToText, linkify, textToGmailHtml } from '../src/core/html.js';
import { quoteText, wrapLine, wrapText } from '../src/core/wrap.js';

describe('escapeHtml', () => {
  it('escapes like Gmail (apostrophe becomes &#39;, quotes untouched)', () => {
    expect(escapeHtml(`Let's <b> & "q"`)).toBe('Let&#39;s &lt;b&gt; &amp; "q"');
  });
});

describe('textToGmailHtml', () => {
  it('new compose wraps every line in a div, blank lines are <div><br></div>', () => {
    expect(textToGmailHtml('Hey,\n\nBody line\n', 'new')).toBe('<div>Hey,</div><div><br></div><div>Body line</div>');
  });
  it('reply compose leaves the first line bare', () => {
    expect(textToGmailHtml('Hey,\n\nBody', 'reply')).toBe('Hey,<div><br></div><div>Body</div>');
  });
  it('normalizes CRLF and trims trailing blank lines', () => {
    expect(textToGmailHtml('a\r\n\r\nb\r\n\r\n', 'new')).toBe('<div>a</div><div><br></div><div>b</div>');
  });
});

describe('linkify', () => {
  it('links URLs and keeps trailing punctuation outside', () => {
    expect(linkify('see www.example.com.')).toBe('see <a href="http://www.example.com" target="_blank">www.example.com</a>.');
  });
  it('links emails', () => {
    expect(linkify('mail a.b+c@example.co.uk now')).toBe('mail <a href="mailto:a.b+c@example.co.uk" target="_blank">a.b+c@example.co.uk</a> now');
  });
});

describe('htmlToText (Gmail conversion rules)', () => {
  it('converts a signature the way Gmail writes the text/plain part', () => {
    const sig =
      '<div dir="ltr"><table cellpadding="0"><tbody><tr><td><a href="https://sigcdn.example/a1" target="_blank"><img src="x.png" width="100" alt="Northwind Labs"></a></td></tr>' +
      '<tr><td align="center">Sam Rivera</td></tr><tr><td><span>CEO</span> <span>Northwind Labs</span></td></tr>' +
      '<tr><td><span style="font-weight:600">Mobile&nbsp; </span><a href="tel:+1+(555)+010-4477" target="_blank">+1 (555) 010-4477</a></td></tr>' +
      '<tr><td><span>Email&nbsp; </span><a href="mailto:sam@northwind.example" target="_blank">sam@northwind.example</a></td></tr>' +
      '<tr><td><span>Website&nbsp; </span><a href="https://sigcdn.example/a2" target="_blank">northwind.example</a></td></tr>' +
      '<tr><td><a href="https://sigcdn.example/editor" target="_blank"><img src="pixel.png" alt=""></a></td></tr>' +
      '<tr><td><a href="https://sigcdn.example/a3" target="_blank"><img alt="Meet With Me" src="m.png"></a></td></tr>' +
      '</tbody></table></div>';
    expect(htmlToText(sig)).toBe(
      [
        '[image: Northwind Labs] <https://sigcdn.example/a1>',
        'Sam Rivera',
        'CEO Northwind Labs',
        'Mobile +1 (555) 010-4477 <+1+(555)+010-4477>',
        'Email sam@northwind.example',
        'Website northwind.example <https://sigcdn.example/a2>',
        '<https://sigcdn.example/editor>',
        '[image: Meet With Me] <https://sigcdn.example/a3>',
      ].join('\n'),
    );
  });

  it('turns Gmail compose divs back into paragraphs and joins table cells with spaces', () => {
    expect(htmlToText('<div dir="ltr">Hey,<div><br></div><div>Line &amp; more</div></div>')).toBe('Hey,\n\nLine & more');
    expect(htmlToText('<table><tr><td>No.</td><td>Link</td><td>DR</td></tr><tr><td>1</td><td>x</td><td>56</td></tr></table>')).toBe('No. Link DR\n1 x 56');
  });

  it('gives <p> a blank line and lists a marker', () => {
    expect(htmlToText('<p>One</p><p>Two</p><ul><li>a</li><li>b</li></ul>')).toBe('One\n\nTwo\n\n   - a\n   - b');
  });
});

describe('wrap / quote', () => {
  it('wraps greedily at 72 columns exactly like the observed Gmail output', () => {
    expect(wrapLine("1. Let's go ahead and open up Northstar so you are less limited. We need to progress on this faster, even if it isn't perfect.")).toEqual([
      "1. Let's go ahead and open up Northstar so you are less limited. We need",
      "to progress on this faster, even if it isn't perfect.",
    ]);
    // the break lands at the last word that still fits inside 72 columns
    expect(wrapLine("1. Let's go ahead and open up Northstar so you are less limited. We need to progress on this faster, even if it isn't perfect.")[0].length).toBe(72);
    expect(wrapText('short\n\nline')).toBe('short\n\nline');
  });
  it('quotes with "> ", blank lines as ">", and stacks existing markers', () => {
    expect(quoteText('a\n\n> b\n>> c\n')).toBe('> a\n>\n>> b\n>>> c\n>');
  });
});
