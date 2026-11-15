/**
 * Reader adapter — the ONLY module allowed to touch Zotero reader private
 * internals (`_internalReader`, `_primaryView`, pdf.js). Everything here may
 * break between Zotero releases. Error contract (degrade + log): expected
 * absences (API missing, page not rendered) are detected by explicit
 * presence checks and return null quietly so callers degrade per the specs;
 * genuine throws are logged via logError and then degrade — never silenced.
 *
 * Access paths verified on Zotero 10.0.8 (spike S3, 2026-11-15 — see
 * openspec/changes/port-zotero-10/design.md).
 */
import { sdtSentenceRanges, type SDTStructure } from "../core/sdt-sentences";
import { logError } from "../utils/log";

declare const Components: any;

/** A PDF-unit rect [x0, y0, x1, y1] (origin bottom-left). */
type PdfRect = [number, number, number, number];

/** A sentence mapped onto page geometry; spans >1 page at part/page breaks. */
export interface ReaderSentence {
  text: string;
  pages: { pageIndex: number; rects: PdfRect[] }[];
}

type ReaderInstance = _ZoteroTypes.ReaderInstance;

/** The reader's content-side Reader object (zotero/reader `Reader`). */
function getInternalReader(reader: ReaderInstance): any | null {
  return (reader as any)._internalReader ?? null;
}

function getView(reader: ReaderInstance): any | null {
  return getInternalReader(reader)?._primaryView ?? null;
}

/**
 * Resolves once the reader's primary view is fully initialized: pdf document
 * loaded, page count known, initial navigation done. The view resolves
 * `initializedPromise` at the end of its `_init()`, and Zotero core itself
 * awaits this same promise (so it breaking would break Zotero first).
 * Returns false when the chain is absent (version churn) — callers degrade
 * to on-activation warming.
 *
 * NEVER await `_internalReader.initializedPromise` instead: that promise is
 * created but never resolved (zotero/reader#171), so awaiting it hangs
 * forever.
 */
export async function waitForViewInitialized(
  reader: ReaderInstance,
): Promise<boolean> {
  try {
    await reader._initPromise;
    const initialized: unknown = getView(reader)?.initializedPromise;
    if (
      typeof (initialized as { then?: unknown } | undefined)?.then !==
      "function"
    ) {
      return false;
    }
    await initialized;
    return true;
  } catch (e) {
    logError("waitForViewInitialized", e);
    return false;
  }
}

/** Readers whose SDT load completed without usable sentences. */
const sdtUnavailable = new WeakSet<object>();

/**
 * Whether sentence segments are *permanently* unavailable for this reader:
 * its Reader lacks the SDT loader (Zotero version churn), or an SDT load
 * already completed without usable sentences (password-protected or failed
 * extraction, or a document with no text). `_loadSDT()` only resolves after
 * pack generation finishes, so such a result is final for the reader's
 * lifetime — retrying would just re-run extraction (reopen to retry). A
 * missing view is NOT unavailability — the view appears shortly after
 * Reader.open resolves, so callers must treat that as transient and retry.
 */
export function segmentsUnavailable(reader: ReaderInstance): boolean {
  if (!getView(reader)) return false;
  return (
    typeof getInternalReader(reader)?._loadSDT !== "function" ||
    sdtUnavailable.has(reader)
  );
}

function addRects(
  byPage: Map<number, PdfRect[]>,
  pageIndex: unknown,
  rects: unknown,
): void {
  if (!Number.isInteger(pageIndex) || !Array.isArray(rects)) return;
  let list = byPage.get(pageIndex as number);
  if (!list) {
    list = [];
    byPage.set(pageIndex as number, list);
  }
  for (const r of rects as PdfRect[]) list.push([r[0], r[1], r[2], r[3]]);
}

/**
 * Sentence segments from Zotero 10's Structured Document Text: the reader's
 * own SDT load (`_loadSDT()` → {structure, mapper}, the layer Read Aloud and
 * Reading Mode use), split into sentences by core/sdt-sentences, then mapped
 * to page rects by the reader's position mapper. Returns null when the view
 * is not up yet or the attempt throws (logged) — both transient — or when
 * the document has no usable SDT, which segmentsUnavailable then reports as
 * final.
 *
 * `_loadSDT` resolves a content-compartment object: waive Xrays to read it,
 * clone the structure into plain privileged data for the core, and clone
 * each range into the reader window before handing it to the mapper.
 */
