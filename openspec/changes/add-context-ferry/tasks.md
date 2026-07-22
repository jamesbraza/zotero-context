# Tasks: add-context-ferry

## 1. De-risking spikes (throwaway code, findings recorded in design.md)

- [x] 1.1 S2: In a dev build, verify reader-internals access paths on current Zotero (9.0.6): `chars`/`getPageData` per page, `getOutline()` (needs `waiveXrays`), page canvas access, shipped sentence segments via `_initReadAloudSegments()`; findings recorded in design.md
- [x] 1.2 S1: Test mixed text+image single paste into claude.ai via an HTML clipboard flavor with embedded data-URI images — FAILED (text ingested, images dropped); bundle strategy = text bundle + sequential images, MCP for true batching
- [x] 1.3 S3: Test `ClipboardHelper.addFile(pdfPath)` + paste into claude.ai on Windows — WORKS (full PDF attaches); paper-intro flow can automate PDF delivery

## 2. Foundations

- [ ] 2.1 Add dependencies: `sentencex-ts`, `@modelcontextprotocol/sdk`; confirm both bundle in the Zotero plugin build
- [x] 2.2 Create three-layer module structure (`src/core/`, `src/adapter/`, `src/modules/` shell) with lint rule/convention barring Zotero imports in core and internals access outside the adapter
- [x] 2.3 Implement reader adapter: page chars/text access, outline access, page-region-to-PNG rendering, overlay mount/unmount — with graceful failure results (no throws to callers)
- [x] 2.4 Define core grab model and trail (append-only log, multi-paper sources, first-grab-per-paper tracking)

## 3. Grab mode

- [ ] 3.1 Toolbar button + hotkey registration with prefs: hotkey binding and toggle vs. press-and-hold semantics
- [x] 3.2 Mode state machine with visible indication (button state, cursor) and clean teardown of overlays/listeners on exit and Escape

## 4. Area grab + provenance + clipboard floor (first usable build)

- [x] 4.1 Two-click capture interaction: corner anchor, cursor-tracking preview rectangle, Escape cancel
- [x] 4.2 Region-to-PNG rendering via adapter (annotation-pipeline fallback only if canvas path fails S2); verify no annotations/library traces
- [x] 4.3 Provenance builder: full citation via Zotero citation infra on first grab per paper per session; compact `§, p.` locator after; outline→section mapping with page-only fallback
- [x] 4.4 Clipboard floor: per-grab immediate copy (text grabs as header+quote; image grabs as native image + header text flavor) via ClipboardHelper
- [x] 4.5 Manual end-to-end check: read a real paper, grab a figure and a formula, paste both into claude.ai with correct headers

## 5. Sentence-snap text grab

- [x] 5.1 Text segments via the adapter calling Zotero 9's shipped `_initReadAloudSegments()` (superseded porting sdt-segments/sentencex-ts, which remains the fallback if the private API churns); cached per reader
- [x] 5.2 Hover hit-testing + sentence glow overlay; no-text-layer pages degrade silently
- [x] 5.3 Click-to-grab and shift-click range extension in reading order
- [ ] 5.4 Manual check on a two-column and a math-heavy paper; note segmentation quality issues

## 6. Trail delivery

- [x] 6.1 Session-bundle copy action implementing the one-action invariant with the S1-chosen composition (mixed HTML or text+sequential-images fallback, degradation surfaced to user)
- [ ] 6.2 Rendering profiles: rich paste vs. file-path-on-disk (write grab images to a stable directory, reference paths in text); profile pref
- [x] 6.3 Paper-intro action: citation + abstract + "PDF attached" blurb; include PDF file on
      clipboard where S3 proved support

## 7. MCP server

- [ ] 7.1 Grab-event hub: internal event bus core emits grab/trail events onto, with a consumer interface (MCP now, WebSocket push in v0.2)
- [ ] 7.2 In-process Streamable HTTP MCP server lifecycle as the first hub consumer: start on plugin load, configurable port, graceful disable on bind failure, clean shutdown
- [ ] 7.3 Tools: `list_grabs`, `get_grab` (base64 images), `get_paper`, `fetch_pdf` (base64 and/or path per profile); trail-based identity, no focused-tab pointer
- [ ] 7.4 Verify end-to-end with Claude desktop and Claude Code: connect, pull grabs, fetch PDF; write client-setup recipes into README

## 8. Quality and release

- [ ] 8.1 Unit tests for core (segmentation edge cases, trail/first-grab logic, provenance
      fallback) via `zotero-plugin test`
- [ ] 8.2 Adapter smoke tests against current Zotero in CI so internals churn is caught on Zotero updates
- [ ] 8.3 README/docs: grab-mode usage, prefs, MCP setup, known limitations (element-picking and persistence deferred)
- [ ] 8.4 Tag v0.1.0 release via CI release flow
