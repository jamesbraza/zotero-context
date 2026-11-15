# Tasks: port-zotero-10

## 1. CI unblock

- [x] 1.1 Style flush at `grab-mode.ts` as a call expression (typescript-eslint 8.72 `no-unused-expressions`)

## 2. Spike S3 (Zotero 10.0.8 SDT surfaces)

- [x] 2.1 `_loadSDT` across the Xray boundary; mapper geometry; `Zotero.SDT` timing; block types;
      `renderRegionCrops` (findings in design.md)
- [ ] 2.2 Scanned/OCR PDF and large-document behavior

## 3. Sentence snap on SDT

- [x] 3.1 `src/core/sdt-sentences.ts` (chains, sentencex split, per-part SDT ranges) + unit tests
- [x] 3.2 Adapter `getSegments` via `_loadSDT` + mapper; `segmentsUnavailable` (final per session, D3)
- [x] 3.3 Segment cache builds per-page targets from mapped sentences; remove `core/sentences.ts`
- [x] 3.4 Adapter smoke tests on Zotero 10 (sentence count, page spread, excluded margin stamp, rects)
- [x] 3.5 Manifest `10.0`–`10.*`; build target `firefox140`
- [x] 3.6 CI release + non-blocking beta lanes

## 4. Offloads

- [ ] 4.1 Area grab via `renderRegionCrops` (canvas crop fallback)
- [ ] 4.2 Section locators from SDT outline refs + `sourceToSDTPosition` (`getOutline2` fallback)

## 5. Zotero 10 capabilities

- [ ] 5.1 Element picking: click an SDT image/table/math block (body flow) → crop with adjacent caption
- [ ] 5.2 MCP `get_paper_text` over `Zotero.SDT` (trail-scoped, sectioned by outline)
- [ ] 5.3 Paper intro citation via `Zotero.QuickCopy`

## 6. Docs and upstream

- [ ] 6.1 README / CONTRIBUTING: Zotero 10 dev loop
- [ ] 6.2 Offer upstream issues: desktop `getReadAloudSegments`; SDT repo license
