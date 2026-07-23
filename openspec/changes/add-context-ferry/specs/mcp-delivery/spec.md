# mcp-delivery

## ADDED Requirements

### Requirement: In-process MCP server

The plugin SHALL run a Model Context Protocol server (Streamable HTTP) inside Zotero on a configurable localhost port, starting with the plugin and stopping cleanly on plugin shutdown or disable. If the port cannot be bound, the server SHALL disable itself gracefully without affecting any other capability.

#### Scenario: Port conflict

- **WHEN** the configured port is already in use at startup
- **THEN** the MCP server disables itself, surfaces a non-blocking notice, and clipboard delivery
  remains fully functional

### Requirement: Grab-trail tools

The server SHALL expose the grab trail via MCP tools (not resources): a tool listing grabs (filterable by paper and recency) and a tool returning a single grab's full payload, with image payloads returned as base64 content.

#### Scenario: Chat pulls recent grabs

- **WHEN** an MCP client calls the list-grabs tool after the user has made grabs
- **THEN** the tool returns the session's grabs in order with provenance metadata, sufficient for the model to reference them without any paste

### Requirement: Paper and PDF retrieval tools

The server SHALL expose tools returning a trail paper's metadata/abstract and its PDF attachment (as base64 content and/or a local file path, per rendering profile), enabling a chat to ingest the paper without manual download/upload.

#### Scenario: Discussing the paper without uploading it

- **WHEN** the user tells an MCP-connected chat to discuss the paper they have been grabbing from, and the model calls the fetch-PDF tool
- **THEN** the tool returns the PDF for the paper identified from the grab trail

### Requirement: Trail is the identity, not reader state

The server SHALL NOT expose a "currently open/focused document" pointer as the primary identity; papers are identified through the grab trail. Any reader-state information exposed SHALL be advisory only.

#### Scenario: Two tabs open

- **WHEN** the user has two reader tabs open and the model asks which paper is under discussion
- **THEN** tool responses identify papers by the grabs made, not by which tab currently has focus
