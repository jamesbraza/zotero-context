# Proposal: add-context-ferry

## Why

Active readers of paper PDFs constantly interrupt their thinking to ferry context into an AI chat: precisely copying text, positioning screenshot boxes, remembering section/figure numbers, and downloading/uploading/introducing the PDF itself. Existing Zotero AI plugins (zotero-gpt, paper-chat-for-zotero, PapersGPT) all embed a chat _inside_ Zotero; none makes the user's existing chat (claude.ai, Claude desktop, Claude Code) effortless to feed. That ferry niche is confirmed open — no plugin or MCP server exposes live reading context.

## What Changes

- Add a **grab mode** to the Zotero reader: entered via toolbar button or configurable hotkey (toggle or press-and-hold), with a visible mode indicator.
- Add two clicks-not-drags grab interactions:
  - **Sentence-snap text grab**: hovering highlights the sentence under the cursor; click grabs it as text; shift-click extends to adjacent sentences.
  - **Two-click area grab**: click two opposite corners to capture a region (figure, table, formula) as an image. No press-and-hold dragging anywhere.
- Stamp every grab with **provenance**: full citation (title, authors, year, page) on the first grab of a session; compact locator ("§4.3.2, p. 16") thereafter; page-only fallback when the PDF has no outline.
- Maintain an in-memory **grab trail** (append-only session log of grabs across papers/tabs). Grabs are ephemeral — no annotations or other traces are left in the library.
- Deliver grabs by **push (clipboard)**: each grab is immediately pastable (text, or image via native clipboard formats); include a "copy session bundle" action honoring the invariant _any number of grabs reaches the chat in one action_.
- Deliver grabs by **pull (MCP)**: an in-process MCP server (Streamable HTTP on a local port) exposing the grab trail and fetch-PDF-by-item tools, so MCP clients can pull the paper and grabs without manual upload.
- Add a **paper intro** action: one click copies an introduction blurb (citation + abstract + "PDF attached") to start a chat session.

Explicitly out of scope for v0.1: element-picking (click a figure and have it auto-bounded), persistent grabs-as-annotations, writing AI answers back into Zotero, and the browser-extension sibling (kept viable by keeping core logic viewer-agnostic).

Committed roadmap beyond v0.1 (v0.1 must not foreclose these):

- **v0.2 — zero-paste transport**: a companion browser extension that receives grab events from the plugin's localhost hub (WebSocket) and injects them directly into the claude.ai composer — click in Zotero, grab appears in the chat input. The v0.1 localhost server is therefore designed as a _grab-event hub_ with MCP as its first consumer, not as an MCP-only server.
- **Later — element-picking** via small, local-only document-layout models (docling-class sidecar or an ONNX model in-process); never remote calls, never large models, always optional with two-click box as the fallback.
- **Ambient goal — the bundle as a standard**: keep the viewer-agnostic core publishable as a standalone package and the grab-bundle/provenance format + MCP tool contract documented, so other readers and chat clients can adopt them. Not a primary goal.

## Capabilities

### New Capabilities

- `grab-mode`: entering/exiting grab mode (toolbar button, configurable toggle/hold hotkey), mode indication, coexistence with normal reading and Zotero's native tools.
- `text-grab`: sentence-snap selection — hover highlight of sentence units, click to grab, shift-click to extend; built on reader text geometry plus sentence segmentation.
- `area-grab`: two-click rectangular region capture rendered to an image, leaving no annotation behind.
- `grab-provenance`: provenance header attached to every grab — full citation first, compact section+page locator after, graceful degradation without an outline.
- `grab-trail`: append-only session log of grabs (multi-paper aware), the shared model both delivery paths consume, with per-target rendering profiles (rich paste vs. file-path-on-disk for CLI chats).
- `clipboard-delivery`: push transport — immediate per-grab copy, one-action session bundle, paper-intro copy; text, image, and (experimental) mixed-content clipboard composition.
- `mcp-delivery`: pull transport — in-process MCP server exposing grab-trail and fetch-PDF tools to
  MCP-capable chat clients.

### Modified Capabilities

None — this is the plugin's first feature change; `openspec/specs/` is empty.

## Impact

- **Code**: new feature modules under `src/modules/` (grab mode UI, snap/area interactions, trail, clipboard, MCP); a thin **reader-internals adapter** isolating all unofficial `reader._internalReader` / pdf.js access (selection geometry via the reader's `chars` arrays, outline via `getOutline()`), since these are private APIs that churn between Zotero releases. Core logic (segmentation, trail, bundle rendering) stays free of Zotero imports for the future browser-extension sibling.
- **Dependencies**: `sentencex-ts` (MIT; the segmenter Zotero 9's own sentence infrastructure uses), `@modelcontextprotocol/sdk`; `zotero-plugin-toolkit` (already present) for clipboard/UI helpers. Zotero 9's `sdt-segments.ts` / `pdf-position-mapper.ts` serve as AGPL-compatible blueprints to port.
- **Systems**: local HTTP port for the MCP server (in-process, following the cookjohn/zotero-mcp precedent); system clipboard integration.
- **Assumption spikes** (de-risk first, before deep build-out): (1) mixed text+image single-paste into claude.ai via HTML-with-embedded-images; (2) reader-internals access paths on current Zotero 7; (3) whether a clipboard _file_ copy of the PDF pastes into claude.ai (affects how much the paper-intro flow can automate).
