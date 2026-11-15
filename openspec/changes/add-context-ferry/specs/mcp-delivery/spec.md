# mcp-delivery

## ADDED Requirements

### Requirement: In-process MCP server, off by default

The plugin SHALL provide a Model Context Protocol server (Streamable HTTP) running inside Zotero on a configurable localhost port (default 23122), **disabled by default** and enabled via a preference. When enabled it SHALL start with the plugin and stop cleanly on plugin shutdown or disable. If the port cannot be bound, the server SHALL disable itself gracefully without affecting any other capability.

#### Scenario: Port conflict

- **WHEN** the server is enabled and the configured port is already in use at startup
- **THEN** the MCP server disables itself, surfaces a non-blocking notice and status-line explanation, and clipboard delivery remains fully functional

#### Scenario: Server not enabled

- **WHEN** the user has not enabled the MCP server
- **THEN** no socket is opened, and all other plugin capabilities function normally

### Requirement: Server status in preferences

The preferences surface SHALL show a live server status (running on port / disabled: port in use / off) alongside the enable toggle and port setting.

#### Scenario: Status reflects a port conflict

- **WHEN** the server is enabled but its configured port was already in use at startup
- **THEN** the preferences surface shows the server as disabled because the port is in use

### Requirement: Localhost-bound transport

The server SHALL bind to 127.0.0.1 only. It SHALL validate Host and Origin headers, rejecting requests with browser origins not explicitly allowed while accepting origin-less requests from native clients.

#### Scenario: DNS-rebinding attempt

- **WHEN** a request arrives with a browser Origin header not in the allowlist (e.g., from a malicious webpage resolving to 127.0.0.1)
- **THEN** the server rejects it before any tool executes

### Requirement: Bearer-token authentication

The server SHALL require a bearer token minted automatically on first enablement and persisted in a Zotero preference; requests without the correct token SHALL be rejected with 401.

#### Scenario: Missing or wrong token

- **WHEN** a request lacks the Authorization bearer token or presents an incorrect one
- **THEN** the server responds 401 and no tool executes

### Requirement: Client setup artifacts

The preferences surface SHALL render copy-ready client setup artifacts containing the token (a `claude mcp add` command and a cross-client `mcpServers` config JSON) plus the raw token for manual recovery.

#### Scenario: Connecting Claude Code

- **WHEN** the user enables the server and copies the `claude mcp add` command from the preferences surface
- **THEN** running that command registers the server with the current token, with no manual token entry

### Requirement: Grab-trail listing tool

The server SHALL expose the grab trail via MCP tools (not resources), including a tool listing grabs. Listing SHALL be asymmetric by grab kind — text grabs returned inline with full quote and provenance; image grabs as stubs (id, locator, caption, dimensions, byte size) — and filterable by paper and by a monotonic trail watermark (`since`), with the current watermark included in every response so clients can pull deltas.

#### Scenario: Chat pulls recent grabs

- **WHEN** an MCP client calls the list-grabs tool after the user has made grabs
- **THEN** the tool returns the session's grabs in order with provenance metadata — text grabs complete inline — sufficient for the model to reference them without any paste

#### Scenario: Delta pull via watermark

- **WHEN** the user makes further grabs and the client calls the list-grabs tool with `since` set to the watermark from its previous call
- **THEN** only the new grabs are returned, with the updated watermark

### Requirement: Single-grab tool

The server SHALL expose a tool returning a single grab's full payload, with image payloads returned as MCP
image content.

#### Scenario: Fetching an image grab

- **WHEN** an MCP client calls the single-grab tool with the id of an image grab from a listing stub
- **THEN** the tool returns the captured image as MCP image content

### Requirement: Paper and PDF retrieval tools

The server SHALL expose tools returning a trail paper's metadata/abstract and its PDF attachment's local file path (with size). The PDF tool serves clients with filesystem access (Claude Code); clients without it (Claude desktop) get PDFs via the clipboard paper-intro flow instead — inlining document bytes into a tool result is not offered, since even a modest PDF base64-encodes past any client's ingestible size.

#### Scenario: Discussing the paper without uploading it

- **WHEN** the user tells an MCP-connected chat to discuss the paper they have been grabbing from, and the model calls the fetch-PDF tool
- **THEN** the tool returns the PDF's local file path for the paper identified from the grab trail, and the client reads it directly

### Requirement: Trail is the identity, not reader state

The server SHALL NOT expose a "currently open/focused document" pointer as the primary identity; papers are identified through the grab trail. Any reader-state information exposed SHALL be advisory only. Retrieval tools SHALL serve only papers present in the trail — the server structurally cannot browse the wider library or filesystem.

#### Scenario: Two tabs open

- **WHEN** the user has two reader tabs open and the model asks which paper is under discussion
- **THEN** tool responses identify papers by the grabs made, not by which tab currently has focus

#### Scenario: Paper not in trail

- **WHEN** a retrieval tool is called for an item the user has not grabbed from this session
- **THEN** the tool returns an error rather than serving the item