export async function getSegments(
  reader: ReaderInstance,
): Promise<ReaderSentence[] | null> {
  const ir = getInternalReader(reader);
  const win = getView(reader)?._iframeWindow;
  if (typeof ir?._loadSDT !== "function" || !win) return null;
  try {
    const loaded: unknown = await ir._loadSDT();
    const sdt = loaded ? Components.utils.waiveXrays(loaded) : null;
    const mapper = sdt?.mapper;
    if (typeof mapper?.sdtToSourcePosition !== "function") {
      sdtUnavailable.add(reader);
      return null;
    }
    const structure = JSON.parse(JSON.stringify(sdt.structure)) as SDTStructure;
    const sentences: ReaderSentence[] = [];
    for (const s of sdtSentenceRanges(structure)) {
      const byPage = new Map<number, PdfRect[]>();
      for (const part of s.parts) {
        const pos = mapper.sdtToSourcePosition(
          Components.utils.cloneInto(part, win),
        );
        const pageIndex: unknown = pos?.pageIndex;
        if (typeof pageIndex !== "number") continue;
        addRects(byPage, pageIndex, pos.rects);
        // The mapper reports a page-crossing range's continuation separately
        if (pos.nextPageRects) {
          addRects(byPage, pageIndex + 1, pos.nextPageRects);
        }
      }
      if (!byPage.size) continue;
      sentences.push({
        text: s.text,
        pages: [...byPage.entries()]
          .sort(([a], [b]) => a - b)
          .map(([pageIndex, rects]) => ({ pageIndex, rects })),
      });
    }
    if (!sentences.length) {
      sdtUnavailable.add(reader);
      return null;
    }
    return sentences;
  } catch (e) {
    logError("getSegments", e);
    return null;
  }
}

/**
 * One-line snapshot of the SDT machinery's state, for adapter smoke tests:
 * when reader-internals churn breaks segments in CI, the failing assertion
 * carries the why.
 */
export function segmentDiagnostics(reader: ReaderInstance): string {
  try {
    const ir = getInternalReader(reader);
    if (!getView(reader)) return "no view";
    return [
      `loadSDT=${typeof ir?._loadSDT}`,
      `numPages=${String(getWaivedPdfDocument(reader)?.numPages ?? "n/a")}`,
      `sdt=${ir?._sdt ? "loaded" : ir?._sdtPromise ? "pending" : "none"}`,
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
      const walk = (nodes: any[] | undefined) => {
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
          const destName = explicit[1]?.name;
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
    const pageEl = el?.closest(".page");
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

/** Zero-based index of the page currently shown in the viewer, or null when
 * the viewer is not up yet (callers skip their page-scoped warm work). */
export function getVisiblePageIndex(reader: ReaderInstance): number | null {
  try {
    const view = getView(reader);
    const win = view?._iframeWindow;
    const app = (win?.wrappedJSObject ?? win)?.PDFViewerApplication;
    const num: unknown = app?.pdfViewer?.currentPageNumber;
    return typeof num === "number" && Number.isInteger(num) && num >= 1
      ? num - 1
      : null;
  } catch (e) {
    logError("getVisiblePageIndex", e);
    return null;
  }
}

/** Readers currently open, from the private registry (empty array on shape
 * change — callers just skip their sweep). */
export function getOpenReaders(): ReaderInstance[] {
  try {
    const readers: unknown = (Zotero.Reader as any)._readers;
    return Array.isArray(readers) ? [...(readers as ReaderInstance[])] : [];
  } catch (e) {
    logError("getOpenReaders", e);
    return [];
  }
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
  const canvas = pageEl.querySelector("canvas");
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
    const canvas = pageEl.querySelector("canvas");
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

/** Base64 payload of a data URL, or null when there is none. */
export function dataUrlBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || comma === dataUrl.length - 1) return null;
  return dataUrl.slice(comma + 1);
}
