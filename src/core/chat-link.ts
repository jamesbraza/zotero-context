/**
 * Chat-link parsing and identity (spec: chat-links "Accepted link inputs",
 * "Format-only validation", "Same chat is never duplicated"). Pure: format
 * checks only — nothing here reads chat-tool data or contacts a service.
 */

/** Web chat services recognized by URL. */
type WebTool = "claude" | "chatgpt" | "codex" | "web";

/**
 * A CLI agent harness and how it resumes one session. Syntax verified
 * 2026-11-19 against each harness's source at a release tag, or its official
 * docs/changelog when closed source (see add-chat-links design.md).
 */
export interface Harness {
  id: string;
  label: string;
  /** Matches a resume command; group 1 is the session ID or name. */
  pattern: RegExp;
  resume: (target: string) => string;
  /** Whether the harness resumes by session name as well as by ID. */
  acceptsNames: boolean;
  /** Values that don't name one session (e.g. "latest"). */
  rejects?: RegExp;
}

export const HARNESSES: readonly Harness[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    pattern: /^claude\s+(?:--resume|-r)(?:[=\s]+(.*))?$/,
    resume: (t) => `claude --resume ${t}`,
    acceptsNames: true,
  },
  {
    id: "codex",
    label: "Codex",
    pattern: /^codex\s+(?:exec\s+)?resume(?:\s+(?:--\s+)?(.*))?$/,
    resume: (t) => `codex resume ${t}`,
    acceptsNames: true,
    rejects: /^--last$/,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    pattern: /^gemini\s+(?:--resume|-r)(?:[=\s]+(.*))?$/,
    resume: (t) => `gemini --resume ${t}`,
    acceptsNames: false,
    rejects: /^(?:latest|\d+)$/,
  },
  {
    id: "qwen",
    label: "Qwen Code",
    pattern: /^qwen\s+(?:--resume|-r)(?:[=\s]+(.*))?$/,
    resume: (t) => `qwen --resume ${t}`,
    acceptsNames: true,
  },
  {
    id: "copilot",
    label: "Copilot CLI",
    pattern: /^copilot\s+--resume(?:[=\s]+(.*))?$/,
    resume: (t) => `copilot --resume ${t}`,
    acceptsNames: true,
  },
  {
    id: "opencode",
    label: "OpenCode",
    pattern: /^opencode(?:\s+run)?\s+(?:-s|--session)(?:[=\s]+(\S+).*)?$/,
    resume: (t) => `opencode -s ${t}`,
    acceptsNames: false,
  },
  {
    id: "pi",
    label: "Pi",
    pattern: /^pi\s+--session(?:[=\s]+(.*))?$/,
    resume: (t) => `pi --session ${t}`,
    acceptsNames: false,
  },
  {
    id: "cursor",
    label: "Cursor CLI",
    pattern: /^(?:cursor-)?agent\s+--resume(?:[=\s]+(.*))?$/,
    resume: (t) => `agent --resume=${t}`,
    acceptsNames: false,
  },
  {
    id: "grok",
    label: "Grok CLI",
    pattern: /^grok\s+(?:-s|--session)(?:[=\s]+(.*))?$/,
    resume: (t) => `grok -s ${t}`,
    acceptsNames: false,
    rejects: /^latest$/,
  },
  {
    id: "amp",
    label: "Amp",
    pattern: /^amp\s+threads\s+continue(?:\s+(.*))?$/,
    resume: (t) => `amp threads continue ${t}`,
    acceptsNames: false,
  },
];

/** The harness choice for anything not in HARNESSES. */
export const OTHER_HARNESS = "other";

const HARNESS_BINARIES =
  /^(?:claude|codex|gemini|qwen|copilot|opencode|pi|cursor-agent|agent|grok|amp)$/;

function harnessById(id: string): Harness | undefined {
  return HARNESSES.find((h) => h.id === id);
}

export type ChatRef =
  | { kind: "web"; tool: WebTool; url: string }
  | {
      kind: "session";
      /** A HARNESSES id, or OTHER_HARNESS. */
      harness: string;
      /** The harness's name, for OTHER_HARNESS only. */
      label?: string | undefined;
      sessionId?: string | undefined;
      name?: string | undefined;
      /** Resume command as given, for OTHER_HARNESS only. */
      command?: string | undefined;
    };

export type ParseResult =
  | {
      ok: true;
      ref: ChatRef;
      /** A bare ID or name: the harness is a guess (Claude Code), and the
       * dialog asks which harness it came from. */
      bare?: boolean | undefined;
    }
  | { ok: false; error: string };

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

