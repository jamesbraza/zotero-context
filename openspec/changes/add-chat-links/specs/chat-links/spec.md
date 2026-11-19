# chat-links

## Purpose

Records which AI chats discussed which papers, as notes under each paper, so a reader can later find and reopen the conversation. For reference, not citation.

## ADDED Requirements

### Requirement: Chat link stored as a child note

A chat link SHALL be stored as a child note under the paper, tagged `zotero-context/chat`. The plugin SHALL NOT create standalone items or notes for chats, and SHALL NOT modify the paper itself.

#### Scenario: Linking a chat to a paper

- **WHEN** a chat is linked to a paper
- **THEN** a child note tagged `zotero-context/chat` appears under that paper, and no new top-level row appears in any collection or in My Library

### Requirement: One copy per paper, connected through Related

When one chat is linked to several papers, each paper SHALL get its own copy of the chat note, and all copies of that chat SHALL be connected to each other through Zotero's Related field.

#### Scenario: Chat covering two papers

- **WHEN** one chat is linked to paper A and paper B
- **THEN** A and B each have a child note for the chat, and each note lists the other in its Related section

### Requirement: Note layout

A chat note SHALL begin with a title line `<Tool> chat: <topic>`, followed by labeled fields (a `Link:` line for web chats; `Resume:` and `Session:` lines for CLI sessions; `Machine:` for CLI sessions; `Started:`), followed by space for the user's own notes. The body SHALL NOT repeat the paper's title.

#### Scenario: claude.ai chat note

- **WHEN** a claude.ai chat titled "Why multi-head beats single-head" is linked
- **THEN** the note's first line reads `Claude chat: Why multi-head beats single-head` and the body contains a clickable `Link:` to the chat URL

#### Scenario: Claude Code session note

- **WHEN** a Claude Code session with ID `888c8ed8-90a2-40ac-9a46-dcd7a8559d34` is linked
- **THEN** the note contains `Resume: claude --resume 888c8ed8-90a2-40ac-9a46-dcd7a8559d34`, a `Session:` line with the ID, and a `Machine:` line naming the computer

#### Scenario: Topic unknown

- **WHEN** a chat is linked with no title available
- **THEN** the title line falls back to `<Tool> chat · <date>`

### Requirement: The note is the source of truth

The plugin SHALL read a chat's identity and fields from the note's visible labeled fields, so the user's hand edits to those fields take effect. The plugin SHALL NOT keep a separate hidden store of chat links.

#### Scenario: Hand-corrected session ID

- **WHEN** the user edits the `Session:` line of a chat note by hand and later chooses "Copy resume command"
- **THEN** the copied command uses the edited session ID

### Requirement: Accepted link inputs

Linking SHALL accept any http(s) URL, a bare session UUID, `claude --resume <id-or-name>`, `codex resume <id>`, or a session name. claude.ai `/chat/` and `/share/` URLs, `claude.ai/code/` URLs, ChatGPT and Codex URLs, Claude Code sessions, and Codex sessions SHALL be recognized and labeled with their tool.

#### Scenario: Pasting a Claude Code exit line

- **WHEN** the user pastes `claude --resume 888c8ed8-90a2-40ac-9a46-dcd7a8559d34`
- **THEN** it is recognized as a Claude Code session with that ID

#### Scenario: Pasting a share link

- **WHEN** the user pastes `https://claude.ai/share/0bd3a44d-4a35-45d7-b3e0-bf93e6352988`
- **THEN** it is recognized as a claude.ai chat and stored as that URL

#### Scenario: Unrecognized but valid URL

- **WHEN** the user pastes an https URL from an unknown chat service
- **THEN** it is accepted and stored as a generic web chat link

### Requirement: Format-only validation

Link inputs SHALL be validated by format only. The plugin SHALL NOT read local chat-tool data (such as `~/.claude` or `~/.codex`) or contact chat services to validate a link. Invalid formats SHALL block linking with an inline message.

#### Scenario: Malformed input

- **WHEN** the user enters text that is neither an http(s) URL, a UUID, a recognized resume command, nor a usable name
- **THEN** the dialog shows an inline error and the Link button stays disabled

#### Scenario: Session from another machine

- **WHEN** the user pastes a well-formed Claude Code session ID that does not exist on this machine
- **THEN** the link is accepted without any existence check

### Requirement: Same chat is never duplicated

A chat SHALL be identified by its normalized URL or session ID. Linking a chat to a paper that already has it SHALL change nothing, and pasting a chat already linked elsewhere SHALL be treated as that same chat.

#### Scenario: Re-linking the same chat

- **WHEN** the user links a chat URL to a paper that already has a note for that URL
- **THEN** no second note is created

#### Scenario: Pasting a chat linked elsewhere

- **WHEN** the user pastes, for paper B, a URL already linked to paper A
- **THEN** B gets a copy of the existing chat note (same title and fields), connected to A's copy through Related

### Requirement: Link chat dialog

Selected papers SHALL offer a "Link chat…" action opening a dialog with a paste field, an optional Title field, and a list of chats already linked in the library (most recent first). Choosing Link SHALL link the chat to every selected paper.

#### Scenario: Linking an existing chat to another paper

- **WHEN** the user selects paper B, opens "Link chat…", and picks a listed chat already linked to paper A
- **THEN** B gets a copy of that chat note, connected through Related to A's copy

#### Scenario: Cancel

- **WHEN** the user cancels the dialog
- **THEN** nothing is written to the library

### Requirement: Chat note actions

A chat note SHALL offer: "Also link to…" (choose papers with Zotero's item picker), "Edit chat link…", "Copy resume command" (CLI sessions), and "Open chat link" (web chats).

#### Scenario: Also link to

- **WHEN** the user chooses "Also link to…" on a chat note and picks two papers
- **THEN** both papers get a copy of the chat note, all copies connected through Related

#### Scenario: Copy resume command

- **WHEN** the user chooses "Copy resume command" on a Claude Code chat note
- **THEN** the clipboard holds `claude --resume <session-id>`, and no program is launched

### Requirement: Edits propagate to every copy

"Edit chat link…" SHALL update the title line and labeled fields in every copy of that chat, and SHALL leave each copy's user-notes area unchanged.

#### Scenario: Retitling a chat linked to two papers

- **WHEN** the user edits the title of a chat linked to papers A and B
- **THEN** both copies show the new title, and the personal notes in each copy are unchanged

### Requirement: Group libraries are opt-in

Chat notes SHALL NOT be written to papers in group libraries unless the "Link chats in group libraries" setting is enabled (default off). While enabled, the Link chat dialog SHALL state that group members will see the link.

#### Scenario: Group paper with setting off

- **WHEN** the user opens "Link chat…" on a paper in a group library with the setting off
- **THEN** the dialog explains that linking in group libraries is off and how to enable it, and nothing is written

#### Scenario: Group paper with setting on

- **WHEN** the setting is on and the user links a chat to a group-library paper
- **THEN** the dialog shows a one-line notice that group members will see the link, and the note is written

### Requirement: Narrow library-write scope

The plugin's library writes SHALL be limited to chat-link notes, their `zotero-context/chat` tag, and Related links among them, each made only as a result of a user action described in this change. Grabs SHALL remain ephemeral.

#### Scenario: Grabbing after this change

- **WHEN** the user grabs text and figures from a paper
- **THEN** no annotation, note, or other library change results from the grabs
