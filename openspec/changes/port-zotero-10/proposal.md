# Proposal: port-zotero-10

## Why

Zotero's release channel moved to 10.0.x. Zotero 10 removed `view._initReadAloudSegments()` — the private
Read Aloud API sentence snap was built on (backlog 10.4 of add-context-ferry) — so text snap is dead on 10,
CI's adapter smoke tests fail, and the manifest (`strict_max_version: "9.*"`) blocks installation. The
world has moved on from Zotero 9, so rather than re-deriving Zotero 9's segments, the plugin moves onto
what Zotero 10 ships: SDT, the layout-model text layer that now powers Read Aloud, Reading Mode, and the
mobile apps.

## What Changes

- **Sentence snap on SDT**: sentences come from SDT blocks (reading order, excluded flow pruned, part chains
  joined across column/page breaks), split by `sentencex-ts` (Zotero's own splitter), and mapped to page
  rects by the reader's SDT position mapper. Replaces char-geometry alignment entirely.
- **Zotero-10-only**: manifest `10.0`–`10.*`; build target `firefox140` (Zotero 10's ESR).
- **Offloads** (follow-up tasks, each feature-detected with the existing path as fallback): area grabs via
  the reader's offscreen `renderRegionCrops`; section locators from the SDT outline; one-click
  figure/table/equation grabs from SDT blocks; an MCP `get_paper_text` tool over `Zotero.SDT`; the paper
  intro citation via `Zotero.QuickCopy`.
- **CI**: release lane plus a non-blocking Zotero beta lane.

### Not adopted

Hosting MCP on Zotero's own server (`Zotero.Server.Endpoints`): Zotero's debug log records every request
header (the bearer token would leak into shared debug logs), responses are buffered strings only, and MCP
would break whenever `httpServer.enabled` is off. The plugin keeps its own hardened httpd.

## Capabilities

### Modified Capabilities

- `text-grab`: sentence segmentation and geometry source (SDT), unavailability semantics.

## Impact

- **Code**: `src/adapter/reader.ts` (SDT load + mapping replaces Read Aloud/char access),
  new `src/core/sdt-sentences.ts` (pure), `src/modules/segment-cache.ts`; `src/core/sentences.ts` removed.
- **Dependencies**: `sentencex-ts` (MIT).
- **Licensing**: `zotero/structured-document-text` ships no license; its code is reference only — the
  SDT walking here is written against the schema. `zotero/reader` is AGPL (compatible).
