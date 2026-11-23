# Design: fix-chat-pane-resize

## Context

See proposal.md (Why). Constraints:

- Zotero 10.0.8's `ReaderTab` builds the tab container as `[browser.reader (flex=1), popupset]` (`chrome/content/zotero/xpcom/reader.js`). The container is a flex row, and Firefox's `xul.css` doesn't hide `popupset`, so it's a zero-width box in that row.
- A XUL `<splitter>` with `resizebefore="closest"` and `resizeafter="closest"` resizes its nearest siblings and fixes a width on each.
- `src/adapter/chat-pane.ts` is the only code that knows the reader tab's private layout, and adapter changes need coverage in `test/adapter-smoke.test.ts`.

## Goals / Non-Goals

**Goals:**

- The splitter trades width only between the PDF browser and the pane.
- Closing the pane leaves the reader tab as Zotero built it.

**Non-Goals:**

- Changing how the pane's width is saved and restored (the `chatPaneWidth` pref).
- Overlaying the pane on the PDF instead of sharing width with it.

## Decisions

- **Insert the splitter and pane right after `browser.reader`.** This makes the PDF browser the splitter's left neighbor. Alternatives:
  - `resizebefore="flex"`, which skips to the nearest flexible sibling. Rejected because it leaves the pane after the popupset and depends on how the native splitter reads XUL `flex`, which is harder to verify across Firefox versions.
  - Hiding the popupset with CSS. Rejected because it restyles an element Zotero owns, which holds the reader's popups.
- **Fall back to appending when `browser.reader` isn't found.** That keeps the pane working, with the old resize bug, if Zotero renames or restructures the tab, instead of failing to open it.
- **On close, clear the width attribute and inline width the splitter set on `browser.reader`.** The splitter fixes a width on its neighbor, so without this the PDF would keep the narrower width after the pane closes.
- **Test with trusted mouse events (`window.synthesizeMouseEvent` on Firefox 153+, else `windowUtils.sendMouseEvent`).** Trusted events drive the native splitter the way a real drag does, and a structural check alone wouldn't show that the drag behaves.

## Risks / Trade-offs

- [A Zotero update adds another element between `browser.reader` and the splitter] → The smoke test checks that the splitter's left neighbor is the PDF browser and that dragging leaves no gap, so a Zotero update that breaks this fails the tests.
- [Synthesized drags under-deliver on a slow runner (one run before the fix moved 40px instead of 200)] → The drag test allows 5px of slack, and the failure message names the check, so a flaky run is easy to spot. Since the fix, every run has passed.
