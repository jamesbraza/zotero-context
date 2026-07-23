# Tasks: add-context-ferry

## 1. De-risking spikes (throwaway code, findings recorded in design.md)

- [x] 1.1 S2: In a dev build, verify reader-internals access paths on current Zotero (9.0.6): `chars`/`getPageData` per page, `getOutline()` (needs `waiveXrays`), page canvas access, shipped sentence segments via `_initReadAloudSegments()`; findings recorded in design.md
- [x] 1.2 S1: Test mixed text+image single paste into claude.ai via an HTML clipboard flavor with embedded data-URI images — FAILED (text ingested, images dropped); bundle strategy = text bundle + sequential images, MCP for true batching
- [x] 1.3 S3: Test `ClipboardHelper.addFile(pdfPath)` + paste into claude.ai on Windows — WORKS (full PDF attaches); paper-intro flow can automate PDF delivery

## 2. Foundations

- [x] 2.1 Dependencies: `sentencex-ts` superseded (Zotero 9's shipped segments + `Intl.Segmenter` cover it);
      `@modelcontextprotocol/sdk` moves to task 7.2 where it's first needed
- [x] 2.2 Create three-layer module structure (`src/core/`, `src/adapter/`, `src/modules/` shell) with lint rule/convention barring Zotero imports in core and internals access outside the adapter
- [x] 2.3 Implement reader adapter: page chars/text access, outline access, page-region-to-PNG rendering, overlay mount/unmount — with graceful failure results (no throws to callers)
- [x] 2.4 Define core grab model and trail (append-only log, multi-paper sources, first-grab-per-paper tracking)

## 3. Grab mode

- [x] 3.1 Toolbar button + hotkey registration shipped (toggle semantics); press-and-hold pref
      deferred to backlog 10.2
- [x] 3.2 Mode state machine with visible indication (button state, cursor) and clean teardown of overlays/listeners on exit and Escape

## 4. Area grab + provenance + clipboard floor (first usable build)

- [x] 4.1 Two-click capture interaction: corner anchor, cursor-tracking preview rectangle, Escape cancel
- [x] 4.2 Region-to-PNG rendering via adapter (annotation-pipeline fallback was unnecessary; canvas
      path works). Ephemerality holds by construction: no annotation/save APIs are called anywhere,
      enforced by an eslint `no-restricted-syntax` guard over `src/`
- [x] 4.3 Provenance builder: full citation from item metadata on first grab per paper per session;
      compact `§, p.` locator after; outline→section mapping with page-only fallback
- [x] 4.4 Clipboard floor: per-grab immediate copy (text grabs as header+quote; image grabs as native image + header text flavor) via ClipboardHelper
- [x] 4.5 Manual end-to-end check: read a real paper, grab a figure and a formula, paste both into claude.ai with correct headers

## 5. Sentence-snap text grab

- [x] 5.1 Text segments via the adapter calling Zotero 9's shipped `_initReadAloudSegments()` (superseded porting sdt-segments/sentencex-ts, which remains the fallback if the private API churns); cached per reader
- [x] 5.2 Hover hit-testing + sentence glow overlay; no-text-layer pages degrade silently
- [x] 5.3 Click-to-grab and shift-click range extension in reading order
- [x] 5.4 Manual check on a two-column (GoBI) and math-heavy (Attention) paper — exposed and fixed the
      sentence-geometry drift (ligatures/dehyphenation); scans fall back to line targets as designed

## 6. Trail delivery

- [x] 6.1 Session-bundle copy action implementing the one-action invariant with the S1-chosen
      composition (text bundle + sequential image copies, multi-step delivery surfaced to user)
- [ ] 6.2 Rendering profiles: rich paste vs. file-path-on-disk (write grab images to a stable directory, reference paths in text); profile pref
- [x] 6.3 Paper-intro action: citation + abstract + "PDF attached" blurb; include PDF file on
      clipboard where S3 proved support

## 7. MCP server

- [ ] 7.1 Grab-event hub: internal event bus core emits grab/trail events onto, with a consumer interface (MCP now, WebSocket push in v0.2)
- [ ] 7.2 In-process Streamable HTTP MCP server lifecycle as the first hub consumer: start on plugin load, configurable port, graceful disable on bind failure, clean shutdown
- [ ] 7.3 Tools: `list_grabs`, `get_grab` (base64 images), `get_paper`, `fetch_pdf` (base64 and/or path per profile); trail-based identity, no focused-tab pointer
- [ ] 7.4 Verify end-to-end with Claude desktop and Claude Code: connect, pull grabs, fetch PDF; write client-setup recipes into README

## 8. Quality and release

- [x] 8.0 Code-review rounds (four-perspective review + Copilot ×2): bug fixes, the degrade+log
      error contract, dead-subsystem cleanup, and four spec clauses amended to shipped v0.1
      behavior — details in branch history
- [x] 8.1 Unit tests for core (test/core.test.ts): trail watermarks/first-per-paper, provenance
      formats, bundle ordering, sentence alignment incl. the balanced ligature/hyphen drift
      regression, snap-target hit-testing/range joins, caption-strip wrapping, and segment-cache
      transient-vs-absent semantics
- [x] 8.2 Formalize the diagnostic spikes into committed adapter smoke tests
      (test/adapter-smoke.test.ts: arXiv fixture imported on demand, chars/segments/outline/
      canvas-crop surfaces + early-race segment convergence) so reader-internals churn is caught
      in CI on Zotero updates
- [ ] 8.3 Tag v0.1.0 release via CI release flow (after groups 7 and 9)

## 9. Documentation

- [x] 9.1 Populate README.md: pitch, install, usage guide + hotkey table, provenance examples,
      grab-button and caption-strip SVG figures (real screenshots can replace the SVGs later)
- [ ] 9.2 README: MCP client setup recipes (Claude desktop config JSON, Claude Code `claude mcp add`),
      written as part of task 7.4 verification
- [x] 9.3 README: known limitations and roadmap pointers (element-picking deferred, scans use
      line-level snap, browser-extension sibling planned; link openspec change for details)
- [x] 9.4 CONTRIBUTING.md: dev-loop notes (Linux Zotero under WSLg, `.env` setup, Windows XPI
      sanity checks, testing caveats)

## 10. Backlog (unscheduled, post-v0.1)

- [ ] 10.1 Manual granularity toggle (sentence/line/paragraph cycle hotkey + default pref)
- [ ] 10.2 Press-and-hold hotkey semantics pref (deferred from 3.1)
- [ ] 10.3 Session-recap paste size guardrails (warn when bundle text exceeds chat input limits)
- [ ] 10.4 Zotero 10 segments port: 10.0-beta removes `_initReadAloudSegments` for an SDT
      pipeline (`_loadSDT()` + `buildSDTReadAloudSegments`, source-position geometry — caught
      by the 8.2 smoke suite on beta CI, 2026-07-23); add an adapter path (or the sdt-segments
      port design.md names as fallback) before Zotero 10 ships, and consider a non-blocking
      beta CI lane for early churn warning
