import { assert } from "chai";
import {
  cropPageRegion,
  getOutlineEntries,
  getPageAt,
  getPageChars,
  getReaderDocument,
  segmentApiAbsent,
  segmentDiagnostics,
} from "../src/adapter/reader";
import { getSegmentsCached } from "../src/modules/segment-cache";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

/**
 * Adapter smoke tests (openspec add-context-ferry task 8.2): exercise every
 * reader-internals surface the adapter depends on — per-page chars, the Read
 * Aloud segment machinery, outline resolution, and page-canvas cropping —
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
      // Real-world data point for the transient window (~1-3.6s on 9.0.6);
      // convergence below proves the early null did not stick in the cache
      Zotero.debug("[smoke] early segments call raced init and returned null");
    }
    const segments = await until(() => getSegmentsCached(reader), CONVERGE_MS);
    assert.isArray(
      segments,
      `segments available once reader settles (${segmentDiagnostics(reader)})`,
    );
    assert.isFalse(segmentApiAbsent(reader), "Read Aloud API exposed");
    assert.isAbove(segments!.length, 0);
    const s = segments![0];
    assert.isString(s.text);
    assert.isNumber(s.position.pageIndex);
    assert.isArray(s.position.rects);
    assert.isNumber(s.offsetStart);
    assert.isNumber(s.offsetEnd);
    // The underlying API is one-shot on 9.0.6 (repeat _initReadAloudSegments
    // calls yield nothing) — the module cache must keep returning the first
    // success for the reader's lifetime
    assert.equal(await getSegmentsCached(reader), segments);
  });

  it("per-page chars expose cloned geometry", async function () {
    this.timeout(CONVERGE_MS + 5_000);
    const chars = await until(() => getPageChars(reader, 0), CONVERGE_MS);
    assert.isArray(chars, "page 0 chars available after render");
    assert.isAbove(chars!.length, 0);
    const c = chars![0];
    assert.isString(c.c);
    assert.isString(c.u);
    assert.lengthOf(c.inlineRect, 4);
    for (const v of c.inlineRect) assert.isNumber(v);
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