/** A session of a known harness, from the ID or name the user gave. */
function sessionRef(harnessId: string, value: string): ParseResult {
  const harness = harnessById(harnessId);
  const v = unquote(value.trim());
  if (!harness) return { ok: false, error: `Unknown harness "${harnessId}"` };
  if (!v) return { ok: false, error: "Missing session ID or name" };
  if (v.startsWith("-") || harness.rejects?.test(v)) {
    return {
      ok: false,
      error: `"${v}" doesn't name one session; give its ID`,
    };
  }
  if (isUuid(v)) {
    return {
      ok: true,
      ref: { kind: "session", harness: harness.id, sessionId: v.toLowerCase() },
    };
  }
  // Harnesses without named sessions have non-UUID IDs (ses_…, T-…, hex)
  return harness.acceptsNames
    ? { ok: true, ref: { kind: "session", harness: harness.id, name: v } }
    : { ok: true, ref: { kind: "session", harness: harness.id, sessionId: v } };
}

/** A session of a harness not in HARNESSES ("Other"). */
function otherSessionRef(
  label: string,
  value: string,
  command?: string,
): ParseResult {
  const name = label.trim();
  const v = unquote(value.trim());
  if (!name) return { ok: false, error: "Name the harness" };
  if (!v) return { ok: false, error: "Missing session ID or name" };
  const cmd = command?.trim() || undefined;
  const id = isUuid(v) ? v.toLowerCase() : v;
  return {
    ok: true,
    ref: {
      kind: "session",
      harness: OTHER_HARNESS,
      label: name,
      sessionId: id,
      command: cmd,
    },
  };
}

function webTool(url: URL): WebTool {
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

  // Resume commands, e.g. the line a harness prints on exit
  for (const harness of HARNESSES) {
    const m = harness.pattern.exec(text);
    if (m) return sessionRef(harness.id, m[1] ?? "");
  }

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

  const first = text.split(/\s+/)[0] ?? "";
  if (/\s/.test(text) && HARNESS_BINARIES.test(first)) {
    return {
      ok: false,
      error: "That command doesn't resume one session; copy its resume command",
    };
  }
  if (/^(?:www\.)?[\w-]+(?:\.[\w-]+)+\//.test(text)) {
    return { ok: false, error: "Links need https:// in front" };
  }
  if (text.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Too long to be a session ID or name" };
  }
  const result = sessionRef("claude-code", text);
  return result.ok ? { ...result, bare: true } : result;
}

/** Re-read a bare ID or name as belonging to another harness. */
export function withHarness(
  ref: ChatRef,
  harnessId: string,
  other?: { label: string; command?: string },
): ParseResult {
  if (ref.kind !== "session") return { ok: true, ref };
  const value = ref.sessionId ?? ref.name ?? "";
  return harnessId === OTHER_HARNESS
    ? otherSessionRef(other?.label ?? "", value, other?.command)
    : sessionRef(harnessId, value);
}

/** Stable key for "the same chat" (design D2). */
export function chatIdentity(ref: ChatRef): string {
  if (ref.kind === "session") {
    const key =
      ref.harness === OTHER_HARNESS
        ? `${OTHER_HARNESS}/${(ref.label ?? "").toLowerCase()}`
        : ref.harness;
    return ref.sessionId
      ? `${key}:${isUuid(ref.sessionId) ? ref.sessionId.toLowerCase() : ref.sessionId}`
      : `${key}:name:${ref.name ?? ""}`;
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

const WEB_LABELS: Record<WebTool, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  codex: "Codex",
  web: "AI",
};

/** Display name of the chat's tool or harness, e.g. "Claude Code". */
export function chatLabel(ref: ChatRef): string {
  if (ref.kind === "web") return WEB_LABELS[ref.tool];
  if (ref.harness === OTHER_HARNESS) return ref.label ?? "Agent";
  return harnessById(ref.harness)?.label ?? ref.harness;
}

/** Shell-quote a session name for a copied command. */
export function shellQuote(value: string): string {
  return /^[\w.:@/-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The command that reopens a CLI session, or null when unknown. */
export function resumeCommand(ref: ChatRef): string | null {
  if (ref.kind !== "session") return null;
  if (ref.harness === OTHER_HARNESS) return ref.command ?? null;
  const harness = harnessById(ref.harness);
  const target = ref.sessionId ?? (ref.name ? shellQuote(ref.name) : null);
  return harness && target ? harness.resume(target) : null;
}

/** Group-library opt-in rule (spec: "Group libraries are opt-in"). */
export function groupWriteAllowed(
  libraryType: "user" | "group" | "feed",
  groupsEnabled: boolean,
): boolean {
  if (libraryType === "feed") return false;
  return libraryType === "user" || groupsEnabled;
}
