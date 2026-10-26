/**
 * Outline parsing.
 *
 * Long-form novels in Chinese use `第三章` / `第十七回` style headers; web
 * fiction tools use `Chapter 3`. We detect both, plus classical Chinese
 * numerals up to the thousands, so the engine knows *which* chapter the
 * outline wants to write — and therefore which point in story-time the
 * context snapshot should be taken from.
 */

const DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
};
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** Convert a (small) Chinese or Arabic numeral string to a number. */
export function chineseToNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  let section = 0;
  let number = 0;
  let touched = false;
  for (const ch of text) {
    if (ch in DIGITS) {
      number = DIGITS[ch]!;
      touched = true;
    } else if (ch in UNITS) {
      const unit = UNITS[ch]!;
      if (number === 0) number = 1; // implied 一, e.g. 十五
      section += number * unit;
      number = 0;
      touched = true;
    } else {
      return null;
    }
  }
  return touched ? section + number : null;
}

/**
 * Normalize text for entity matching: NFKC folds full-width latin/digits to
 * half-width (Ａ→A, ３→3) and some CJK variants; lower-casing makes latin
 * names case-insensitive. CJK characters are untouched, so substring
 * matching works without any tokenizer.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

const CHAPTER_PATTERNS: RegExp[] = [
  /第\s*([0-9]+|[零一二三四五六七八九十百千两]+)\s*[章回节卷幕折]/,
  /chapter\s*([0-9]+)/i,
  /\bch\.?\s*([0-9]+)/i
];

/** Detect the target chapter number in an outline; null if not found. */
export function detectChapter(text: string): number | null {
  const normalized = normalizeText(text);
  for (const pattern of CHAPTER_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && match[1]) {
      const n = chineseToNumber(match[1]);
      if (n !== null && n > 0 && n < 100000) return n;
    }
  }
  return null;
}

/**
 * Count occurrences of a needle (already normalized) in the outline.
 * Returns 0 when the needle is empty or a single character — single-character
 * names (e.g. "剑") would match huge amounts of unrelated prose, so we
 * refuse to auto-match them at all.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0 || needle.length === 1) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** All 2-character CJK grams of `text` — used for foreshadowing overlap. */
export function cjkBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  const normalized = normalizeText(text);
  for (let i = 0; i + 2 <= normalized.length; i += 1) {
    const gram = normalized.slice(i, i + 2);
    if (/[\u4e00-\u9fff]{2}/.test(gram)) grams.add(gram);
  }
  return grams;
}

export interface OutlineCues {
  raw: string;
  normalized: string;
  chapter: number | null;
}

export function parseOutline(outline: string): OutlineCues {
  return {
    raw: outline,
    normalized: normalizeText(outline),
    chapter: detectChapter(outline)
  };
}
