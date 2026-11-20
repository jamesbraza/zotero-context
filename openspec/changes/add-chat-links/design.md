# Design: add-chat-links

## Context

See proposal.md (Why). Constraints from the current codebase:

- The plugin has never written to the library. `openspec/config.yaml` states "Grabs are ephemeral: never call annotation or save APIs", SECURITY.md promises "No changes to your Zotero library", and `eslint.config.mjs` bans `saveTx|eraseTx|addAnnotation|…` across `src/**`.
- The paper intro (`src/modules/paper-intro.ts`) is a two-phase clipboard flow on `Ctrl+Alt+I`: first press puts the PDF file on the clipboard, a second press within 60 s copies the intro text. `getFocusedTopItem` and `composeIntro` are module-private.
- MCP retrieval scope is "papers present in the trail" (`GrabTrail.papers()`), filled only by `append()`; paper IDs are `libraryID/key` (`grab-session.ts`).
- The reader toolbar button pattern is `Zotero.Reader.registerEventListener("renderToolbar", …)` (`grab-mode.ts`). No item context menus exist yet; Zotero 10–11 offers `Zotero.MenuManager.registerMenu`.
- The user's setup is Windows Zotero with Claude Code inside WSL; Claude desktop runs on Windows.

Verified during design (2026-11-18/19):

