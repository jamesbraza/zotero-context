# Tasks: add-chat-links

## 1. De-risking spikes (throwaway code, findings recorded in design.md)

- [x] 1.1 S1: Mount a remote, unprivileged claude.ai content browser in the reader's side area on Zotero 10/11; record placement option, sign-in persistence across restart, and Google vs email sign-in in design.md D5 — WORKS (remote browser beside the reader in `_tabContainer`; email sign-in only; persists across restart)
- [x] 1.2 S2: In that pane, attach a local PDF and insert text into claude.ai's chat box, observe the URL change to `/chat/<uuid>` on first send, and read the chat title; record selectors/approach and failure modes in design.md D5 — WORKS (insertText + file-input DataTransfer via a `data:` frame script; `/chat/<uuid>` by pushState)
- [x] 1.3 S3: Run `claude://claude.ai/project/<id>` on Windows; record whether the desktop app opens the project, and resolve the matching Open Question in design.md — WORKS (opens the project page in Claude desktop)
- [x] 1.4 S4: Record the argument forms `codex resume` accepts (ID, `--last`, …) and resolve the matching Open Question in design.md — DONE by source lookup (`codex resume <uuid-or-name>`; no preset-ID flag)

## 2. Write rule and parsing core

- [x] 2.1 Amend `openspec/config.yaml` invariant to "Grabs are ephemeral; the only library writes are chat-link notes, their tag, and Related links (see add-chat-links)"; verify `openspec validate add-chat-links --strict` still passes
- [x] 2.2 Add an eslint override exempting only `src/modules/chat-links/store.ts` from the `no-restricted-syntax` write ban; verify `npm run lint:check` fails on a write call placed in any other file and passes otherwise
- [x] 2.3 Implement pure link parsing and normalization in `src/core/` (http(s) URLs, claude.ai `/chat/` `/share/` `/code/`, ChatGPT/Codex URLs, bare UUID, `claude --resume <id-or-name>`, `codex resume <id-or-name>`, names; identity normalization); verify with unit tests in `test/core.test.ts` covering every scenario of the "Accepted link inputs" and "Format-only validation" requirements
- [x] 2.4 Implement pure note rendering and parsing in `src/core/` (title line, labeled fields, user-notes area preserved on rewrite, topic fallback); verify round-trip unit tests including hand-edited fields

## 3. Note store

