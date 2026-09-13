/**
 * Diacritic- and case-insensitive text folding.
 *
 * `fold()` returns the folded string plus an index map so that a match found
 * in the folded text can be mapped back to a range in the original string
 * (needed for highlighting "zylė" when the user typed "zyle").
 */

export interface Folded {
  text: string;
  /** map[i] = index in the original string of folded char i */
  map: number[];
}

const NON_ALNUM = /[^\p{L}\p{N}]/u;

export function fold(input: string): Folded {
  let text = "";
  const map: number[] = [];
  let lastWasSpace = true; // trims leading separators
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    // Decompose (é -> e + ́ ), drop combining marks, lowercase.
    const base = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (base === "" ) continue;
    if (NON_ALNUM.test(base)) {
      if (!lastWasSpace) {
        text += " ";
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    for (const b of base) {
      text += b;
      map.push(i);
    }
    lastWasSpace = false;
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

export function foldText(input: string): string {
  return fold(input).text;
}

export function tokens(folded: string): string[] {
  return folded ? folded.split(" ") : [];
}

/** Levenshtein distance, early-exit once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
