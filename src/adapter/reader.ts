/**
 * Reader adapter — the ONLY module allowed to touch Zotero reader private
 * internals (`_internalReader`, `_primaryView`, pdf.js). Everything here may
 * break between Zotero releases. Error contract (degrade + log): expected
 * absences (API missing, page not rendered) are detected by explicit
 * presence checks and return null quietly so callers degrade per the specs;
 * genuine throws are logged via logError and then degrade — never silenced.
 *
 * Access paths verified on Zotero 9.0.6 (spike S2, 2026-07-21 — see
 * openspec/changes/add-context-ferry/design.md).
 */
import { logError } from "../utils/log";

declare const Components: any;

/** Per-character geometry from the reader's page data (consumed fields only). */
export interface CharBox {
  c: string;
  u: string;
  inlineRect: [number, number, number, number];
}

/** A Read Aloud segment: text unit with PDF geometry. */
export interface ReaderSegment {
  anchor: string;
  text: string;
  position: { pageIndex: number; rects: [number, number, number, number][] };
  granularity: string;
  offsetStart: number;
  offsetEnd: number;
}

type ReaderInstance = _ZoteroTypes.ReaderInstance;

function getView(reader: ReaderInstance): any | null {
  return (reader as any)._internalReader?._primaryView ?? null;
}

const charsCache = new WeakMap<object, Map<number, CharBox[]>>();

/**
 * Per-char geometry for a page. The reader's array lives behind an Xray
 * waiver — passing privileged callbacks into its methods throws "Permission
 * denied to pass object to privileged code" — so clone into plain privileged
 * objects. Only successful clones are cached: a page that has not rendered
 * yet returns null uncached, so later calls retry once its chars exist.
 */
export function getPageChars(
  reader: ReaderInstance,
  pageIndex: number,
): CharBox[] | null {
  let pages = charsCache.get(reader as object);
  if (!pages) {
    pages = new Map();
    charsCache.set(reader as object, pages);
  }
  const cached = pages.get(pageIndex);
  if (cached) return cached;
  try {
    const raw = getView(reader)?._pdfPages?.[pageIndex]?.chars;
    if (!raw?.length) return null; // not rendered yet — retry later
    const cloned: CharBox[] = [];
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      cloned.push({
        c: ch.c,
        u: ch.u,
        inlineRect: [
          ch.inlineRect[0],
          ch.inlineRect[1],
          ch.inlineRect[2],
          ch.inlineRect[3],
        ],
      });
    }
    pages.set(pageIndex, cloned);
    return cloned;
  } catch (e) {
    logError(`getPageChars(p${pageIndex})`, e);
    return null;
  }
}

/**
 * Whether the segment machinery is *permanently* unavailable: the reader's
 * view exists but lacks the Read Aloud API (Zotero version churn). A missing
 * view is NOT absence — the view only appears ~1s after Reader.open resolves
 * (measured on 9.0.6), so callers must treat that as transient and retry.
 */
export function segmentApiAbsent(reader: ReaderInstance): boolean {
  const view = getView(reader);
  return !!view && typeof view._initReadAloudSegments !== "function";
}

/** Segment array from the Read Aloud stash in any of its observed shapes:
 * bare array (init's return value), {paragraphs} (9.0.6 stash), {segments}. */
function segmentArrayFrom(stash: any): any[] | null {
  const arr = Array.isArray(stash)
    ? stash
    : (stash?.paragraphs ?? stash?.segments);
  return Array.isArray(arr) && arr.length ? arr : null;
}

/** Re-arm the one-shot _initReadAloudSegments guard after a premature or
 * failed compute (see getSegments); never called when real data exists. */
function clearSegmentStash(view: any): void {
  view._readAloudSegmentsPromise = null;
  view._readAloudSegments = null;
}

/**
 * Sentence/paragraph segments from Zotero's shipped Read Aloud machinery
 * (local segmentation only — never touches the TTS/credits path). Returns
 * null when the API is absent (permanent — see segmentApiAbsent) or when the
 * attempt throws (transient; logged; callers may retry).
 *
 * The machinery is a fragile one-shot (reader.js _initReadAloudSegments,
 * verified on 9.0.6): it sets _readAloudSegmentsPromise BEFORE computing,
 * that promise resolves to undefined (data lands on _readAloudSegments =
 * {paragraphs, sentences}), repeat calls just return the promise, pages
 * without extracted chars are silently skipped, and a mid-compute throw
 * leaves the promise pending forever. So: read results from the stash, never
 * await the data-less promise, gate the first call on the viewer knowing its
 * pages, and clear a poisoned (empty/failed) stash so retries re-arm it.
 */
