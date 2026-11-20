# chat-pane Specification

## Purpose

Hosts claude.ai in a side pane beside the PDF in Zotero's reader, so a chat about a paper can start with zero pasting and be linked to the paper automatically.

## Requirements

### Requirement: claude.ai in a reader side pane

With Preferred chat set to claude.ai in Zotero, the reader SHALL be able to show claude.ai in a side pane beside the PDF. The pane SHALL load claude.ai as unprivileged web content with no access to Zotero internals, and the user's claude.ai sign-in SHALL persist across Zotero restarts.

#### Scenario: Signing in once

- **WHEN** the user signs in to claude.ai in the pane and later restarts Zotero
- **THEN** the pane opens already signed in

### Requirement: Pane opens only when asked

The pane SHALL stay closed when a paper is opened. It SHALL open only when the user starts a chat (intro hotkey or New chat button) or chooses "Open chat link" on a claude.ai chat note.

#### Scenario: Opening a paper with linked chats

- **WHEN** the user opens a paper that already has linked claude.ai chats
- **THEN** the pane stays closed and no page is loaded

#### Scenario: Reopening a linked chat

- **WHEN** the user chooses "Open chat link" on a claude.ai chat note with Preferred chat set to claude.ai in Zotero
- **THEN** the pane opens showing that chat

### Requirement: Plugin fills the chat box

Starting a chat in the pane SHALL open a new chat (or the configured project) and place the paper's PDF and intro text into claude.ai's chat box without the user pasting. If filling fails, the plugin SHALL fall back to the clipboard paper intro.

#### Scenario: Zero-paste start

- **WHEN** the user presses the intro hotkey with Preferred chat set to claude.ai in Zotero
- **THEN** the pane shows a new chat with the PDF attached and the intro text in the chat box, ready to send

#### Scenario: claude.ai page changed

- **WHEN** the plugin cannot find claude.ai's chat box
- **THEN** the PDF and intro are placed on the clipboard as in the clipboard paper intro, and the user is told to paste

### Requirement: Pane links its first chat

A pane chat started for a paper SHALL be linked to that paper when the pane first reaches a `claude.ai/chat/<uuid>` URL, using the chat's title when available. Later navigation in the pane SHALL NOT create further links.

#### Scenario: Sending the first message

- **WHEN** the user sends the first message in a pane chat started for paper A
- **THEN** paper A gains a claude.ai chat note for the new chat URL

#### Scenario: Switching chats in the pane

- **WHEN** after that the user navigates the pane to a different claude.ai chat
- **THEN** no new chat note is written

#### Scenario: Abandoned start

- **WHEN** the user starts a pane chat but never sends a message
- **THEN** no chat note is written