- [ ] 3.1 Implement `src/modules/chat-links/store.ts`: create a chat note under a paper with the tag, find copies by identity, link a chat to more papers with Related among all copies, no-op on duplicates; verify with Zotero-side tests that create and erase test items
- [ ] 3.2 Add edit propagation (rewrite title + fields in every copy, keep each copy's notes); verify with a test editing a chat linked to two papers
- [ ] 3.3 Add the "Link chats in group libraries" pref (default off) and refuse group-library writes in the store when off; verify with a test against a group-library item or a stubbed library type
- [ ] 3.4 Update SECURITY.md ("What this plugin does not do") to describe the narrow write exception and the group default; verify the text matches the "Narrow library-write scope" requirement

## 4. Manual linking UI

- [ ] 4.1 Register item context menus via `Zotero.MenuManager` (`Link chat…` on regular items; `Also link to…`, `Edit chat link…`, `Copy resume command`, `Open chat link` on tagged chat notes), unregistered on shutdown, strings in `mainWindow.ftl`; verify menus appear only on the right item types in a dev build
- [ ] 4.2 Build the Link chat dialog (paste field with inline validation, Title field, existing-chats list newest first, group notice or opt-in explanation); verify each "Link chat dialog" and "Group libraries are opt-in" scenario in a dev build
- [ ] 4.3 Implement the chat-note actions (item picker for Also link to…, edit dialog prefilled, copy resume command to clipboard without launching anything, open web link in browser); verify each "Chat note actions" scenario in a dev build
- [ ] 4.4 Manual e2e: link a real claude.ai chat URL and a real `claude --resume <id>` line to a real paper, add a second paper via Also link to…, retitle via Edit chat link…, and confirm Related, tags, and per-copy notes in Zotero

## 5. Starting chats from Zotero

- [ ] 5.1 Add prefs and settings UI: Preferred chat (radiogroup, 4 choices), Start new chats in project (URL field), Link chats when starting an intro (checkbox, default on), Link chats in group libraries (checkbox, default off); verify values persist across restart
- [ ] 5.2 Refactor `src/modules/paper-intro.ts` to branch on Preferred chat (export/reuse `getFocusedTopItem`, `composeIntro`); desktop/browser choices keep the two-phase clipboard flow and open `claude://claude.ai/new` / `https://claude.ai/new` or the mapped project URL; verify existing intro behavior is unchanged for those choices
- [ ] 5.3 Implement the Claude Code start: mint UUID, write the note (respecting auto-link and group prefs), copy `claude --session-id <uuid> -n "<name>" "<intro>"` with citation, abstract, PDF path, and MCP paper ID when enabled; verify unit tests for the command/intro text and a Zotero-side test for the note
- [ ] 5.4 Add `GrabTrail.admit(paperId)` in `src/core/trail.ts` (cleared by `clear()`) and call it from the Claude Code start; update SECURITY.md's MCP scope bullet; verify `test/mcp.test.ts` covers fetching an introduced paper and refusal after clear
- [ ] 5.5 Add the reader-toolbar New chat button (same `renderToolbar` pattern as grab mode) calling the same start action; verify the button triggers the start in a dev build
- [ ] 5.6 Manual e2e: with Preferred chat = Claude Code on a real paper, paste the copied command in a WSL terminal, confirm Claude reads the PDF (and via MCP when enabled), exit, then run "Copy resume command" from the note and confirm `claude --resume` reopens the session
- [ ] 5.7 Manual e2e: with Preferred chat = Claude desktop app and = claude.ai in your browser, confirm the intro opens a new chat (and a project when set) and the PDF pastes; then link the chat via the dialog

## 6. claude.ai in Zotero pane

- [ ] 6.1 Implement `src/adapter/chat-pane.ts`: mount/unmount the unprivileged claude.ai pane in the reader per spike S1, with graceful failure results; add coverage to `test/adapter-smoke.test.ts`
- [ ] 6.2 Implement chat-box filling (PDF + intro) and chat-title reading in the adapter per spike S2, falling back to the clipboard intro on failure; verify the fallback path with a test that simulates a missing chat box
- [ ] 6.3 Wire the pane into the start action and "Open chat link" (pane closed until asked); link the first `/chat/<uuid>` reached after a start and stop observing; verify each "Pane links its first chat" scenario in a dev build
- [ ] 6.4 Document the hosted claude.ai pane in SECURITY.md (unprivileged content, cookies in Zotero profile, no bridge to Zotero APIs); verify the text matches the "claude.ai in a reader side pane" requirement
- [ ] 6.5 Manual e2e: with Preferred chat = claude.ai in Zotero on a real paper, sign in, press the intro, send, confirm the note appears with the chat title; restart Zotero and confirm sign-in persists and "Open chat link" reopens the chat in the pane

## 7. Docs and release gating

- [ ] 7.1 Update README.md (chat links feature, Preferred chat, hotkey/toolbar behavior, `cleanupPeriodDays` tip for Claude Code, group opt-in, MCP scope note); verify every documented menu item and setting exists in a dev build
- [x] 7.2 Update `openspec/changes/add-context-ferry/tasks.md` task 8.3 to also wait on add-chat-links, and its proposal/design non-goal lines to point here; verify `openspec validate add-context-ferry --strict` passes
- [ ] 7.3 Integration check: `npm run lint:check`, `npm run typecheck`, and `npm test` pass; `openspec validate add-chat-links --strict` passes

## Workflow follow-up

- Archive add-context-ferry before this change so the `mcp-delivery` delta merges into an existing main spec.
- Archive add-chat-links after the v0.1.0 checks, then verify the archived specs.
