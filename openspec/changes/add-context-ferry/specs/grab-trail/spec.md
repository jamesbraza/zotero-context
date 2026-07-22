# grab-trail

## ADDED Requirements

### Requirement: Append-only session log of grabs

The plugin SHALL maintain an in-memory, append-only session log (the grab trail) recording every grab with its timestamp, kind (text or image), payload, and source (item, page, section when known). The trail SHALL span multiple papers and reader tabs within a session. The trail is not persisted across Zotero restarts in v0.1.

#### Scenario: Grabs from two papers accumulate

- **WHEN** the user grabs from paper A, opens cited paper B in a new tab, and grabs from B
- **THEN** the trail contains all grabs in order, each self-identifying its source paper

### Requirement: One action ferries any number of grabs

The system SHALL guarantee that the accumulated grabs of a session can reach the chat in a single user action — via the clipboard session bundle (see clipboard-delivery) or via a single MCP tool call (see mcp-delivery). Per-grab immediate delivery SHALL remain available as the floor.

#### Scenario: Session bundle in one paste

- **WHEN** the user has made several grabs and triggers the session-bundle copy action
- **THEN** one paste into the chat carries all of the session's grabs with their provenance headers, in order

### Requirement: Per-target rendering profiles

Trail content SHALL be rendered through target profiles: a rich profile (inline text + native image data, for claude.ai / Claude desktop paste) and a file-path profile (images written to files on disk with paths referenced in text, for CLI chats such as Claude Code). The active profile SHALL be user-selectable.

#### Scenario: File-path profile for a CLI chat

- **WHEN** the file-path profile is active and the user copies an image grab
- **THEN** the image is written to a stable local file and the clipboard text references that path alongside the provenance header
