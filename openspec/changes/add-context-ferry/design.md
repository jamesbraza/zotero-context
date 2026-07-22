# Design: add-context-ferry

## Context

Zotero 7 plugin (`zotero-plugin-scaffold` + `zotero-plugin-toolkit`, TypeScript). Zotero's reader is its own viewer built on a forked pdf.js (repo: `zotero/reader`), embedded in an iframe. Official plugin surface is small (`Zotero.Reader.registerEventListener` for popups/menus); everything richer goes through unofficial internals (`reader._internalReader`, `_primaryView`, pdf.js `PDFViewerApplication`), which churn between releases (zotero/zotero#3373 tracks better APIs).

Research established (see exploration session, 2026-07-21):

- Zotero's reader already ships per-character geometry (`chars` arrays with rects and word/line-break flags via `getPageData`) and word/line snap-selection utilities (`src/pdf/selection.js`: `getClosestOffset`, `getRectsFromChars`, `getSelectionRanges`).
- Zotero 9 (not 7) ships sentence infrastructure: `sdt-segments.ts` (segmentation via `sentencex-ts`, handling hyphenation/citation markers) and `pdf-position-mapper.ts` (sentence span → pageIndex + rects). AGPL, portable into this AGPL plugin.
- `zotero-plugin-toolkit` `ClipboardHelper` supports `addText`, `addImage(dataURL)`, `addFile(path)`.
- No existing MCP server exposes live reader state; `cookjohn/zotero-mcp` proves an MCP server can run in-process inside a Zotero plugin on a local HTTP port.
- claude.ai/desktop accept pasted images (PNG/JPEG, 5MB); mixed text+image single paste and clipboard
  _file_ paste are unverified.

**Spike S2 findings (2026-07-21, Zotero 9.0.6, resolved — see test/spike-internals.test.ts):**

- **Current Zotero stable is 9.0.6**, not 7.x. Dev loop: Linux Zotero tarball under WSLg (`.env` points at `~/.local/opt/Zotero_linux-x86_64`; requires `libasound2t64` + `libdbus-glib-1-2`).
- `reader._internalReader._primaryView` reachable; pdf.js (`PDFViewerApplication`) lives directly in the reader iframe (no nested iframe on 9.0.6).
- **Sentence segments are shipped and callable**: `view._initReadAloudSegments()` returns segments `{anchor, text, position: {pageIndex, rects}, granularity, offsetStart, offsetEnd}` (212 for a 15-page paper), cached on `view._readAloudSegments`. D2 therefore becomes: _call this machinery via the adapter, filter by granularity_; porting sdt-segments/sentencex-ts is the fallback if the private API churns. `sentencex-ts` dependency deferred until needed.
- Per-char geometry confirmed: `view._pdfPages[pageIndex].chars` with `{c, u, rect, inlineRect, fontSize, fontName, bold, italic, baseline, offset, pageIndex, ...}` — the fallback path and hit-testing substrate.
- Outline: `pdfDocument.getOutline()` **throws over Xrays** (TypedArray access); works via `Components.utils.waiveXrays(...)` — returned 7 titled items with dests. `view._outline` exists but is lazily populated.
- Page canvases present (4 mounted, 960×1242 at default zoom) for area rendering; `getPageData` present on the pdfDocument proxy.
- Programmatic selection exists: `view._setSelectionRanges` / `_getAnnotationFromSelectionRanges` on the view prototype; `view._selectionRanges` readable.
- Caution: Read Aloud is partly monetized (`_onPurchaseReadAloudCredits`) — we use only the local segmentation, never the TTS/credit path.

**Sentence-geometry alignment (2026-07-22, hard-won):** segment text is
dehyphenated and ligature-expanded relative to the char-unit array, so naive
character counting drifts sentence→rect mapping within affected paragraphs
(symptom: glow offset by characters, or by whole lines when drift crosses a
line break — document-dependent, which masqueraded as environment/transform
bugs through a long diagnostic arc). Mapping must walk text and char units
together (`alignTextToChars` in core/sentences.ts): ligature units absorb
several letters, hyphen units absent from text are skipped, unalignable
content falls back to visual-line targets. Related hardening from the same
arc: reader-internal arrays must be cloned at the adapter boundary (Xray
waivers make privileged callbacks into their methods throw), and all PDF↔
client conversion goes through the pdf.js page viewport normalized by the
canvas's CSS rect (Zotero's CSS zoom drifts from viewport scale).

## Goals / Non-Goals

**Goals:**

- Grab-to-pastable in ≲2 clicks with provenance always attached; clicks-not-drags throughout.
- **Grabs are lean pointers (deixis), not content dumps**: the full PDF in the chat is the content; a grab's job is to _locate_ unambiguously, never to duplicate document content into headers. Cross-paper references are served by fetching the actual paper (MCP `fetch_pdf`), not by paraphrasing it into a grab.
- One action ferries any number of grabs into the chat (clipboard bundle or MCP pull).
- Keep the interesting logic viewer-agnostic for a future browser-extension sibling.
- Contain private-API breakage behind one adapter module.

