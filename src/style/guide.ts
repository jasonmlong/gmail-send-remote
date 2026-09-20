import fs from 'node:fs';

/** Fallback when no style guide file is configured. Mirrors the hard rules in the linter. */
export const BUILTIN_STYLE_SUMMARY = `Voice: informal but professional, direct, warm, action oriented. First person, address the reader as "you".
Structure: "Hey <first name>," then one line of context, then 1 to 3 short paragraphs, bullets only for discrete items.
Hard rules:
- Never use em dashes or en dashes. Use a spaced hyphen or brackets for an aside.
- No emojis.
- Avoid the words: honest, genuine, actually, proper, "straight answer" (say answer).
- "every time" only when literally true.
- Open on substance, not on thanks or a compliment.
- One topic per email. One primary ask. Phrase it as a question only when the answer is genuinely theirs.
- Bad news is stated plainly, not softened. Professional judgment is not hedged.
- Close with "Thank you!", "Have a great day!", "Talk soon!" or the next touchpoint ("See you Monday!").
- Never sign off with a name. The signature carries it.
- When someone reports a task as completed, reply with just "Thank you" or "Thank you very much!".`;

export function loadStyleGuide(path?: string): { source: 'file' | 'builtin'; path?: string; text: string } {
  if (path && fs.existsSync(path)) return { source: 'file', path, text: fs.readFileSync(path, 'utf8') };
  return { source: 'builtin', text: BUILTIN_STYLE_SUMMARY };
}
