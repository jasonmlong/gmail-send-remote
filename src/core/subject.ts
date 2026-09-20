/** Subject prefixes exactly as Gmail applies them. */

export function replySubject(subject: string): string {
  const s = subject.trim();
  if (s === '') return 'Re:';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function forwardSubject(subject: string): string {
  const s = subject.trim();
  if (s === '') return 'Fwd:';
  return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`;
}

/** Strip any number of leading Re:/Fwd:/FW: markers (used for search and grouping, not for sending). */
export function bareSubject(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|fw)\s*:\s*)+/i, '').trim();
}