**Non-Goals:**

- Embedded chat UI, AI API calls, or prompt management (the user's existing chat is the UI).
- Element-picking (auto-bounding figures), persistent grab annotations, writing chat output back to Zotero, browser extension (roadmap, not v0.1).
- Live reader-state sync (current scroll/tab) — the grab trail is the source of truth, not "what is open right now". A "what's on screen" co-reading tool was considered and deliberately skipped.
- Context enrichment beyond locators (resolving citation markers, notation definitions, surrounding paragraphs into headers) — rejected as duplicative of the attached PDF; see the lean-pointers goal.

## Decisions

### D1: Three-layer architecture

```text
┌────────────────────────────────────────────────────────┐
│ shell (Zotero-specific)                                │
│   grab-mode UI, hotkeys, toolbar, prefs, MCP server    │
├────────────────────────────────────────────────────────┤
│ core (viewer-agnostic, no Zotero imports)              │
│   sentence segmentation over char geometry, grab trail,│
│   provenance/bundle rendering, rendering profiles      │
├────────────────────────────────────────────────────────┤
│ reader adapter (all private-API access, one module)    │
│   chars/getPageData, outline, selection, overlay mount,│
│   area image rendering                                 │
└────────────────────────────────────────────────────────┘
```

Core consumes plain data (char rects, page text, item metadata) so the browser-extension sibling can reuse it over stock pdf.js, and is kept publishable as a standalone package (the ambient standardization goal — bundle format + tool contract documented once stable). Every `wrappedJSObject`/`_internalReader` touch lives in the adapter; nothing else may import reader internals. _Alternative considered_: direct integration throughout — faster now, but couples the product logic to APIs Zotero explicitly reserves the right to break.

### D2: Sentence-snap assembled from Zotero's own machinery

Per page (lazily, on first hover in grab mode): pull `chars` via the adapter → assemble logical text with hyphenation/citation handling ported from Zotero 9's `sdt-segments.ts` → segment with `sentencex-ts` (MIT; what Zotero itself uses — better than `Intl.Segmenter` on abbreviations/citations) → precompute per-sentence merged rect lists (à la `getRectsFromChars`). Hover hit-tests against sentence rects; overlay layer draws the glow; click emits a text grab; shift-click extends the sentence range. _Alternatives_: `Intl.Segmenter` (kept as zero-dep fallback), third-party libraries (none attach to Zotero's embedded reader — verified).

### D3: Two-click area grab, ephemeral image rendering

First click anchors a corner; a preview rectangle tracks the cursor; second click completes; Esc cancels. The region renders to PNG **directly from the pdf.js page canvas** via the adapter — no annotation is created (cleanest ephemeral path). _Alternative considered_: silently create a Zotero area annotation, read its cached PNG, delete it — proven pipeline, but pollutes sync/undo surface and violates ephemerality if cleanup fails; keep as fallback if direct canvas rendering hits rendering-scale issues.

### D4: Grab trail as the shared model

Append-only in-memory session log: `{ ts, kind: text|image, payload, source: { itemKey, pageLabel, section?, citation } }`. Multi-paper by construction (each grab self-identifies its paper, so citation-hopping across reader tabs needs no tab tracking). Both delivery paths consume the trail; "first grab of session per paper" (full citation vs. compact locator) is computed from it. Not persisted across Zotero restarts in v0.1.

### D5: Provenance from Zotero metadata + PDF outline

First grab per paper per session: full citation via Zotero's citeproc/QuickCopy plus page. Subsequent: `§<outline section>, p. <pageLabel>`. Section resolved by mapping grab position into pdf.js `getOutline()` destinations (adapter); when the PDF has no outline or resolution fails, degrade to page-only — never block a grab on missing structure. Headers are plain markdown for chat-target portability.

### D6: Clipboard delivery with a floor and an experiment

Floor (guaranteed): each grab immediately writes the clipboard via `ClipboardHelper` — text grabs as `header + quoted text`, image grabs as native image **with the provenance header rendered as a thin caption strip inside the PNG** (spike S1 follow-up showed rich apps take only the image flavor from a mixed paste). Experiment (spike S1): "copy session bundle" composes one HTML clipboard flavor with embedded `data:` URI images so a single paste carries interleaved text + images into claude.ai. If the experiment fails, bundle falls back to text-only bundle + images copied sequentially. Paper-intro action writes citation + abstract + "PDF attached" text (and `addFile(pdfPath)` where spike S3 proves file paste works).

### D7: Localhost grab hub — MCP server first, push channel next