export async function getSegments(
  reader: ReaderInstance,
): Promise<ReaderSegment[] | null> {
  const view = getView(reader);
  if (typeof view?._initReadAloudSegments !== "function") return null;
  try {
    let segments = segmentArrayFrom(view._readAloudSegments);
    if (!segments && view._readAloudSegmentsPromise) {
      // A compute already ran or is in flight. If it finished empty, it ran
      // before chars were extractable — clear so the next attempt retries.
      if (view._readAloudSegments) clearSegmentStash(view);
      return null;
    }
    if (!segments) {
      // First call: computing before the document knows its pages would
      // stash empty arrays permanently — treat as not-ready instead.
      // numPages via the waived pdfDocument: the same access path outline
      // resolution uses, so it degrades identically across environments.
      if (!getWaivedPdfDocument(reader)?.numPages) return null;
      const result = await view._initReadAloudSegments();
      segments =
        segmentArrayFrom(result) ?? segmentArrayFrom(view._readAloudSegments);
      if (!segments) {
        clearSegmentStash(view);
        return null;
      }
    }
    // Clone out of the Xray waiver (see getPageChars) with plain loops
    const cloned: ReaderSegment[] = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const rects: [number, number, number, number][] = [];
      const srcRects = s.position?.rects ?? [];
      for (let j = 0; j < srcRects.length; j++) {
        const r = srcRects[j];
        rects.push([r[0], r[1], r[2], r[3]]);
      }
      cloned.push({
        anchor: s.anchor,
        text: s.text,
        position: { pageIndex: s.position?.pageIndex, rects },
        granularity: s.granularity,
        offsetStart: s.offsetStart,
        offsetEnd: s.offsetEnd,
      });
    }
    return cloned;
  } catch (e) {
    // A throw during our init call leaves the one-shot guard pending
    // forever — clear it (unless real data landed) so retries can re-run
    try {
      if (!segmentArrayFrom(view._readAloudSegments)) clearSegmentStash(view);
    } catch {
      // stash not writable — nothing further to clean up
    }
    logError("getSegments", e);
    return null;
  }
}

/**
 * One-line snapshot of the segment machinery's state, for adapter smoke
 * tests: when reader-internals churn breaks segments in CI, the failing
 * assertion carries the why.
 */
export function segmentDiagnostics(reader: ReaderInstance): string {
  try {
    const view = getView(reader);
    if (!view) return "no view";
    return [
      `apiAbsent=${typeof view._initReadAloudSegments !== "function"}`,
      `numPages=${getWaivedPdfDocument(reader)?.numPages ?? "n/a"}`,
      `stashPromise=${typeof view._readAloudSegmentsPromise}`,
      `stash=${typeof view._readAloudSegments}`,
    ].join(" ");
  } catch (e) {
    return `diagnostics failed: ${String(e)}`;
  }
}

function getWaivedPdfDocument(reader: ReaderInstance): any | null {
  const view = getView(reader);
  const win = view?._iframeWindow;
  const app = (win?.wrappedJSObject ?? win)?.PDFViewerApplication;
  return app?.pdfDocument ? Components.utils.waiveXrays(app.pdfDocument) : null;
}

/** A flattened outline entry with its resolved zero-based page index. */
export interface OutlineEntry {
  title: string;
  pageIndex: number;
  /**
   * Vertical destination coordinate in PDF units (origin bottom-left, larger
   * = higher on the page), when the destination carries one. Lets callers
   * disambiguate multiple sections starting on the same page.
   */
  y: number | null;
}

/**
 * Flatten the PDF outline and resolve each entry's destination to a page
 * index. Prefers the Zotero pdf.js fork's `getOutline2()` (used by the
 * sidebar), which returns positions pre-resolved and falls back to a
 * *generated* outline when the PDF embeds no bookmarks; the native
 * `getOutline()` + destination resolution is the fallback path. Returns null
 * when no outline exists (callers degrade to page-only locators).
 */
