import { editDistance, fold, type Folded } from "./normalize";

export interface Bird {
  sci: string;
  en: string;
  lt: string;
  order: string;
  family: string;
  /** Wikipedia status tags: A = accidental/vagrant, I = introduced, E = endemic, Ex/Ext = extinct */
  status: string;
  /** eBird species code, e.g. "gretit1" for Great Tit — used for map/species links */
  ebird: string;
}

export type Field = "en" | "lt" | "sci";
export const FIELDS: Field[] = ["en", "lt", "sci"];

/** [start, end) ranges in the *original* string */
export type Range = [number, number];

export interface Match {
  bird: Bird;
  score: number;
  /** which field produced the best score */
  field: Field;
  highlights: Record<Field, Range[]>;
}

interface IndexedField extends Folded {
  tokens: string[];
  /** start offset of each token within the folded text */
  offsets: number[];
}

interface IndexedBird {
  bird: Bird;
  fields: Record<Field, IndexedField>;
}

function indexField(s: string): IndexedField {
  const f = fold(s);
  const tokens: string[] = [];
  const offsets: number[] = [];
  let pos = 0;
  for (const t of f.text.split(" ")) {
    if (t) {
      tokens.push(t);
      offsets.push(pos);
    }
    pos += t.length + 1;
  }
  return { ...f, tokens, offsets };
}

export class BirdIndex {
  private items: IndexedBird[];

  constructor(birds: Bird[]) {
    this.items = birds.map((bird) => ({
      bird,
      fields: {
        en: indexField(bird.en),
        lt: indexField(bird.lt),
        sci: indexField(bird.sci),
      },
    }));
  }

  get size(): number {
    return this.items.length;
  }

  search(query: string, limit = 50): Match[] {
    const q = fold(query).text;
    if (!q) return [];
    const qTokens = q.split(" ");

    const results: Match[] = [];
    for (const item of this.items) {
      let best = 0;
      let bestField: Field = "en";
      const highlights: Record<Field, Range[]> = { en: [], lt: [], sci: [] };

      for (const field of FIELDS) {
        const f = item.fields[field];
        if (!f.text) continue;
        const r = scoreField(f, q, qTokens);
        if (r.score > 0) {
          highlights[field] = r.ranges.map(([s, e]) => toOriginal(f, s, e));
          if (r.score > best) {
            best = r.score;
            bestField = field;
          }
        }
      }

      if (best > 0) {
        // Vagrants/introduced species are less likely what the user means.
        if (/\bA\b/.test(item.bird.status)) best -= 5;
        if (/\b(Ex|Ext)\b/.test(item.bird.status)) best -= 10;
        results.push({ bird: item.bird, score: best, field: bestField, highlights });
      }
    }

    results.sort((a, b) => b.score - a.score || a.bird.en.localeCompare(b.bird.en));
    return results.slice(0, limit);
  }
}

interface FieldScore {
  score: number;
  /** ranges in folded text */
  ranges: Range[];
}

const NONE: FieldScore = { score: 0, ranges: [] };

function scoreField(f: IndexedField, q: string, qTokens: string[]): FieldScore {
  const text = f.text;

  // 1. Exact
  if (text === q) return { score: 1000, ranges: [[0, text.length]] };

  // 2. Prefix of the whole name
  if (text.startsWith(q)) {
    return { score: 800 - lengthPenalty(text), ranges: [[0, q.length]] };
  }

  // 3. Every query token is a prefix of some name token (any order).
  //    "did zyl" -> "didžioji zylė", "tit great" -> "Great Tit"
  const prefixRanges = matchTokens(f, qTokens, (qt, t) => t.startsWith(qt));
  if (prefixRanges) {
    const firstTokenBonus = f.tokens[0]?.startsWith(qTokens[0]) ? 50 : 0;
    return { score: 600 + firstTokenBonus - lengthPenalty(text), ranges: prefixRanges };
  }

  // 4. Raw substring anywhere ("blackcap" inside "eurasian blackcap", "aci" in "Acrocephalus")
  const idx = text.indexOf(q);
  if (idx >= 0) return { score: 400 - lengthPenalty(text), ranges: [[idx, idx + q.length]] };

  // 5. Every query token is a substring of some token
  const subRanges = matchTokens(f, qTokens, (qt, t) => t.includes(qt));
  if (subRanges) return { score: 300 - lengthPenalty(text), ranges: subRanges };

  // 6. Fuzzy: each query token is within a small edit distance of a name token
  //    (or of that token's prefix of the same length). Only for tokens >= 4 chars.
  if (qTokens.every((t) => t.length >= 4)) {
    const fuzzyRanges = matchTokens(f, qTokens, (qt, t) => {
      const max = qt.length >= 7 ? 2 : 1;
      if (editDistance(qt, t, max) <= max) return true;
      if (t.length > qt.length && editDistance(qt, t.slice(0, qt.length), max) <= max) return true;
      return false;
    });
    if (fuzzyRanges) return { score: 150 - lengthPenalty(text), ranges: fuzzyRanges };
  }

  return NONE;
}

/**
 * Try to assign every query token to a distinct name token via `test`.
 * Returns the matched ranges (in folded text) or null if any query token is unmatched.
 */
function matchTokens(
  f: IndexedField,
  qTokens: string[],
  test: (qt: string, t: string) => boolean,
): Range[] | null {
  const used = new Set<number>();
  const ranges: Range[] = [];
  for (const qt of qTokens) {
    let found = -1;
    for (let i = 0; i < f.tokens.length; i++) {
      if (!used.has(i) && test(qt, f.tokens[i])) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    used.add(found);
    const t = f.tokens[found];
    const start = f.offsets[found];
    const inner = t.indexOf(qt);
    // Highlight the matched substring if it exists, otherwise (fuzzy) the whole token.
    if (inner >= 0) ranges.push([start + inner, start + inner + qt.length]);
    else ranges.push([start, start + t.length]);
  }
  return ranges;
}

function lengthPenalty(text: string): number {
  // Prefer shorter names among equally-good matches, but keep it small
  // so it never outranks a better match tier.
  return Math.min(text.length, 40) * 0.5;
}

function toOriginal(f: Folded, start: number, end: number): Range {
  const s = f.map[start];
  const e = f.map[end - 1] + 1;
  return [s, e];
}
