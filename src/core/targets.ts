import type { SentenceTarget } from "./sentences";

/** A sentence-level snap target on a page, in reading order. */
export interface SnapTarget extends SentenceTarget {
  pageIndex: number;
}

/** PDF units of forgiveness around target rects. */
export const HIT_PADDING = 1.5;

/** Index of the target containing the PDF-unit point, or -1. */
export function hitTestTarget(
  targets: readonly SnapTarget[],
  point: { x: number; y: number },
): number {
  for (const [i, target] of targets.entries()) {
    for (const [x0, y0, x1, y1] of target.rects) {
      if (
        point.x >= x0 - HIT_PADDING &&
        point.x <= x1 + HIT_PADDING &&
        point.y >= y0 - HIT_PADDING &&
        point.y <= y1 + HIT_PADDING
      ) {
        return i;
      }
    }
  }
  return -1;
}

/** Join a reading-order range of targets into one grab text. */
export function joinTargetRange(
  targets: readonly SnapTarget[],
  from: number,
  to: number,
): string {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return targets
    .slice(lo, hi + 1)
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join(" ");
}
