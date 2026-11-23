# Tasks: fix-chat-pane-resize

## 1. Fix

- [x] 1.1 Add a smoke test in `test/adapter-smoke.test.ts` that drags the pane's splitter left then right with trusted mouse events and checks for no gap between the PDF browser and the splitter; verify it fails on the current code (gap equal to the width the pane gave up)
- [x] 1.2 In `mountPane`, insert the splitter and pane right after `browser.reader` (falling back to appending), and in `unmountPane` clear the width left on the PDF browser; verify the smoke test passes
- [x] 1.3 Add a task rule to `openspec/config.yaml`: manual checks of interactive UI go both ways and back; verify `openspec validate fix-chat-pane-resize --strict` passes

## 2. Manual check

- [x] 2.1 In `npm start`, open a paper's claude.ai pane and drag the splitter left and right several times; verify no grey gap appears, the PDF stretches when the Zotero window is resized, closing the pane lets the PDF fill the tab, and reopening restores the last width
