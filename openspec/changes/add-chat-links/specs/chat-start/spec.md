# chat-start

## Purpose

Lets the paper intro and a New chat button start a chat about a paper in the user's usual chat tool and, where possible, link that chat to the paper with no extra step.

## ADDED Requirements

### Requirement: Preferred chat setting

The plugin SHALL provide a "Preferred chat" setting with four choices — Claude Code, Claude desktop app, claude.ai in your browser, claude.ai in Zotero — that decides what starting a chat does.

#### Scenario: Changing the preferred chat

- **WHEN** the user switches Preferred chat from claude.ai in your browser to Claude Code
- **THEN** the next paper intro follows the Claude Code behavior

### Requirement: Project setting for claude.ai choices

The plugin SHALL provide an optional "Start new chats in project" setting accepting a claude.ai project URL. When set, starting a chat with any claude.ai choice SHALL open that project instead of a plain new chat. The setting SHALL NOT affect Claude Code.

#### Scenario: Desktop app with a project

- **WHEN** Preferred chat is Claude desktop app and a project URL is set
- **THEN** starting a chat opens that project in the desktop app

#### Scenario: Claude Code ignores the project

- **WHEN** Preferred chat is Claude Code and a project URL is set
- **THEN** the copied command contains no project reference

### Requirement: Start-chat entry points

Starting a chat SHALL be available from the paper intro hotkey (`Ctrl+Alt+I`) and from a New chat button in the reader toolbar, both acting on the focused paper.

#### Scenario: Toolbar button

- **WHEN** the user clicks New chat in a reader tab
- **THEN** the plugin starts a chat for that tab's paper exactly as the intro hotkey would

### Requirement: Claude Code start links immediately

With Preferred chat set to Claude Code, starting a chat SHALL generate a new session UUID, link it to the paper at once, and copy a command of the form `claude --session-id <uuid> -n "<name>" "<intro>"`. The plugin SHALL NOT launch a terminal or any other program.

#### Scenario: Claude Code intro

- **WHEN** the user presses the intro hotkey on a paper with Preferred chat set to Claude Code
- **THEN** the paper gains a Claude Code chat note whose session ID matches the one in the copied command, and running `claude --resume <that id>` later reopens the session

### Requirement: Claude Code intro carries the PDF location

The Claude Code intro text SHALL include the paper's citation, abstract when available, and the local PDF path. When the MCP server is enabled it SHALL also tell the model which zotero-context tools serve the paper.

#### Scenario: MCP enabled

- **WHEN** the MCP server is on and a Claude Code intro is started
- **THEN** the intro names the paper's ID for the zotero-context tools in addition to the PDF path

### Requirement: Desktop and browser start opens a new chat

With Preferred chat set to Claude desktop app or claude.ai in your browser, starting a chat SHALL perform the clipboard paper intro and open a new chat (or the configured project) in that app. These chats SHALL be linked manually.

#### Scenario: Desktop app

- **WHEN** Preferred chat is Claude desktop app and the user presses the intro hotkey
- **THEN** the PDF is placed on the clipboard as today, the desktop app opens on a new chat, and no chat note is written

### Requirement: Auto-linking can be turned off

A "Link chats when starting an intro" setting (default on) SHALL control whether starting a chat writes chat notes. When off, starting a chat SHALL behave the same except that nothing is written.

#### Scenario: Auto-linking off with Claude Code

- **WHEN** the setting is off and a Claude Code intro is started
- **THEN** the command is still copied, and no chat note is written

### Requirement: Auto-linking respects group-library opt-in

Starting a chat on a paper in a group library SHALL NOT write a chat note unless linking in group libraries is enabled; the rest of the start behavior SHALL proceed.

#### Scenario: Group paper with group linking off

- **WHEN** a Claude Code intro is started on a group-library paper and group linking is off
- **THEN** the command is copied and no note is written
