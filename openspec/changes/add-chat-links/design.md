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

The pane hosts claude.ai as remote, unprivileged content (a content `browser` element with no chrome privileges), so a compromised page cannot reach Zotero APIs. Its cookies live in Zotero's profile; email sign-in is the fallback if Google sign-in rejects embedded browsers. The plugin observes the pane's location: the first `claude.ai/chat/<uuid>` reached after a start links that chat to the paper the start was for, then observation stops (spec: Pane links its first chat). All claude.ai DOM knowledge (chat box selector, file attach, chat title) lives in `src/adapter/chat-pane.ts` with graceful failure results, mirroring the reader adapter, and falls back to the clipboard intro when the page changes. The pane placement relies on reader-pane internals; spike S1 decides between the reader's context pane and an alternative docked element.

### D6: Entry points and menus

- Intro hotkey keeps `Ctrl+Alt+I`; a toolbar button reuses the `renderToolbar` pattern. The claude.ai-elsewhere choices keep the two-phase clipboard behavior; Claude Code and the pane are single-press.
- Item context menus use `Zotero.MenuManager.registerMenu` (target `main/library/item`), unregistered on shutdown; strings go in `mainWindow.ftl`. "Link chat…" shows for regular items; chat-note actions show only for notes carrying the tag.
- The dialog is a modal built with the toolkit's dialog helper: paste field, Title field, existing-chats list (from tagged notes, newest first, deduplicated by identity), group-library notice.
- No notifications are part of the linking flow; existing `notify()` status toasts (e.g. "Command copied") remain.

### D7: Library-write confinement

All writes (`saveTx` on notes, tags, `addRelatedItem`) live in one module, `src/modules/chat-links/store.ts`, which gets an eslint override exempting only that file from the `no-restricted-syntax` write ban. Parsing and normalization (`parse.ts`) are pure and live in `src/core/` so they are unit-testable without Zotero. Group-library writes are refused in `store.ts` unless the opt-in pref is set, so every entry point inherits the rule.

### D8: MCP scope admission, no write tool

A Claude Code start calls a new `GrabTrail.admit(paperId)` that adds to the trail's paper set without adding a grab; `clear()` empties it. This keeps the "trail is the identity" model: an intro is a deliberate user act, like a grab. The MCP server gains no tools and stays read-only (user decision: no write capability in MCP).

## Risks / Trade-offs

- [claude.ai DOM changes break chat-box filling or title reading] → adapter isolation, graceful fallback to the clipboard intro, smoke test against a fixture, title falls back to `<Tool> chat · <date>`.
- [Reader side-pane internals change across Zotero majors] → pane mounting lives in the adapter, with smoke coverage.
- [Embedded sign-in blocked (Google SSO)] → email-code sign-in works; document it.
- [Hosting a third-party site inside Zotero] → unprivileged content browser, no message bridge exposing Zotero APIs; SECURITY.md documents it.
- [Claude Code notes dangle when the command is never run] → accepted; user deletes the note.
- [Local sessions expire after `cleanupPeriodDays` (default 30) and resume only on one machine] → the note records `Machine:`; README suggests raising `cleanupPeriodDays`. Transcript copying is a possible follow-up.
- [Group libraries expose chat titles and share links] → opt-in, default off, with a dialog notice.
- [Note copies drift when edited by hand] → "Edit chat link…" rewrites all copies; hand edits to one copy's fields affect only that copy, and identity still matches by URL/ID.
- [First library writes] → single-module confinement, scoped lint exception, SECURITY.md update.

## Migration Plan

No data migration: the plugin has never written to the library. Ship order inside this change: pure parsing + note store + dialog/menus (usable manual linking) → Claude Code start → desktop/browser start → claude.ai pane (behind its spikes). Rollback = disable the plugin; chat notes are ordinary Zotero notes and remain readable without it.

## Open Questions

- Exact `codex resume` argument forms (spike S4) — affects only parsing patterns.
- Whether `claude://claude.ai/project/<id>` opens a project in the desktop app (spike S3); if not, the desktop choice opens a plain new chat when a project is set.
