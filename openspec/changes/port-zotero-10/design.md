# Design: port-zotero-10

## Context

Zotero 10.0.x (Firefox 140 ESR, pdf.js 5.7) replaced the per-view Read Aloud segment builder with a
reader-level SDT pipeline (zotero/reader commit `53441e2f`, "Use SDT for Read Aloud and Reading Mode").
On desktop, Zotero exposes no callable segment builder: `buildSDTReadAloudSegments` is bundle-internal,
`getReadAloudSegments` exists only in the mobile `src/common/view.js` class (tree-shaken from desktop),
and `_internalReader._requestReadAloudSegments()` returns early unless Read Aloud is playing.

## Spike S3 findings (2026-11-15, Zotero 10.0.8, arXiv 1706.03762 fixture, local WSL)

- `Zotero.SDT` = `{getPack, ensure, getReader}` (chrome-side; undocumented but not underscored).
  First `ensure()` (pack generation by the ONNX document worker) took 0.9 s for 15 pages; cached after.
  `getReader(id)` → pack reader with `getMetadata/getCatalog/getBlock(s)/getPageBlocks/materialize`
  (`materialize()` 11 ms).
- Reader side: `_internalReader._loadSDT()` → `{structure, mapper}`, callable from chrome with
  `waiveXrays` on the result and `cloneInto(range, readerWindow)` for mapper arguments. It resolves only
  after generation finishes, caches success, and clears its promise on failure.
- `mapper.sdtToSourcePosition({start, end})` → `{pageIndex, rects, nextPageRects?}`: PDF units (same
  space as pdf.js chars `inlineRect`), one merged rect per visual line; sub-ranges map exactly.
  `sourceToSDTPosition` round-trips a point to `[block, node, offset]`.
- Structure (schema 1.2.0): 142 blocks — 88 paragraph, 25 heading, 9 caption, 6 math, 5 table, 5 list,
  4 image; 19 `excluded` + 28 `auxiliary` flow; 8 blocks in part chains. Outline items carry block refs
  (`ref: [blockIndex]`); this paper's bookmark titles carry no section numbers. Image blocks are
  immediately followed by their caption blocks. The title/author block is classified `table` (flagged
  non-body flow) — element picking must respect `flowClass`.
- `_primaryView._pdfRenderer.renderRegionCrops(pageIndex, rects)` → PNG data URLs (37 ms, 234 KB for a
  figure-sized region), rendered offscreen from pdf.js independent of zoom.
- Not yet verified: scanned/OCR PDFs (SDT marks pages `textSource: "ocr"`), very large documents.

## Decisions

### D1: Sentences from SDT, split in the plugin

Walk SDT leaf blocks (nodes containing text nodes) in document order, pruning `excluded` flow (running
headers/footers/page numbers) and `image` blocks, keeping `auxiliary` flow (captions, footnotes). Join
part chains (`previousPart`/`nextPart`) — a hyphen ending a part that continues lowercase is a line-break
hyphen and is dropped — split each chain's text with `sentencex-ts`, then cut each sentence back into one
SDT range per part (parts need not be adjacent in content order, so one range spanning them would sweep
in interleaved blocks). Lives in `src/core/sdt-sentences.ts`, Zotero-free.

Alternatives: porting Zotero 10's `sdt-segments.ts` (AGPL) would drag in helpers from the unlicensed SDT
repo; rebuilding Zotero 9's char-flag paragraphs would forgo the layout model's reading order and
header/footer exclusion. If Zotero exposes `getReadAloudSegments` on desktop, switch to it.

### D2: Map every sentence once per reader

The adapter maps all sentences at load (as Zotero's Read Aloud does) and the segment cache indexes them
per page; a sentence crossing a page break is a target on each page it touches, carrying its full text.

### D3: Unavailability is final per reader session

Because `_loadSDT()` resolves only after generation, a completed load with no usable sentences
(password-protected, failed extraction, no text) is cached as unavailable: the hover gate closes and area
grab keeps working, instead of every hover/click re-triggering extraction while clicks are swallowed as
"pending". Reopening the reader retries.

## Risks / Trade-offs

- [Private access paths (`_loadSDT`, mapper, `_pdfRenderer`)] → confined to the adapter, feature-detected,
  degrade + log; release CI plus a non-blocking beta lane catch churn early.
- [First-open latency: text snap waits for pack generation] → warm-up at reader open (existing); area
  grab is unaffected. Large documents not yet measured.
- [Layout-model misclassification] → only `excluded` flow is pruned from text snap.
