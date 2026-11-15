import {
  getSegments,
  segmentsUnavailable,
  waitForViewInitialized,
  type ReaderSentence,
} from "../adapter/reader";
import type { SnapTarget } from "../core/targets";
import { logError } from "../utils/log";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

const cache = new WeakMap<object, Promise<ReaderSentence[] | null>>();

/** Segment access, injectable so cache semantics are unit-testable. */
export interface SegmentSource {
  getSegments: (reader: ReaderInstance) => Promise<ReaderSentence[] | null>;
  segmentsUnavailable: (reader: ReaderInstance) => boolean;
}

const adapterSource: SegmentSource = { getSegments, segmentsUnavailable };

/**
 * Text segments for a reader (null = unavailable). A null result is only
 * cached when segments are final-unavailable (view exists and the SDT
 * loader is missing, or an SDT load completed without usable text); a null
 * from a transient failure — view not yet created, attempt threw and was
 * logged — is uncached so
 * a later call retries. A rejection (the adapter
 * never rejects, but the source is injectable) is likewise evicted, logged,
 * and degraded to null so one bad fetch can't poison the reader.
 */
export function getSegmentsCached(
  reader: ReaderInstance,
  source: SegmentSource = adapterSource,
): Promise<ReaderSentence[] | null> {
  let p = cache.get(reader);
  if (!p) {
    p = source
      .getSegments(reader)
      .then((segments) => {
        if (!segments && !source.segmentsUnavailable(reader)) {
          cache.delete(reader); // transient — allow retry
        }
        return segments;
      })
      .catch((e: unknown): null => {
        cache.delete(reader); // allow retry
        logError("getSegmentsCached", e);
        return null;
      });
    cache.set(reader, p);
  }
  return p;
}

/** Injectable view-readiness gate (adapter waitForViewInitialized). */
export type ViewReadiness = (reader: ReaderInstance) => Promise<boolean>;

export interface WarmOptions {
  source?: SegmentSource;
  waitForView?: ViewReadiness;
  /** Fired once when warming actually yielded segments — the hook for
   * follow-on cache fills (e.g. visible-page target prefetch). */
  onReady?: () => void;
}

const warmLoops = new WeakMap<object, Promise<ReaderSentence[] | null>>();

/**
 * Background segment warm-up for a reader, so activation-time fetches answer
 * from cache. Promise-driven (no polling): waits for the view to be fully
 * initialized, then populates the shared segment cache — the same per-reader
 * promise `getSegmentsCached` serves, so a grab-mode activation racing the
 * warm-up coalesces onto one fetch. Concurrent calls share one loop; a
 * settled loop is evicted so a later reader render can warm again (cheap:
 * view readiness and the segment cache both answer immediately).
 */
export function warmSegments(
  reader: ReaderInstance,
  opts: WarmOptions = {},
): Promise<ReaderSentence[] | null> {
  const existing = warmLoops.get(reader);
  if (existing) return existing;
  const loop = (async () => {
    const ready = await (opts.waitForView ?? waitForViewInitialized)(reader);
    if (!ready) return null;
    const segments = await getSegmentsCached(reader, opts.source);
    if (segments) opts.onReady?.();
    return segments;
  })()
    .catch((e: unknown): null => {
      logError("warmSegments", e);
      return null;
    })
    .finally(() => warmLoops.delete(reader));
  warmLoops.set(reader, loop);
  return loop;
}

/**
 * textSnapReady state from an activation-time segments fetch. true = snap
 * live. false = permanently unavailable (no SDT loader, or no usable SDT
 * for this document; the hover gate closes). null = transient miss (view or segments not ready yet) — left
 * unknown so hovers keep retrying via the lazy target path and snap comes
 * alive once segments materialize.
 */
export function textSnapStateFrom(
  segments: readonly unknown[] | null,
  unavailable: boolean,
): boolean | null {
  if (segments) return true;
  return unavailable ? false : null;
}

/** Per-page index over a sentences array, built once on first use. Keyed by
 * the array itself (stable: the cached promise pins it per reader), so an
 * evicted-and-refetched array simply gets a fresh index. A sentence that
 * crosses a page break is indexed on every page it touches. */
const pageIndexCache = new WeakMap<object, Map<number, SnapTarget[]>>();

function targetsByPage(sentences: ReaderSentence[]): Map<number, SnapTarget[]> {
  let byPage = pageIndexCache.get(sentences);
  if (!byPage) {
    byPage = new Map();
    for (const { text, pages } of sentences) {
      for (const { pageIndex, rects } of pages) {
        const target: SnapTarget = { text, rects, pageIndex };
        const list = byPage.get(pageIndex);
        if (list) list.push(target);
        else byPage.set(pageIndex, [target]);
      }
    }
    pageIndexCache.set(sentences, byPage);
  }
  return byPage;
}

/**
 * Sentence snap targets for a page, in reading order. Returns null when
 * segments are unavailable for the document (callers retry per
 * getSegmentsCached's transient/unavailable semantics).
 */
export async function getPageTargets(
  reader: ReaderInstance,
  pageIndex: number,
): Promise<SnapTarget[] | null> {
  const sentences = await getSegmentsCached(reader);
  if (!sentences) return null;
  return targetsByPage(sentences).get(pageIndex) ?? [];
}
