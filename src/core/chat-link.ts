/**
 * Chat-link parsing and identity (spec: chat-links "Accepted link inputs",
 * "Format-only validation", "Same chat is never duplicated"). Pure: format
 * checks only — nothing here reads chat-tool data or contacts a service.
 */

export type ChatTool = "claude" | "claude-code" | "chatgpt" | "codex" | "web";
type SessionTool = "claude-code" | "codex";

export type ChatRef =
  | { kind: "web"; tool: Exclude<ChatTool, SessionTool> | "codex"; url: string }
  | {
      kind: "session";
      tool: SessionTool;
      sessionId?: string | undefined;
      name?: string | undefined;
    };

export type ParseResult =
  { ok: true; ref: ChatRef } | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;

function isUuid(text: string): boolean {
  return UUID_RE.test(text);
}

/** Strip one layer of matching single or double quotes. */
function unquote(text: string): string {
  const m = /^(["'])(.*)\1$/s.exec(text);
  return m?.[2] ?? text;
}

function sessionRef(tool: SessionTool, value: string): ParseResult {
  const v = unquote(value.trim());
  if (!v) return { ok: false, error: "Missing session ID or name" };
  if (v.startsWith("-")) {
    return {
      ok: false,
      error: `"${v}" doesn't name a session; paste a session ID or name`,
    };
  }
  return isUuid(v)
    ? { ok: true, ref: { kind: "session", tool, sessionId: v.toLowerCase() } }
    : { ok: true, ref: { kind: "session", tool, name: v } };
}

function webTool(url: URL): Exclude<ChatRef, { kind: "session" }>["tool"] {
  const host = url.hostname.toLowerCase();
  if (host === "claude.ai") return "claude";
  if (host === "chatgpt.com" || host === "chat.openai.com") {
    return url.pathname.startsWith("/codex") ? "codex" : "chatgpt";
  }
  return "web";
}

/** Parse what the user pasted into "Link chat…". */
export function parseChatInput(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: "Paste a chat link or session" };
  if (/[\r\n]/.test(text)) {
    return { ok: false, error: "Paste a single link or command" };
  }

  // Resume commands, e.g. the line Claude Code prints on exit
  const claude = /^claude\s+(?:--resume|-r)(?:\s+(.*))?$/.exec(text);
  if (claude) return sessionRef("claude-code", claude[1] ?? "");
  const codex = /^codex\s+resume(?:\s+(.*))?$/.exec(text);
  if (codex) return sessionRef("codex", codex[1] ?? "");

  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, error: "Not a valid link" };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: "Only http(s) chat links are supported" };
    }
    return { ok: true, ref: { kind: "web", tool: webTool(url), url: text } };
  }

  if (isUuid(text)) return sessionRef("claude-code", text);

  if (/^(?:www\.)?[\w-]+(?:\.[\w-]+)+\//.test(text)) {
    return { ok: false, error: "Links need https:// in front" };
  }
  if (text.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Too long to be a session name" };
  }
  return sessionRef("claude-code", text);
}

/** Stable key for "the same chat" (design D2). */
export function chatIdentity(ref: ChatRef): string {
  if (ref.kind === "session") {
    return ref.sessionId
      ? `${ref.tool}:${ref.sessionId.toLowerCase()}`
      : `${ref.tool}:name:${ref.name ?? ""}`;
  }
  try {
    const url = new URL(ref.url);
    url.hash = "";
    if (ref.tool !== "web") url.search = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return ref.url;
  }
}

const TOOL_LABELS: Record<ChatTool, string> = {
  claude: "Claude",
  "claude-code": "Claude Code",
  chatgpt: "ChatGPT",
  codex: "Codex",
  web: "AI",
};

export function toolLabel(tool: ChatTool): string {
  return TOOL_LABELS[tool];
}

/** Shell-quote a session name for a copied command. */
function shellQuote(value: string): string {
  return /^[\w.:@/-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command that reopens a CLI session, or null for web chats. */
export function resumeCommand(ref: ChatRef): string | null {
  if (ref.kind !== "session") return null;
  const target = ref.sessionId ?? (ref.name ? shellQuote(ref.name) : null);
  if (!target) return null;
  return ref.tool === "claude-code"
    ? `claude --resume ${target}`
    : `codex resume ${target}`;
}

/** Group-library opt-in rule (spec: "Group libraries are opt-in"). */
export function groupWriteAllowed(
  libraryType: "user" | "group" | "feed",
  groupsEnabled: boolean,
): boolean {
  if (libraryType === "feed") return false;
  return libraryType === "user" || groupsEnabled;
}
