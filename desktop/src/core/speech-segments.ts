/** Keep synthesis utterances short; punctuation and decimal values stay intact. */
export const MAX_SPEECH_SEGMENT = 48;
export function splitSpeech(text: string): string[] {
  let rest = text.trim();
  const segments: string[] = [];
  while (rest.length) {
    const limit = Math.min(rest.length, MAX_SPEECH_SEGMENT);
    const head = rest.slice(0, limit);
    // Prefer complete sentences, then clauses/word boundaries. A dot between
    // digits is a decimal point, not a sentence boundary.
    const end = /[。！？!?；;\n]|\.(?!\d)/g;
    let cut = 0;
    for (const match of head.matchAll(end))
      cut = match.index! + match[0].length;
    if (!cut && rest.length > limit) {
      for (const match of head.matchAll(/[，,、：:\s]/g))
        if (match.index! >= limit / 3) cut = match.index! + 1;
    }
    if (!cut) cut = limit;
    // Do not split a surrogate pair on the hard limit.
    if (cut < rest.length && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    const part = rest.slice(0, cut).trim();
    if (part) segments.push(part);
    rest = rest.slice(cut).trimStart();
  }
  return segments;
}