- `claude --session-id <uuid>` and `-n <name>` start a session with a chosen ID (Claude Code 2.1.327). `claude --resume <id>` works from any folder; resuming by name only matches within the original project folder. On exit Claude Code prints `Resume this session with: claude --resume <id>`.
- `claude --desktop` is unavailable inside WSL ("works on macOS and Windows (x64)").
- `claude://claude.ai/new` and `claude://new` open Claude desktop on a new chat.
- Claude desktop has no "copy link" for a chat; Share → Copy link yields `claude.ai/share/<uuid>` (a different UUID than the chat's `claude.ai/chat/<uuid>`) and makes the chat viewable by anyone with the link.
- MCP servers receive no conversation identifier, and the model cannot see its own claude.ai URL; Claude Code exposes `session_id` only to hooks.
- Claudian (Obsidian) runs ordinary Claude Code sessions (Agent SDK over the `claude` CLI, transcripts in `~/.claude/projects`), so its chats resume with `claude --resume <id>`.
- Spike S3 (2026-11-19, Claude desktop on Windows via `Win+R`): `claude://claude.ai/project/<id>` opens the desktop app on that project's page, where a new chat starts inside the project. So the desktop choice maps a project URL to `claude://claude.ai/project/<id>`.
- Spike S4 (2026-11-19, source lookup since no Codex install is available): Codex CLI `rust-v0.170.0` accepts `codex resume [SESSION_ID]` where the value is a UUID or a session name (a UUID wins if it parses), plus `--last`, `--all`, and `--include-non-interactive` (https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/cli/src/main.rs#L364-L388). Parsing accepts `codex resume <uuid-or-name>`; `--last` and a bare `codex resume` name no session, so they are rejected. Codex has no flag to preset a session ID, which confirms Codex links are manual only.
- Agent harness resume syntax (2026-11-19, from source at a release tag unless noted): Claude Code `claude --resume <id-or-name>` (CHANGELOG v2.1.329, closed source); Codex `codex resume <uuid-or-name>` (rust-v0.170.0); Gemini CLI `gemini --resume <uuid>` (v0.70.0); Qwen Code `qwen --resume <uuid-or-title>` (v0.28.0); Copilot CLI `copilot --resume <id-or-name>` (changelog v1.0.114); OpenCode `opencode -s <ses_…>` (v1.19.6); Pi `pi --session <id>` (pi-mono v1.5.2); Cursor CLI `agent --resume=<chat-id>` (docs); Grok CLI `grok -s <id>` (grok-dev@1.1.7); Amp `amp threads continue T-…` (docs). Only Claude Code, Codex, Qwen, and Copilot resume by name, so a bare token for the others is read as an ID.
- AI Chat Referencing v0.1.0 converts a Connector-saved Web Page into a `computerProgram` item with a "Prompts" child note and no Related links.

## Goals / Non-Goals

**Goals:**

- Linking costs nothing when a chat is started from Zotero; linking an existing chat takes one dialog.
- Every link mechanism knows both the paper and the chat exactly — no inference from timing, titles, or chat content.
- The library-write surface stays small, auditable, and lint-enforced.

**Non-Goals:**

- Capturing chats through the Zotero Connector, userscripts, browser history, clipboard watching, or claude.ai data exports (each either guesses the pairing, leaves stray items, or reads far more than one chat).
- Reading local chat-tool data (`~/.claude`, `~/.codex`) for validation or a session picker.
- Launching terminals or the desktop app with `claude --desktop`.
- Inventing non-native grouping (e.g. a Claude Code "project folder" setting); only claude.ai Projects, which are Claude-native, are supported.
- Auto-adding a paper to an already-open chat.
- Saving transcripts or making chats citable.

## Decisions

### D1: Child note per (chat, paper), copies joined by Related

Alternatives: one standalone note or item per chat related to every paper (single record, `View Online` for items), a linked-URL attachment, or the Extra field. Standalone records add a row to My Library and the active collection for every chat, which clutters the library over time; items can also leak into bibliography exports. Linked-URL attachments cannot hold CLI sessions. Child notes are nested under the paper and add no rows. The price is one copy per paper, which Zotero's own Related field ties together and keeps current (renames, deletions, sync) without plugin code or a Notifier observer.

### D2: The note body is the record

Fields are written as visible labeled lines and parsed back; no hidden attributes (Zotero's note editor drops unknown attributes on edit) and no side store. A chat's identity is its normalized URL (scheme/host lowercased, trailing slash and query stripped for known chat URLs) or `tool + session ID`. Finding copies of a chat = searching notes with the `zotero-context/chat` tag in the same library and comparing identities. User-written text lives after the fields; edits rewrite only the title line and field block, so per-copy notes survive (spec: Edits propagate to every copy).

### D3: Claude Code links by minting the session ID

Because `--session-id` lets the caller choose the ID, Zotero generates a UUID, writes the note, and copies `claude --session-id <uuid> -n "<name>" "<intro>"`. No hook, MCP write tool, or transcript access is needed. The command is copied, never executed: Zotero cannot know whether `claude` lives in WSL or natively, and launching programs from note-derived data would be an injection surface. No `cd` is emitted since resume-by-ID is folder-independent. The `-n` name is derived from the paper (first author + year, e.g. `vaswani-2017`) and is the note's topic until the user edits it. If the user never runs the command, the note dangles; this is accepted and visible (an unused session simply fails to resume).

Intro text for Claude Code: citation, abstract, the PDF path as Zotero sees it (a `C:\…` path on Windows; Claude in WSL translates it), and, when the MCP server is enabled, the paper ID for `get_paper`/`fetch_pdf`.

### D4: Desktop and browser link manually

Neither Zotero nor the model can learn a claude.ai chat URL from an external browser or the desktop app without extra software. Starting a chat performs today's clipboard intro and opens `claude://claude.ai/new` or `https://claude.ai/new` (or the project URL, mapped to the same scheme); the user links later via the dialog. The v0.2 browser extension (add-context-ferry roadmap) can later supply browser URLs automatically. Desktop users copy the chat URL from claude.ai in a browser or use a share link (the dialog accepts both; design notes the share link is public).

### D5: claude.ai in a reader side pane

The pane is a `<browser type="content" remote="true" remoteType="web">` appended, after a `<splitter>`, to the reader tab's container (`reader._tabContainer`, a flex row holding the reader's own `browser.reader`). With Fission the page gets its own isolated content process with a `https://claude.ai` content principal, so it cannot reach Zotero APIs. It uses the default cookie jar in Zotero's profile, so sign-in persists; Google sign-in fails in the embedded browser and email sign-in is the supported path.

Page scripting goes through a frame script loaded from a `data:` URI into the pane's message manager. It runs each operation in a `Cu.Sandbox` whose principal and prototype are the page window, so page CSP does not apply and nothing runs with chrome privileges inside the page. Operations: focus the TipTap/ProseMirror editor and `execCommand("insertText")`; build a `File` from the PDF bytes (read in the parent with `IOUtils.read`, sent as message data), put it in a `DataTransfer`, assign it to the page's file input, and dispatch `change`.

Linking uses a progress listener (`NOTIFY_LOCATION`) on the pane browser. The first top-level `claude.ai/chat/<uuid>` location after a start (from `/new` or `/project/<id>`) links that chat to the paper the start was for, then observation stops (spec: Pane links its first chat). The chat title is `document.title` minus its trailing `- Claude`, read once it differs from the bare `Claude`. All claude.ai DOM knowledge lives in `src/adapter/chat-pane.ts` with graceful failure results, mirroring the reader adapter, and falls back to the clipboard intro when the page changes.

**Spike S1/S2 findings (2026-11-19, Zotero 10.0.8 Linux under WSLg, e10s + Fission, uncommitted dev eval harness):**

- **S1 resolved — P2 works: a remote `<browser>` beside the reader.** Appending `<splitter>` + browser to `reader._tabContainer` gives a full-height pane next to the PDF; the splitter resizes it; it survives switching to the library tab and back. `browser.loadURI(uri, { triggeringPrincipal: nullPrincipal })` loads it; `remoteType` resolves to `webIsolated=https://claude.ai`. The `ItemPaneManager` section placement (P1) was not tried: P2 met every criterion, and P1 is a collapsible block in a shared scroll pane.
- **claude.ai renders with no bot or browser block** under Zotero's UA (`… Gecko/20100101 Zotero/10.0.8`); it lands on `/login` when signed out.
- **Sign-in: Google fails, email works.** "Continue with Google" shows "There was an error logging you in"; email-code sign-in succeeds.
- **Sign-in persists across restart.** The page principal is a content principal (`userContextId` 0, not private); `sessionKey` is a persistent cookie (about a month). After a graceful quit and relaunch, a new pane opens directly on `/new`.
- **Actor modules do not load in the page's content process from the dev build.** A `JSWindowActor` child at `chrome://zoterocontext/…` or a `resource://` substitution to the build directory fails there (parent side loads; child never answers). A frame script from a `data:` URI works. Task 6.1 either keeps the frame script or verifies actor loading from the installed xpi.
- **S2 resolved — filling the chat box works on `/new` and on `/project/<id>`.** Selectors: editor `.ProseMirror[contenteditable="true"]` (`aria-label="Write your prompt to Claude"`), file input `input[type=file][data-testid="file-upload"]` (multiple), `button[aria-label="Send message"]`, and the attached file renders as `[data-testid="file-thumbnail"]`. `execCommand("insertText")` enables Send; the file-input `DataTransfer` route attaches the PDF (drop and paste routes were not needed).
- **Linking signal:** on first send the top-level URL changes by `pushState` (`LOCATION_CHANGE_SAME_DOCUMENT`) to `/chat/<uuid>`, reported twice; subframes (`about:blank`, `a.claude.ai/isolated-segment.html`) also report, so the listener filters to top-level `claude.ai/chat/<uuid>` and dedupes. The title goes `Claude` → `<title> - Claude` 2–4 s after the URL change.
- **Not tested:** Windows Zotero (the user's real setup) and the selector-missing fallback; left to tasks 6.2 and 6.5.

### D6: Entry points and menus

- Intro hotkey keeps `Ctrl+Alt+I`; a toolbar button reuses the `renderToolbar` pattern. The claude.ai-elsewhere choices keep the two-phase clipboard behavior; Claude Code and the pane are single-press.
- Item context menus use `Zotero.MenuManager.registerMenu` (target `main/library/item`), unregistered on shutdown; strings go in `mainWindow.ftl`. "Link chat…" shows for regular items; chat-note actions show only for notes carrying the tag. "Link chat…" is also on a reader tab's right-click menu (target `main/tab`), for that tab's paper, since in manual testing the reader is where users first reached for it.
- The dialog is a modal built with the toolkit's dialog helper: paste field, Title field, existing-chats list (from tagged notes, newest first, deduplicated by identity), group-library notice. A bare ID or name doesn't say which harness it came from, so the dialog then shows the known-harness list plus "Other" (default Claude Code); "Other" takes a harness name and an optional resume command, stored verbatim. Full resume commands are recognized per harness and need no choice. CLI sessions get an editable Machine field prefilled with this computer's name, since a session linked after the fact may have run elsewhere. Dialog text is plain English like the plugin's toasts; only menu labels use Fluent, which `MenuManager` requires.
- No notifications are part of the linking flow; existing `notify()` status toasts (e.g. "Command copied") remain.

### D7: Library-write confinement

All writes (`saveTx` on notes, tags, `addRelatedItem`) live in one module, `src/modules/chat-links/store.ts`, which gets an eslint override exempting only that file from the `no-restricted-syntax` write ban. Parsing and normalization (`parse.ts`) are pure and live in `src/core/` so they are unit-testable without Zotero. Group-library writes are refused in `store.ts` unless the opt-in pref is set, so every entry point inherits the rule.

### D8: MCP scope admission, no write tool

A Claude Code start calls a new `GrabTrail.admit(paperId)` that adds to the trail's paper set without adding a grab; `clear()` empties it. This keeps the "trail is the identity" model: an intro is a deliberate user act, like a grab. The MCP server gains no tools and stays read-only (user decision: no write capability in MCP).

## Risks / Trade-offs

- [claude.ai DOM changes break chat-box filling or title reading] → adapter isolation, graceful fallback to the clipboard intro, smoke test against a fixture, title falls back to `<Tool> chat · <date>`.
- [Reader side-pane internals change across Zotero majors] → pane mounting lives in the adapter, with smoke coverage.
- [Several harnesses (Gemini, Qwen, Pi, Codex) look sessions up per working directory, so a copied resume command may need a `cd` first] → `claude --resume <id>` was verified folder-independent; the others are untested, and a folder field was deliberately left out. Revisit if it bites.
- [Embedded sign-in blocked (Google SSO)] → confirmed by spike S1; email-code sign-in works; document it.
- [Pane mounting uses the private `reader._tabContainer`] → confined to the adapter, covered by `adapter-smoke.test.ts`.
- [Frame scripts and the message manager are legacy Gecko APIs] → confined to the adapter; actor modules are the fallback if frame scripts go away.
- [Hosting a third-party site inside Zotero] → unprivileged content browser, no message bridge exposing Zotero APIs; SECURITY.md documents it.
- [Claude Code notes dangle when the command is never run] → accepted; user deletes the note.
- [Local sessions expire after `cleanupPeriodDays` (default 30) and resume only on one machine] → the note records `Machine:`; README suggests raising `cleanupPeriodDays`. Transcript copying is a possible follow-up.
- [Group libraries expose chat titles and share links] → opt-in, default off, with a dialog notice.
- [Note copies drift when edited by hand] → "Edit chat link…" rewrites all copies; hand edits to one copy's fields affect only that copy, and identity still matches by URL/ID.
- [First library writes] → single-module confinement, scoped lint exception, SECURITY.md update.

## Migration Plan

No data migration: the plugin has never written to the library. Ship order inside this change: pure parsing + note store + dialog/menus (usable manual linking) → Claude Code start → desktop/browser start → claude.ai pane (behind its spikes). Rollback = disable the plugin; chat notes are ordinary Zotero notes and remain readable without it.
