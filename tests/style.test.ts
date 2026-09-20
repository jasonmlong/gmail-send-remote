import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, lintDraft } from '../src/style/lint.js';

describe('lintDraft', () => {
  it('passes a clean draft in the house style', () => {
    const r = lintDraft("Hey Priya,\n\nI took a look and I agree it needs to be built. It's going to be over a week, for sure.\n\nWhat do you think?\n\nThank you!");
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('flags dashes, emojis, banned words and name sign-offs', () => {
    const r = lintDraft('Hey Bo,\n\nTo be honest this is great — really 🎉.\n\nCatch you later\n\nSam');
    const rules = r.findings.map((f) => f.rule);
    expect(rules).toContain('no-dashes');
    expect(rules).toContain('no-emoji');
    expect(rules).toContain('banned-word');
    expect(rules).toContain('no-name-signoff');
    expect(r.ok).toBe(false);
  });

  it('flags an avoided closing and a thank-you opener, accepts a next-touchpoint closing', () => {
    const r = lintDraft('Hey Bo,\n\nThanks for pushing on this one.\n\nCatch you later');
    expect(r.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(['open-on-substance', 'avoid-closing']));
    const ok = lintDraft('Hey Bo,\n\nThe fix is in.\n\nSee you Monday!');
    expect(ok.ok).toBe(true);
    expect(ok.findings).toEqual([]);
  });

  it('warns on a non-standard closing and on length', () => {
    const r = lintDraft('Hey Bo,\n\n' + 'word '.repeat(260) + '\n\nBest regards');
    expect(r.findings.map((f) => f.rule)).toEqual(expect.arrayContaining(['closing', 'length']));
    expect(r.ok).toBe(true);
  });

  it('exposes the default rule set', () => {
    expect(DEFAULT_RULES.bannedWords).toContain('actually');
  });
});
