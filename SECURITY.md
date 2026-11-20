# Security

Zotero Context touches three things:
the PDF reader (to capture the text and figures you select),
the operating system clipboard,
and an optional local HTTP server that AI tools supporting MCP can connect to.
This document describes what the plugin does with your data,
what protects the local server,
which risks are knowingly accepted,
and how to report a vulnerability.

## What this plugin does not do

- No chat UI of its own, no API keys, no calls to AI services.
- No internet access of its own:
  the plugin never makes outbound network connections.
  Its only network component is the optional MCP server,
  which listens on your own machine (127.0.0.1)
  and is unreachable from other machines.
  The one exception is a choice you make:
  with Preferred chat set to "claude.ai in Zotero",
  Zotero shows the claude.ai website in a pane beside the PDF,
  the same way a browser tab would.
- No changes to your Zotero library beyond chat links you create:
  captured content lives in memory only and is gone when Zotero closes.
  The only library writes are chat-link notes you create on purpose
  (a child note under each paper a chat discussed),
  their `zotero-context/chat` tag, and Related links among copies of the same chat;
  annotations and the papers themselves are never touched.
  Chat links are never written to group libraries unless you turn that on in settings,
  since group members would see them.
  An automated check confines library-write calls to that one module.

## The claude.ai pane

Only used when Preferred chat is "claude.ai in Zotero",
and opened only when you start or open a chat.

- **Ordinary, unprivileged web content.**
  The page runs in its own sandboxed content process (Firefox site isolation)
  with claude.ai's own web permissions, so it cannot reach Zotero, your library,
  or your files.
- **What the plugin does to the page:**
  it attaches the paper's PDF and types the intro into claude.ai's chat box,
  through code that runs with the page's own permissions (nothing privileged runs in the page),
  and it reads the chat's address and title to link the chat to the paper.
  It sends nothing anywhere itself; you press Send.
- **Sign-in** is stored as claude.ai cookies in Zotero's profile,
  like a browser's, and stays until claude.ai expires it.

## Where your data goes

- **Clipboard**: captured text, captured images,
  and (via the paper-intro hotkey) the paper's PDF file
  are placed on the system clipboard.
  Anything on the clipboard can be read by other applications on your computer;
  delivering through the clipboard is the point of the feature.
- **MCP server** (only when you enable it):
  captured content, paper metadata and abstracts,
  and the file paths of papers' PDFs are served to programs on the same machine
  that present the correct access token.

## MCP server protections

The server is off by default and enabled per profile in Settings.
Its design follows the [MCP transport security guidance][mcp-security].
When it is on:

- **Local connections only.**
  The server listens on 127.0.0.1,
  so nothing outside your machine can connect to it.
  Requests addressed to any hostname other than your own machine are rejected,
  which blocks websites that try to reach the server
  by pointing an attacker-controlled domain name at your computer.
- **Websites cannot use your browser against it.**
  Requests that arrive from a web page (identified by the browser's Origin header)
  are refused,
  so a page you visit cannot script calls to the server.
- **Every request needs the access token.**
  A 192-bit token is generated the first time you enable the server,
  and every request must present it.
  The token comparison runs in constant time,
  and a stored token that is missing or malformed is regenerated,
  never used as-is.
- **Only papers you captured from, or started a Claude Code chat about, are reachable.**
  The server can return content and PDFs only for papers
  you grabbed from, or started a Claude Code chat about, during this session.
  It has no way to list or read the rest of your Zotero library or your files,
  and clearing the session trail (`Ctrl+Alt+X`) revokes access
  to everything captured so far.
- **Oversized requests are rejected** before any processing.
- The `fetch_pdf` tool returns the PDF's location on disk
  and expects the connecting program to read the file itself.
  This is deliberate:
  that program already runs on your machine with your permissions.

## Accepted risks

Trade-offs made knowingly; none are considered vulnerabilities:

- The access token is stored unencrypted in your Zotero profile
  (visible in Zotero's Config Editor).
  Anything that can read your profile can read the token;
  Zotero keeps its own credentials at the same level of protection.
- The copy-ready setup command embeds the token,
  so running it leaves the token in your shell history.
  Use the JSON config option instead if that matters to you.
  To rotate the token, delete it in the Config Editor:
  a new one is generated the next time the server starts or receives a request,
  and connected programs must be reconfigured.
- The stored token is managed automatically:
  a cleared or malformed value is regenerated without asking.
- There is no lockout after failed authentication attempts.
  Guessing a 192-bit token over a local-only connection is not feasible,
  and a lockout would let any local program lock you out of your own server.
- Zotero plugins are not isolated from each other:
  they share one process and one settings store.
  A malicious co-installed plugin could read the token and everything else;
  no plugin can defend against that.

## Reporting a vulnerability

Report privately via [GitHub private vulnerability reporting][report]
(Security tab, "Report a vulnerability").
Only the latest release is supported (the project is pre-1.0).

[mcp-security]: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#security-warning
[report]: https://github.com/jamesbraza/zotero-context/security/advisories/new
