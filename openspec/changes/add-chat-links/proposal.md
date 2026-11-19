# Proposal: add-chat-links

## Why

After reading a paper with an AI, the conversation is the most valuable trace of that reading, yet nothing ties it back to the paper: weeks later the reader cannot find which claude.ai chat or Claude Code session discussed which paper. Existing work (AI Chat Referencing) makes chats citable standalone items and never connects them to papers. Linking should cost nothing extra: the paper intro already starts the chat, so it can also record it.

## What Changes

- Add **chat links**: a child note under each paper a chat discussed, holding the chat's URL (claude.ai, claude.ai/code, ChatGPT, Codex cloud, any http(s)) or local CLI session (Claude Code incl. Claudian, Codex), tagged `zotero-context/chat`. A chat covering several papers gets one copy per paper, connected through Zotero's native Related.
- Add a **Preferred chat** setting (Claude Code / Claude desktop app / claude.ai in your browser / claude.ai in Zotero) plus an optional "Start new chats in project" claude.ai project URL, which decides what the paper intro does.
- Make the **paper intro** (`Ctrl+Alt+I`) and a new reader-toolbar **New chat** button start a chat and link it:
  - Claude Code: Zotero mints the session UUID, writes the note at once, and copies a `claude --session-id …` command.
  - Claude desktop / browser: today's clipboard intro, plus opening the new-chat page; linking is manual.
  - claude.ai in Zotero: see next bullet.
- Add **claude.ai in Zotero**: claude.ai in a side pane beside the PDF in the reader; the plugin fills the chat box (PDF + intro) and links the chat when it gets its URL.
- Add a manual **Link chat…** dialog on papers (paste a URL / session ID / `claude --resume …` / `codex resume …` / name, or pick a chat already in the library), and chat-note actions: **Also link to…**, **Edit chat link…**, **Copy resume command**, **Open chat link**.
- Add **group-library opt-in**: no chat notes are written in group libraries unless the user enables it.
- Narrow the plugin's "no library writes" invariant: grabs stay ephemeral; the only writes are chat-link notes, their tag, and Related links among them.
- A Claude Code intro admits its paper to the MCP server's retrieval scope. The MCP server stays read-only; no write tool is added.

Out of scope: Zotero Connector capture, userscripts, data-export import, clipboard watching, reading `~/.claude`, launching terminals, `claude --desktop`, copying transcripts, citable chat items, an MCP write tool.

## Capabilities

### New Capabilities

- `chat-links`: the chat-note storage model (one copy per paper, Related, tag, labeled fields), link kinds and parsing, duplicate handling, the Link chat dialog, chat-note actions, edit propagation, and group-library opt-in.
- `chat-start`: the Preferred chat and project settings, and how the paper intro and New chat button start and auto-link a chat for each choice.
- `chat-pane`: claude.ai hosted in the reader's side pane — opening it, filling the chat box, and linking the chat once it has a URL.

### Modified Capabilities

- `mcp-delivery` (introduced by in-flight `add-context-ferry`): papers introduced through a Claude Code intro join the retrieval scope alongside grabbed papers.

## Impact

- Code: `src/modules/paper-intro.ts` (branches on Preferred chat), `src/core/trail.ts` (admit a paper to scope), new `src/modules/chat-links/` (store, parse, dialog, menus), new `src/adapter/chat-pane.ts`, `src/modules/grab-mode.ts`-style toolbar button, `src/hooks.ts` registration.
- Zotero APIs: first library writes (notes, tags, Related) confined to one module with a scoped eslint exception; first item context menus (`Zotero.MenuManager`); first remote web content hosted inside the reader.
- Settings: `addon/prefs.js`, `addon/content/preferences.xhtml`, locale `.ftl` files.
- Docs: `SECURITY.md` (write exception, claude.ai pane, MCP scope), `README.md`, `openspec/config.yaml` invariant.
- Release: gates the v0.1.0 tag (`add-context-ferry` task 8.3).
