/**
 * Style linter for drafted email bodies. The rules encode the hard constraints
 * from the writing style guide (no dashes, no emojis, banned words, approved
 * closings, no name sign-off) so an agent can check a draft before it lands
 * in Gmail. Configurable through config/style.json.
 */
import fs from 'node:fs';

export interface StyleRules {
  preferredClosings: string[];
  /** Regex source; a closing that names the next touchpoint ("See you Monday!"). */
  nextTouchpointClosingPattern?: string;
  avoidClosings: string[];
  bannedWords: string[];
  warnPhrases: string[];
  signoffNames: string[];
  greetingPrefix?: string;
  maxWords?: number;
  noEmoji: boolean;
  noDashes: boolean;
}

export const DEFAULT_RULES: StyleRules = {
  preferredClosings: ['Thank you!', 'Have a great day!', 'Talk soon!', 'Thank you very much!'],
  nextTouchpointClosingPattern: '^(See you|Talk to you|Speak) .+!$',
  avoidClosings: ['Catch you later'],
  bannedWords: ['honest', 'genuine', 'actually', 'proper', 'straight answer'],
  warnPhrases: ['every time'],
  signoffNames: ['Sam', 'Sam Rivera', '- Sam', '-Sam', 'Best, Sam', 'Thanks, Sam'],
  greetingPrefix: 'Hey ',
  maxWords: 250,
  noEmoji: true,
  noDashes: true,
};

export function loadRules(configPath?: string): StyleRules {
  if (!configPath || !fs.existsSync(configPath)) return DEFAULT_RULES;
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<StyleRules>;
  return { ...DEFAULT_RULES, ...raw };
}

export interface LintFinding {
  rule: string;
  severity: 'error' | 'warn';
  message: string;
  line?: number;
}

export interface LintResult {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: LintFinding[];
  wordCount: number;
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function lintDraft(body: string, rules: StyleRules = DEFAULT_RULES): LintResult {
  const findings: LintFinding[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.map((l, i) => ({ l: l.trim(), i })).filter((x) => x.l !== '');
  const words = body.split(/\s+/).filter(Boolean);

  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (rules.noDashes && /[–—]/.test(line)) {
      findings.push({ rule: 'no-dashes', severity: 'error', message: 'Em dash or en dash found. Use a spaced hyphen or brackets for an aside.', line: n });
    }
    if (rules.noEmoji && EMOJI_RE.test(line)) {
      findings.push({ rule: 'no-emoji', severity: 'error', message: 'Emoji found. The style guide forbids emojis.', line: n });
    }
    for (const w of rules.bannedWords) {
      const re = new RegExp(`\\b${escapeRe(w)}\\b`, 'i');
      if (re.test(line)) findings.push({ rule: 'banned-word', severity: 'error', message: `Avoid the word "${w}".`, line: n });
    }
    for (const p of rules.warnPhrases) {
      const re = new RegExp(`\\b${escapeRe(p)}\\b`, 'i');
      if (re.test(line)) findings.push({ rule: 'warn-phrase', severity: 'warn', message: `"${p}" only if it is literally true.`, line: n });
    }
  });

  if (nonEmpty.length) {
    const first = nonEmpty[0];
    if (rules.greetingPrefix && !first.l.startsWith(rules.greetingPrefix)) {
      findings.push({ rule: 'greeting', severity: 'warn', message: `Emails usually open with "${rules.greetingPrefix.trim()} <first name>,".`, line: first.i + 1 });
    }
    const opener = nonEmpty[1];
    if (opener && /^(thanks|thank you)\b/i.test(opener.l) && !/^thank you( very much)?!?$/i.test(opener.l)) {
      findings.push({ rule: 'open-on-substance', severity: 'warn', message: 'Open on substance, not on a thank-you. Thanks belongs where something was delivered.', line: opener.i + 1 });
    }

    const last = nonEmpty[nonEmpty.length - 1];
    if (rules.signoffNames.some((n) => last.l.toLowerCase() === n.toLowerCase())) {
      findings.push({ rule: 'no-name-signoff', severity: 'error', message: 'Do not sign off with a name. The signature carries it.', line: last.i + 1 });
    } else {
      const closingOk =
        rules.preferredClosings.some((c) => last.l.toLowerCase() === c.toLowerCase()) ||
        (rules.nextTouchpointClosingPattern ? new RegExp(rules.nextTouchpointClosingPattern, 'i').test(last.l) : false);
      const avoided = rules.avoidClosings.some((c) => last.l.toLowerCase().startsWith(c.toLowerCase()));
      if (avoided) findings.push({ rule: 'avoid-closing', severity: 'error', message: `Closing "${last.l}" is on the avoid list.`, line: last.i + 1 });
      else if (!closingOk && nonEmpty.length > 1) {
        findings.push({
          rule: 'closing',
          severity: 'warn',
          message: `Close with one of: ${rules.preferredClosings.join(' / ')} or the next touchpoint ("See you Monday!").`,
          line: last.i + 1,
        });
      }
    }
  }

  if (rules.maxWords && words.length > rules.maxWords) {
    findings.push({ rule: 'length', severity: 'warn', message: `${words.length} words; the guide targets 50 to 200. Split into sections or trim.` });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  return { ok: errors === 0, errors, warnings, findings, wordCount: words.length };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