export async function getOutlineEntries(
  reader: ReaderInstance,
): Promise<OutlineEntry[] | null> {
  try {
    const pdfDoc = getWaivedPdfDocument(reader);
    if (typeof pdfDoc?.getOutline2 === "function") {
      const entries: OutlineEntry[] = [];
      // Walks the getOutline2 shape: {title, items, location: {position}}
      const walk = (nodes: any[]) => {
        for (const node of nodes ?? []) {
          const position = node?.location?.position;
          if (Number.isInteger(position?.pageIndex)) {
            entries.push({
              title: String(node.title ?? ""),
              pageIndex: position.pageIndex,
              y:
                typeof position.rects?.[0]?.[1] === "number"
                  ? position.rects[0][1]
                  : null,
            });
          }
          if (node?.items?.length) walk(node.items);
        }
      };
      walk(await pdfDoc.getOutline2());
      if (entries.length) return entries;
    }
    if (!pdfDoc?.getOutline) return null;
    const outline = await pdfDoc.getOutline();
    if (!outline?.length) return null;

    const flat: { title: string; dest: unknown }[] = [];
    // Walks the native getOutline shape: {title, items, dest} (unresolved)
    const walk = (nodes: any[]) => {
      for (const node of nodes) {
        flat.push({ title: String(node.title ?? ""), dest: node.dest });
        if (node.items?.length) walk(node.items);
      }
    };
    walk(outline);

    const entries: OutlineEntry[] = [];
    for (const { title, dest } of flat) {
      try {
        const explicit =
          typeof dest === "string" ? await pdfDoc.getDestination(dest) : dest;
        const ref = Array.isArray(explicit) ? explicit[0] : null;
        if (!ref) continue;
        const pageIndex = await pdfDoc.getPageIndex(ref);
        if (Number.isInteger(pageIndex) && pageIndex >= 0) {
          // XYZ dests: [ref, {name}, x, y, zoom]; FitH/FitBH: [ref, {name}, y]
          const destName = (explicit[1] as any)?.name;
          const rawY =
            destName === "XYZ"
              ? explicit[3]
              : destName === "FitH" || destName === "FitBH"
                ? explicit[2]
                : null;
          entries.push({
            title,
            pageIndex,
            y: typeof rawY === "number" ? rawY : null,
          });
        }
      } catch {
        // skip a single unresolvable destination — expected per-entry
      }
    }
    return entries.length ? entries : null;
  } catch (e) {
    logError("getOutlineEntries", e);
    return null;
  }
}

/** Clear the reader's own text selection and its popup (best effort). */
export function clearReaderSelection(reader: ReaderInstance): void {
  try {
    const view = getView(reader);
    view?._setSelectionRanges?.();
    view?._render?.();
  } catch (e) {
    logError("clearReaderSelection", e);
  }
}

/** The reader iframe's content document (where pages and canvases live). */
export function getReaderDocument(reader: ReaderInstance): Document | null {
  return getView(reader)?._iframeWindow?.document ?? null;
}

export interface PageHit {
  pageIndex: number;
  pageEl: Element;
}

/**
 * The rendered page element under viewer-client coordinates, with its
 * zero-based page index (pdf.js page elements are 1-based via
 * data-page-number).
 */
export function getPageAt(
  reader: ReaderInstance,
  clientX: number,
  clientY: number,
): PageHit | null {
  try {
    const doc = getReaderDocument(reader);
    const el = doc?.elementFromPoint(clientX, clientY);
    const pageEl = el?.closest?.(".page");
    if (!pageEl) return null;
    const num = Number(pageEl.getAttribute("data-page-number"));
    if (!Number.isFinite(num) || num < 1) return null;
    return { pageIndex: num - 1, pageEl };
  } catch (e) {
    logError("getPageAt", e);
    return null;
  }
}

/** The rendered page element for a page index, if currently mounted (pdf.js
 * virtualizes pages, so elements come and go with scrolling). */
export function getPageEl(
  reader: ReaderInstance,
  pageIndex: number,
): Element | null {
  try {
    const doc = getReaderDocument(reader);
    return (
      doc?.querySelector(`.page[data-page-number="${pageIndex + 1}"]`) ?? null
    );
  } catch (e) {
    logError(`getPageEl(p${pageIndex})`, e);
    return null;
  }
}

/** Human page label for a page index (falls back to 1-based number). */
export function getPageLabel(
  reader: ReaderInstance,
  pageIndex: number,
): string {
  const label = getView(reader)?._pageLabels?.[pageIndex];
  return typeof label === "string" && label ? label : String(pageIndex + 1);
}

/**
 * The pdf.js page object for a page index — its `viewport` carries the
 * authoritative PDF↔viewport transform (crop boxes, rotation, zoom), the
 * same one the reader uses to render selections.
 */
function getPdfJsPage(reader: ReaderInstance, pageIndex: number): any | null {
  const view = getView(reader);
  const win = view?._iframeWindow;
  const app = (win?.wrappedJSObject ?? win)?.PDFViewerApplication;
  const page = app?.pdfViewer?._pages?.[pageIndex];
  return page ? Components.utils.waiveXrays(page) : null;
}

/**
 * The rendered-surface mapping for a page: the canvas's on-screen rect plus
 * the CSS-vs-viewport scale ratio. Zotero zooms pages via CSS variables that
 * can drift from the pdf.js viewport scale (it rerenders lazily), so all
 * PDF↔client conversion must normalize through the canvas's actual CSS size,
 * not trust viewport pixels as CSS pixels.
 */
