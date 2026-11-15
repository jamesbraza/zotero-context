import { assert } from "chai";
import {
  cropPageRegion,
  getOutlineEntries,
  getPageAt,
  getReaderDocument,
  segmentsUnavailable,
  segmentDiagnostics,
  waitForViewInitialized,
} from "../src/adapter/reader";
import { getSegmentsCached, warmSegments } from "../src/modules/segment-cache";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

/**
 * Adapter smoke tests (openspec add-context-ferry tasks 8.2 and 10.4):
 * exercise every reader-internals surface the adapter depends on — the SDT
 * load + position mapper behind sentence segments,
 * outline resolution, and page-canvas cropping —
 * against a real reader, so churn in Zotero's private APIs is caught in CI
 * on Zotero updates. Formalizes the S2 diagnostic spike (see design.md).
 *
 * Fixture: arXiv "Attention Is All You Need" (hyperref-built, embeds a PDF
 * outline), fetched on demand into the test library and erased afterwards —
 * no local fixture paths.
 */
const FIXTURE_URL = "https://arxiv.org/pdf/1706.03762";
const CONVERGE_MS = 30_000;

/** Poll fn until it returns a truthy value or the timeout elapses. */
async function until<T>(
  fn: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T | null | undefined> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!last && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

describe("adapter smoke (live reader)", function () {
  let attachment: Zotero.Item;
  let reader: ReaderInstance;
  /** Segments result from the racing call made right after open. */
  let earlySegments: unknown;

  before(async function () {
    this.timeout(120_000);
    attachment = await Zotero.Attachments.importFromURL({
      url: FIXTURE_URL,
      libraryID: Zotero.Libraries.userLibraryID,
      contentType: "application/pdf",
    });
    const opened = await Zotero.Reader.open(attachment.id);
    const found =
      opened ??
      (
        Zotero.Reader as unknown as { _readers: ReaderInstance[] }
      )._readers.find((r) => r.itemID === attachment.id);
    assert.ok(found, "reader opened for fixture attachment");
    reader = found!;
    // Race the reader's init on purpose: this is the transient window the
    // segment cache must not poison (segment-cache.ts / grab-mode fix)
    earlySegments = await getSegmentsCached(reader);
  });

  after(async function () {
    this.timeout(30_000);
    // Guards: if before() failed part-way these are unassigned at runtime,
    // even though their declared types say otherwise
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (reader) reader.close();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (attachment) await attachment.eraseTx();
  });

  it("segment machinery is present and segments converge after an early race", async function () {
    this.timeout(CONVERGE_MS + 5_000);
    if (earlySegments === null) {
      // Real-world data point for the transient window (view creation + SDT
      // pack generation on first open); convergence below proves the early
      // null did not stick in the cache
      Zotero.debug("[smoke] early segments call raced init and returned null");
    }
    const segments = await until(() => getSegmentsCached(reader), CONVERGE_MS);
    assert.isArray(
      segments,
      `segments available once reader settles (${segmentDiagnostics(reader)})`,
    );
    assert.isFalse(segmentsUnavailable(reader), "SDT loader exposed");
    // A 15-page paper: hundreds of sentences, on most pages
    assert.isAbove(segments!.length, 100);
    const pages = new Set(
      segments!.flatMap((s) => s.pages.map((p) => p.pageIndex)),
    );
    assert.isAbove(pages.size, 10, "sentences span the document");
    // Running headers/footers are excluded flow: the arXiv stamp in the
    // margin never becomes a snap target
    assert.notOk(
      segments!.some((s) => /^arXiv:\d{4}\.\d+/.test(s.text)),
      "arXiv margin stamp is not a sentence",
    );
    const s = segments!.find((x) =>
      x.text.startsWith("The dominant sequence transduction models"),
    );
    assert.ok(s, "abstract's first sentence is segmented whole");
    assert.equal(s.pages[0].pageIndex, 0);
    // PDF-unit line rects inside the US-letter page box
    for (const [x0, y0, x1, y1] of s.pages[0].rects) {
      assert.isTrue(0 <= x0 && x0 < x1 && x1 <= 612, `x in page: ${x0},${x1}`);
      assert.isTrue(0 <= y0 && y0 < y1 && y1 <= 792, `y in page: ${y0},${y1}`);
    }
    // The module cache keeps returning the first success for the reader's
    // lifetime
    assert.equal(await getSegmentsCached(reader), segments);
  });

  it("view readiness chain resolves; warm-up fills the shared cache", async function () {
    this.timeout(CONVERGE_MS + 5_000);
    // The promise chain (reader._initPromise → view.initializedPromise) is
    // the warm-up trigger — churn here silently disables warming, so pin it
    const ready = await waitForViewInitialized(reader);
    assert.isTrue(ready, `view initialized (${segmentDiagnostics(reader)})`);
    const warmed = await warmSegments(reader);
    assert.isArray(
      warmed,
      `warm-up yields segments (${segmentDiagnostics(reader)})`,
    );
    // Warm-up and the activation path share one cache entry
    assert.equal(await getSegmentsCached(reader), warmed);
  });

  it("outline entries resolve with page indices", async function () {
    this.timeout(CONVERGE_MS + 5_000);
    const entries = await until(() => getOutlineEntries(reader), CONVERGE_MS);
    assert.isArray(entries, "fixture embeds an outline");
    assert.isAbove(entries!.length, 0);
    const e = entries![0];
    assert.isString(e.title);
    assert.isTrue(Number.isInteger(e.pageIndex));
    assert.ok(e.y === null || typeof e.y === "number");
  });

  it("page canvas renders, hit-tests, and crops to a PNG", async function () {
    this.timeout(CONVERGE_MS + 5_000);
    const canvas = await until(
      () =>
        getReaderDocument(reader)?.querySelector<HTMLCanvasElement>(
          ".page canvas",
        ),
      CONVERGE_MS,
    );
    assert.ok(canvas, "a page canvas rendered");
    const pageEl = canvas.closest(".page");
    assert.ok(pageEl, "canvas sits inside a page element");
    const box = canvas.getBoundingClientRect();
    const hit = getPageAt(reader, box.left + box.width / 2, box.top + 20);
    assert.ok(hit, "page hit-test resolves at canvas center");
    const png = cropPageRegion(reader, pageEl, {
      left: box.left + 10,
      top: box.top + 10,
      width: 80,
      height: 60,
    });
    assert.match(png ?? "", /^data:image\/png/, "crop yields a PNG data URL");
  });
});
