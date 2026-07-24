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

- [x] 7.1 Minimal grab hub: thin subscription point (`onGrab`/`onTrailChange`) on the existing trail in core — no pub/sub infra or event replay (v0.2's WebSocket consumer shapes event payloads when it arrives); MCP holds a trail reference and does not subscribe
- [x] 7.2 Server lifecycle (off by default): platform httpd.js HTTP layer + SDK `McpServer` via a custom `Transport` (stateless JSON-per-POST, no SSE); add `@modelcontextprotocol/sdk` dependency; 127.0.0.1 bind and Host validation via httpd.js (smoke-tested), Origin validation ours, default port 23122, bearer token minted on first enablement into a Zotero pref; prefs pane with enable toggle, port field, live status line, and copy-ready setup artifacts (`claude mcp add` command + cross-client `mcpServers` JSON + raw token); graceful disable on bind failure, clean shutdown
- [x] 7.3 Tools: `list_grabs` (asymmetric: text inline with provenance, image stubs; `paper` + `since`-watermark filters, watermark in every response), `get_grab` (images as MCP image content blocks), `get_paper`, `fetch_pdf(paper_id)` returning local path + size (base64 mode cut in simplification pass — see design D7); trail-scoped identity, no focused-tab pointer; unit tests for auth/origin rejection, watermark filtering incl. across-clear monotonicity, stub/inline split, error-id echo
- [ ] 7.4 Verify end-to-end with Claude Code (primary) and Claude desktop: enable server, connect via minted-token snippet, pull grabs, fetch PDF by path, exercise the watermark delta loop; port-conflict graceful-disable check

## 8. Quality and release

- [x] 8.0 Code-review rounds (four-perspective review + Copilot ×2): bug fixes, the degrade+log
      error contract, dead-subsystem cleanup, and four spec clauses amended to shipped v0.1
      behavior — details in branch history. MCP round (2026-07-24): 10 findings fixed
      (monotonic watermark, token-mint crash path, standalone-PDF guard, guarded prefs-pane
      actions, JSON-RPC id echo, timer hygiene) plus a perf/simplification pass (fetch_pdf
      base64 mode cut)
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
- [ ] 9.2 README: expanded "MCP server" section written from verified 7.4 steps — purpose/pull-model
      prose, mermaid architecture flowchart (both delivery paths meeting at the trail) and pull-loop
      sequence diagram, two-step setup recipes (enable in prefs, then Claude Code `claude mcp add` /
      cross-client `mcpServers` config JSON), token recovery, port-conflict troubleshooting via the status line,
      security posture as deliberate properties, claude.ai localhost limitation, Windows-Zotero +
      WSL-Claude-Code path caveat
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
