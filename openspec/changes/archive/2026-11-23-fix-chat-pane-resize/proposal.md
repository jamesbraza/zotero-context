# Proposal: fix-chat-pane-resize

## Why

Dragging the claude.ai pane's splitter left (pane wider) and then back right leaves an empty grey box between the PDF and the pane.

Zotero 10's reader tab container holds `[browser.reader, popupset]`. `mountPane` appended the splitter and pane after the popupset, and a splitter resizes its nearest neighbors. So the width the pane gave up went to the popupset, which Firefox lays out as an ordinary box. The `add-chat-links` spike saw the popupset but measured only the PDF browser, its design note described the container as holding just `browser.reader`, and the spike's manual check only dragged one way.

## What Changes

- Mount the splitter and pane right after the reader's PDF browser, so the splitter trades width between the PDF and the pane.
- On close, clear the width the splitter fixed on the PDF browser.
- Add the "Pane resizes and closes cleanly" requirement to `chat-pane`, covered by a smoke test that drags the splitter with trusted mouse events.
- Ask, in `openspec/config.yaml`, for manual checks of interactive UI to go both ways and back.
- Correct the archived `add-chat-links` design note, which described the reader tab's container without its popupset.

## Capabilities

### Modified Capabilities

- `chat-pane`: adds a requirement for resizing and closing the pane.

## Impact

- `src/adapter/chat-pane.ts` (`mountPane`, `unmountPane`), `test/adapter-smoke.test.ts`, `openspec/config.yaml`.
