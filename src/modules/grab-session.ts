import { GrabTrail } from "../core/trail";
import { sectionLabelFromTitle, type PaperInfo } from "../core/provenance";
import { getOutlineEntries, type OutlineEntry } from "../adapter/reader";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

/** Session-wide grab trail (see spec: grab-trail). In-memory only. */
export const trail = new GrabTrail();

const paperInfos = new Map<string, PaperInfo>();

/** Citation metadata for every paper seen this session, by paperId. */
export function paperInfoMap(): ReadonlyMap<string, PaperInfo> {
  return paperInfos;
}

export interface PaperRef {
  /** Stable paper identity for the trail (top-level item key). */
  paperId: string;
  info: PaperInfo;
}

const outlineCache = new WeakMap<object, Promise<OutlineEntry[] | null>>();

/** Start outline resolution in the background (e.g. on grab-mode
 * activation), so grab-time section lookups are answered from cache. A null
 * result is uncached — it can mean "reader still initializing" as well as
 * "no outline" — so the next grab retries instead of losing section
 * resolution for the session. */
export function prefetchOutline(reader: ReaderInstance): void {
  if (!outlineCache.has(reader as object)) {
    const p = getOutlineEntries(reader).then((entries) => {
      if (!entries) outlineCache.delete(reader as object);
      return entries;
    });
    outlineCache.set(reader as object, p);
  }
}

/** Grab delivery must never wait on outline work longer than this. */
const SECTION_RESOLVE_TIMEOUT_MS = 250;

/**
 * Resolve the outline section containing a grab: the last section starting
 * before the grab position. On the grab's own page, a section counts only if
 * its heading sits at or above the grab's top edge (PDF y is bottom-left
 * origin: larger y = higher on the page), so multiple sections starting on
 * one page disambiguate correctly. Returns undefined when the PDF has no usable outline OR when
 * resolution is slow (grab delivery is never blocked on outline work —
 * spec: grab-provenance), so locators degrade to page-only.
 */
export async function resolveSection(
  reader: ReaderInstance,
  pageIndex: number,
  pdfTopY?: number | null,
): Promise<string | undefined> {
  prefetchOutline(reader);
  const entries = await Promise.race([
    outlineCache.get(reader as object)!,
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), SECTION_RESOLVE_TIMEOUT_MS),
    ),
  ]);
  if (!entries) return undefined;
  // The scan below assumes cross-page reading order, which outline traversal
  // order follows in practice but does not guarantee; the stable page sort
  // enforces it while keeping same-page entries in document order
  const sorted = [...entries].sort((a, b) => a.pageIndex - b.pageIndex);
  let best: OutlineEntry | undefined;
  for (const entry of sorted) {
    if (entry.pageIndex > pageIndex) break;
    if (
      entry.pageIndex === pageIndex &&
      typeof pdfTopY === "number" &&
      entry.y !== null &&
      entry.y < pdfTopY
    ) {
      // Section heading starts below the grab on the same page
      continue;
    }
    best = entry;
  }
  return best ? sectionLabelFromTitle(best.title) : undefined;
}

/**
 * Trail identity + citation metadata for a top-level item, via official
 * Zotero APIs (no reader internals involved).
 */
export function paperInfoFromItem(top: Zotero.Item): PaperRef {
  const year = String(top.getField("date") ?? "").match(/\d{4}/)?.[0] ?? "";
  const ref: PaperRef = {
    paperId: `${top.libraryID}/${top.key}`,
    info: {
      title: String(top.getField("title") ?? "Untitled"),
      creatorSummary: top.firstCreator || "Unknown authors",
      year,
    },
  };
  paperInfos.set(ref.paperId, ref.info);
  return ref;
}

/** Resolve a reader attachment's paper (null when the item is missing). */
export function getPaperRef(attachmentItemID: number): PaperRef | null {
  const attachment = Zotero.Items.get(attachmentItemID);
  if (!attachment) return null;
  return paperInfoFromItem(attachment.parentItem ?? attachment);
}