The localhost server is architected as a **grab-event hub**: core emits grab/trail events onto an internal bus; consumers subscribe. v0.1 ships one consumer — the MCP server — but the hub interface is the seam for the v0.2 zero-paste browser extension (a WebSocket consumer that pushes grabs into the claude.ai composer). Designing the bus now is a one-line cost; retrofitting it out of an MCP-only server later is a refactor.

MCP consumer: `@modelcontextprotocol/sdk` Streamable HTTP server on a configurable localhost port, started/stopped with the plugin (precedent: cookjohn/zotero-mcp). Tools (not MCP resources — resources are flaky for large content in Claude desktop and require manual attaching):

- `list_grabs` — the grab trail (filters: since, paper)
- `get_grab` — full payload of one grab (image content returned base64)
- `get_paper` — metadata + abstract for an item in the trail
- `fetch_pdf` — attachment content/path for a trail paper, enabling "let's discuss the paper I have open" without manual upload

Advisory only, no "current tab" pointer — the trail is the stable identity. Off by default if port binding fails; clipboard path never depends on the server.

### D8: Grab mode activation

Toolbar button + hotkey, with a pref choosing hotkey semantics (toggle vs. press-and-hold). Visible indicator (toolbar state + cursor change) whenever active. Grab mode suppresses its overlays instantly on exit; it does not modify Zotero's native selection/annotation tools, it sits above them.

**Spike S1/S3 findings (2026-07-21, Windows Zotero → claude.ai in Brave, via test/spike shortcuts):**

- **S1 resolved — mixed HTML single-paste does NOT work**: claude.ai ingests the HTML flavor's text (formatting preserved) but silently drops embedded `data:` URI images. Session bundle therefore ships as _text bundle + sequential image copies_ on the clipboard path; one-action multi-grab batching with images is exclusively MCP's job (D7).
- Native image flavor pastes fine (floor combo image arrived as an attachment), but **an accompanying text flavor is not taken by claude.ai (or Word) on the same paste** — rich apps prefer the image representation. Notepad++ check confirmed both flavors coexist on the Windows clipboard (text-only apps take the text), so this is receiver-side preference, not a compose bug. Consequence for D6: image grabs carry provenance as a **caption strip rendered into the PNG** (thin header bar burned into the image); the text flavor is still written alongside as a free bonus for text-only targets.
- **S3 resolved — clipboard file paste WORKS**: `ClipboardHelper.addFile(pdfPath)` + Ctrl+V attaches the full PDF to claude.ai on Windows. The paper-intro action can automate PDF delivery push-style; no download/upload dance. (Claude desktop and non-Windows platforms untested.)

## Risks / Trade-offs

- [Reader internals churn between Zotero point releases] → all access confined to the adapter; CI runs `zotero-plugin test` against current Zotero; adapter failures degrade features (e.g. sentence-snap off) rather than crash; Zotero 9's native sentence infra is a future official-API exit ramp.
- [Mixed text+image single paste may not land in claude.ai (S1)] → floor design (per-grab paste) already satisfies daily use; bundle degrades to text+sequential images.
- [Sentence segmentation quality on messy PDFs (two-column, math-heavy)] → sentencex + Zotero 9's preprocessing is the current best-in-class; imperfect snaps are still grabbable via shift-extend or area grab.
- [Per-page precompute cost on large PDFs] → lazy per-page, cached, computed only in grab mode.
- [Clipboard behavior differences (Linux/WSL vs Windows/macOS)] → ClipboardHelper has per-platform fallbacks; verify on the user's actual platforms early (Windows host is primary).
- [MCP port conflicts / client setup friction] → configurable port, graceful disable, README recipes for Claude desktop/Code; clipboard path is always available.

## Migration Plan

Greenfield feature on a scaffold repo; no migration. Ship order inside v0.1: spikes (S1–S3) → adapter + area grab + provenance + clipboard floor (usable build) → sentence-snap → trail bundle → MCP server.

## Open Questions

- S1: does an HTML clipboard flavor with embedded images paste into claude.ai as text + attached images?
- S2: exact working internals paths on current Zotero 7 (chars via `getPageData`, outline, page canvas access) — verify in a throwaway build first.
- S3: does `addFile(pdf)` + paste attach the PDF in claude.ai (per platform)?
- Default hotkey choice and default MCP port (pick unregistered, document).
- Whether `fetch_pdf` returns a filesystem path (Claude Code-friendly) or base64 content (desktop-friendly) — likely both, profile-dependent.
- Element-picking (roadmap): docling-class local Python sidecar (plugin-managed process) vs. small ONNX layout model in-process (e.g. DocLayout-YOLO export). Constraint either way: local-only, small, optional, two-click box as fallback. Decide when that feature is scheduled; v0.1 only needs the overlay/hit-test seam to accept a second hit-test source, which the sentence-rect design already provides.
