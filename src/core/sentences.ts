/**
 * Sentence-level snap targets from paragraph segments (see spec: text-grab).
 *
 * Zotero's Read Aloud segments are paragraph-granular. Each segment's
 * `offsetStart..offsetEnd` (inclusive) indexes into the page's char array,
 * which EXCLUDES whitespace — so segment text maps onto chars by counting
 * non-space characters. Sentences are found with Intl.Segmenter and mapped
 * back to per-line rectangles from the char geometry.
 */

export interface CharGeom {
  inlineRect: [number, number, number, number];
  /** The character itself (unicode), when available. */
  u?: string;
  c?: string;
}

export interface SentenceTarget {
  text: string;
  rects: [number, number, number, number][];
}

/** Vertical overlap ratio below which two chars start a new visual line. */
const LINE_BREAK_OVERLAP = 0.4;

export function sentenceTargetsForSegment(
  segmentText: string,
  chars: readonly CharGeom[] | null,
  fallbackRects: [number, number, number, number][],
): SentenceTarget[] {
  const whole: SentenceTarget = { text: segmentText, rects: fallbackRects };
  if (!chars?.length) return [whole];

  // Character-exact alignment between segment text and char units. Segment
  // text is dehyphenated (chars carry line-break hyphens the text lacks) and
  // ligatures are one char unit but several letters — naive counting drifts.
  const textToChar = alignTextToChars(segmentText, chars);
  if (!textToChar) {
    // Unalignable (typical for OCR'd scans) — fall back to visual lines
    const lines = lineTargetsFromChars(chars);
    return lines.length > 1 ? lines : [whole];
  }

  const sentences = splitSentences(segmentText);
  if (sentences.length <= 1) return [whole];

  const targets: SentenceTarget[] = [];
  for (const s of sentences) {
    const start = s.start;
    const end = s.start + s.text.length;
    const text = s.text.trim();
    if (!text) continue;
    let charStart = Infinity;
    let charEnd = -1;
    for (let p = start; p < end; p++) {
      const ci = textToChar[p];
      if (ci === undefined || ci < 0) continue;
      if (ci < charStart) charStart = ci;
      if (ci > charEnd) charEnd = ci;
    }
    if (charEnd < 0) continue;
    targets.push({
      text,
      rects: mergeLineRects(chars.slice(charStart, charEnd + 1)),
    });
  }
  return targets.length ? targets : [whole];
}

/**
 * Map each position of segmentText to the char unit that renders it, walking
 * both sequences together: spaces map to nothing, ligature char units absorb
 * several text letters, and char units absent from the text (dehyphenated
 * line-break hyphens) are skipped. Returns null when the sequences cannot be
 * reconciled (e.g. OCR noise).
 */
function alignTextToChars(
  segmentText: string,
  chars: readonly CharGeom[],
): Int32Array | null {
  const map = new Int32Array(segmentText.length).fill(-1);
  let ci = 0;
  let ti = 0;
  let mismatches = 0;
  while (ti < segmentText.length) {
    const t = segmentText[ti];
    if (/\s/.test(t)) {
      ti++;
      continue;
    }
    if (ci >= chars.length) return null;
    const unit = (chars[ci].u ?? chars[ci].c ?? "").normalize("NFKC");
    if (!unit) {
      ci++;
      continue;
    }
    if (segmentText.startsWith(unit, ti)) {
      for (let k = 0; k < unit.length; k++) map[ti + k] = ci;
      ti += unit.length;
      ci++;
      continue;
    }
    // Char unit not present in text (e.g. dehyphenated hyphen) — skip it
    if (unit === "-" || unit === "­") {
      ci++;
      continue;
    }
    // Single-char tolerance for odd glyphs; too many means unalignable
    if (unit.length === 1 && ++mismatches <= 3) {
      map[ti] = ci;
      ti++;
      ci++;
      continue;
    }
    return null;
  }
  return map;
}

/**
 * One snap target per visual line, built from char geometry alone — the
 * fallback when text↔char accounting is unreliable (OCR'd scans). Line text
 * is reconstructed from the chars, inserting spaces at horizontal gaps.
 */
function lineTargetsFromChars(chars: readonly CharGeom[]): SentenceTarget[] {
  const targets: SentenceTarget[] = [];
  let lineChars: CharGeom[] = [];

  const flush = () => {
    if (!lineChars.length) return;
    const rect = lineChars.reduce<[number, number, number, number]>(
      (acc, ch) => [
        Math.min(acc[0], ch.inlineRect[0]),
        Math.min(acc[1], ch.inlineRect[1]),
        Math.max(acc[2], ch.inlineRect[2]),
        Math.max(acc[3], ch.inlineRect[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const height = rect[3] - rect[1];
    let text = "";
    for (let i = 0; i < lineChars.length; i++) {
      if (i > 0) {
        const gap = lineChars[i].inlineRect[0] - lineChars[i - 1].inlineRect[2];
        if (gap > 0.22 * height) text += " ";
      }
      text += lineChars[i].u ?? lineChars[i].c ?? "";
    }
    if (text.trim()) targets.push({ text: text.trim(), rects: [rect] });
    lineChars = [];
  };

  for (const ch of chars) {
    const prev = lineChars[lineChars.length - 1];
    if (
      prev &&
      verticalOverlap(prev.inlineRect, ch.inlineRect) < LINE_BREAK_OVERLAP
    ) {
      flush();
    }
    lineChars.push(ch);
  }
  flush();
  return targets;
}

interface SentenceSpan {
  text: string;
  /** Authoritative offset into the segment text (from the segmenter itself,
   * so dropping whitespace-only segments cannot desync later positions). */
  start: number;
}

function splitSentences(text: string): SentenceSpan[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const result: SentenceSpan[] = [];
  for (const item of segmenter.segment(text)) {
    if (item.segment.trim()) {
      result.push({ text: item.segment, start: item.index });
    }
  }
  return result;
}

/** Union consecutive char rects into one rect per visual line. */
function mergeLineRects(
  chars: readonly CharGeom[],
): [number, number, number, number][] {
  const rects: [number, number, number, number][] = [];
  let current: [number, number, number, number] | null = null;
  for (const ch of chars) {
    const r = ch.inlineRect;
    if (current && verticalOverlap(current, r) >= LINE_BREAK_OVERLAP) {
      current[0] = Math.min(current[0], r[0]);
      current[1] = Math.min(current[1], r[1]);
      current[2] = Math.max(current[2], r[2]);
      current[3] = Math.max(current[3], r[3]);
    } else {
      current = [r[0], r[1], r[2], r[3]];
      rects.push(current);
    }
  }
  return rects;
}

function verticalOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const height = Math.min(a[3] - a[1], b[3] - b[1]);
  return height > 0 ? overlap / height : 0;
}