function getSurface(
  reader: ReaderInstance,
  pageEl: Element,
  pageIndex: number,
): { viewport: any; box: DOMRect; fx: number; fy: number } | null {
  const page = getPdfJsPage(reader, pageIndex);
  const canvas = pageEl.querySelector("canvas") as HTMLCanvasElement | null;
  if (!page?.viewport || !canvas) return null;
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const fx = box.width / page.viewport.width;
  const fy = box.height / page.viewport.height;
  if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return { viewport: page.viewport, box, fx, fy };
}

/** Client coordinates → PDF-unit point (origin bottom-left); null on failure. */
export function clientToPdfPoint(
  reader: ReaderInstance,
  pageEl: Element,
  pageIndex: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  try {
    const s = getSurface(reader, pageEl, pageIndex);
    if (!s) return null;
    const [x, y] = s.viewport.convertToPdfPoint(
      (clientX - s.box.x) / s.fx,
      (clientY - s.box.y) / s.fy,
    );
    return { x, y };
  } catch (e) {
    logError(`clientToPdfPoint(p${pageIndex})`, e);
    return null;
  }
}

/** PDF-unit rect [x0, y0, x1, y1] → client-coordinate rect; null on failure. */
export function pdfRectToClientRect(
  reader: ReaderInstance,
  pageEl: Element,
  pageIndex: number,
  rect: [number, number, number, number],
): { left: number; top: number; width: number; height: number } | null {
  try {
    const s = getSurface(reader, pageEl, pageIndex);
    if (!s) return null;
    const [ax, ay] = s.viewport.convertToViewportPoint(rect[0], rect[1]);
    const [bx, by] = s.viewport.convertToViewportPoint(rect[2], rect[3]);
    return {
      left: s.box.x + Math.min(ax, bx) * s.fx,
      top: s.box.y + Math.min(ay, by) * s.fy,
      width: Math.abs(bx - ax) * s.fx,
      height: Math.abs(by - ay) * s.fy,
    };
  } catch (e) {
    logError(`pdfRectToClientRect(p${pageIndex})`, e);
    return null;
  }
}

/**
 * Crop a region of a rendered page to a PNG data URL. The rect is given in
 * client (CSS pixel) coordinates; conversion to canvas pixel coordinates
 * accounts for the canvas's internal resolution. When maxBytes is given and
 * the PNG exceeds it, the crop is re-rendered once at a reduced scale.
 */
export function cropPageRegion(
  reader: ReaderInstance,
  pageEl: Element,
  rect: { left: number; top: number; width: number; height: number },
  maxBytes?: number,
): string | null {
  try {
    const canvas = pageEl.querySelector("canvas") as HTMLCanvasElement | null;
    const doc = getReaderDocument(reader);
    if (!canvas || !doc) return null;
    const canvasBox = canvas.getBoundingClientRect();
    if (canvasBox.width <= 0 || canvasBox.height <= 0) {
      // Unlike getSurface's hover-path bail, a zero-size canvas at grab time
      // is anomalous — log so the "could not render region" notice is
      // diagnosable. Infinity/NaN scales would otherwise pass the sw/sh
      // minimum below and reach drawImage.
      logError("cropPageRegion", new Error("zero-size canvas box"));
      return null;
    }
    const scaleX = canvas.width / canvasBox.width;
    const scaleY = canvas.height / canvasBox.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null;
    const sx = (rect.left - canvasBox.left) * scaleX;
    const sy = (rect.top - canvasBox.top) * scaleY;
    const sw = rect.width * scaleX;
    const sh = rect.height * scaleY;
    if (sw < 4 || sh < 4) return null;

    const render = (outScale: number): string => {
      const out = doc.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * outScale));
      out.height = Math.max(1, Math.round(sh * outScale));
      const ctx = out.getContext("2d") as unknown as CanvasRenderingContext2D;
      ctx.drawImage(
        canvas,
        Math.round(sx),
        Math.round(sy),
        Math.round(sw),
        Math.round(sh),
        0,
        0,
        out.width,
        out.height,
      );
      return out.toDataURL("image/png");
    };

    let png = render(1);
    if (maxBytes) {
      const bytes = dataUrlBytes(png);
      if (bytes > maxBytes) {
        // Area scales with the square of the linear scale; undershoot a bit
        const scale = Math.sqrt(maxBytes / bytes) * 0.95;
        png = render(scale);
      }
    }
    return png;
  } catch (e) {
    logError("cropPageRegion", e);
    return null;
  }
}

/** Approximate decoded byte size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}
