# mcp-delivery

## ADDED Requirements

### Requirement: Introduced papers join retrieval scope

A paper for which the user starts a Claude Code chat SHALL join the MCP server's retrieval scope for the session, alongside papers present in the grab trail. Clearing the trail SHALL also clear introduced papers. The server SHALL remain read-only: no tool writes to the library.

#### Scenario: Fetching an introduced paper

- **WHEN** the user starts a Claude Code chat for a paper they have not grabbed from, and the model calls the fetch-PDF tool for it
- **THEN** the tool serves the paper's PDF path

#### Scenario: Trail cleared

- **WHEN** the user clears the trail after introducing a paper
- **THEN** retrieval tools refuse that paper again until it is grabbed or introduced
