import {
  getPageChars,
  getSegments,
  segmentApiAbsent,
  waitForViewInitialized,
  type ReaderSegment,
} from "../adapter/reader";
import { sentenceTargetsForSegment } from "../core/sentences";
import type { SnapTarget } from "../core/targets";
import { logError } from "../utils/log";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

const cache = new WeakMap<object, Promise<ReaderSegment[] | null>>();

/** Segment access, injectable so cache semantics are unit-testable. */
export interface SegmentSource {
  getSegments: (reader: ReaderInstance) => Promise<ReaderSegment[] | null>;
  segmentApiAbsent: (reader: ReaderInstance) => boolean;
}

const adapterSource: SegmentSource = { getSegments, segmentApiAbsent };

/**
 * Text segments for a reader (null = unavailable). A null result is only
 * cached when the segment API is genuinely absent (view exists, API
 * missing); a null from a transient failure — view not yet created (~1s
 * after open on 9.0.6), page still initializing, attempt threw and was
 * logged — is uncached so a later call retries. A rejection (the adapter
 * never rejects, but the source is injectable) is likewise evicted, logged,
 * and degraded to null so one bad fetch can't poison the reader.
 */
export function getSegmentsCached(
  reader: ReaderInstance,
  source: SegmentSource = adapterSource,
): Promise<ReaderSegment[] | null> {
  let p = cache.get(reader);
  if (!p) {
    p = source
      .getSegments(reader)
      .then((segments) => {
        if (!segments && !source.segmentApiAbsent(reader)) {
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

const warmLoops = new WeakMap<object, Promise<ReaderSegment[] | null>>();

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
): Promise<ReaderSegment[] | null> {
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
 * live. false = permanently unavailable (segment API absent; the hover gate
 * closes). null = transient miss (view or segments not ready yet) — left
 * unknown so hovers keep retrying via the lazy target path and snap comes
 * alive once segments materialize.
 */
export function textSnapStateFrom(
  segments: readonly unknown[] | null,
  apiAbsent: boolean,
): boolean | null {
  if (segments) return true;
  return apiAbsent ? false : null;
}

const targetsCache = new WeakMap<object, Map<number, SnapTarget[]>>();

/** Per-page index over a segments array, built once on first use. Keyed by
 * the array itself (stable: the cached promise pins it per reader), so an
 * evicted-and-refetched segments array simply gets a fresh index. */
const pageIndexCache = new WeakMap<object, Map<number, ReaderSegment[]>>();

function segmentsByPage(
  segments: ReaderSegment[],
): Map<number, ReaderSegment[]> {
  let byPage = pageIndexCache.get(segments);
  if (!byPage) {
    byPage = new Map();
    for (const seg of segments) {
      const list = byPage.get(seg.position.pageIndex);
      if (list) list.push(seg);
      else byPage.set(seg.position.pageIndex, [seg]);
    }
    pageIndexCache.set(segments, byPage);
  }
  return byPage;
}

/**
 * Sentence snap targets for a page, computed lazily from that page's
 * paragraph segments + char geometry. Cached per reader+page only when char
 * geometry was available — targets built on the paragraph fallback (page not
 * rendered yet) are returned uncached so the page upgrades to sentence
 * granularity once its chars exist. Returns null when segments are
 * unavailable for the document.
 */
export async function getPageTargets(
  reader: ReaderInstance,
  pageIndex: number,
): Promise<SnapTarget[] | null> {
  const segments = await getSegmentsCached(reader);
  if (!segments) return null;

  let pages = targetsCache.get(reader);
  if (!pages) {
    pages = new Map();
    targetsCache.set(reader, pages);
  }
  const cached = pages.get(pageIndex);
  if (cached) return cached;

  const pageChars = getPageChars(reader, pageIndex);
  const targets: SnapTarget[] = [];
  for (const seg of segmentsByPage(segments).get(pageIndex) ?? []) {
    const slice =
      pageChars && seg.offsetEnd >= seg.offsetStart
        ? pageChars.slice(seg.offsetStart, seg.offsetEnd + 1)
        : null;
    for (const t of sentenceTargetsForSegment(
      seg.text,
      slice,
      seg.position.rects,
    )) {
      targets.push({ ...t, pageIndex });
    }
  }
  if (pageChars) pages.set(pageIndex, targets);
  return targets;
}
