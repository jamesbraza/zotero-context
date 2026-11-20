/**
 * Pure helpers for starting a chat about a paper (spec: chat-start): intro
 * text, the Claude Code launch command, its session name, and claude.ai
 * project URLs. Commands target POSIX shells (bash/zsh on macOS, Linux, WSL).
 */
import { shellQuote } from "./chat-link";
import type { PaperInfo } from "./provenance";

function citation(info: PaperInfo): string {
  return `"${info.title}" (${info.creatorSummary}${
    info.year ? ` ${info.year}` : ""
  })`;
}

/** A heading that publisher metadata sometimes leaves at the start of the
 * abstract ("Abstract\n    We present…", "ABSTRACT. We…"). Only a label
 * followed by punctuation or a line break counts, so an abstract that opens
 * with the word itself ("Abstract reasoning is…") is left alone. */
const ABSTRACT_LABEL = /^\s*(?:abstract|summary)\s*(?:[:.\-–—]\s*|\n\s*)/i;

/**
 * Tidy an abstract for chat text: drop a leading "Abstract"/"Summary"
 * heading, collapse layout whitespace (line breaks and indentation) to
 * single spaces, and keep blank-line paragraph breaks.
 */
export function cleanAbstract(raw: string): string {
  const unlabeled = raw.replace(ABSTRACT_LABEL, "");
  const text = unlabeled.trim() ? unlabeled : raw;
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** The opening message for a chat where the PDF is attached alongside. */
export function composeIntro(info: PaperInfo, abstract: string): string {
  const lines = [
    `I'm reading ${citation(info)} — the PDF is attached; please treat it as the source of truth for this discussion.`,
  ];
  const cleaned = cleanAbstract(abstract);
  if (cleaned) lines.push("", `Abstract: ${cleaned}`);
  return lines.join("\n");
}

/** The opening message for a Claude Code session, which reads the PDF from
 * disk (or through the MCP server when it's on) instead of an attachment. */
export function composeClaudeCodeIntro(
  info: PaperInfo,
  abstract: string,
  pdfPath: string | null,
  mcpPaperId?: string,
): string {
  const lines = [`I'm reading ${citation(info)}.`];
  if (pdfPath) {
    const mcp = mcpPaperId
      ? `, or use the zotero-context MCP tools (get_paper, fetch_pdf) with paper ID ${mcpPaperId}`
      : "";
    lines.push(
      `Its PDF is at ${pdfPath}${mcp}; please treat it as the source of truth for this discussion.`,
    );
  } else if (mcpPaperId) {
    lines.push(
      `Use the zotero-context MCP tool get_paper with paper ID ${mcpPaperId} for its details.`,
    );
  }
  const cleaned = cleanAbstract(abstract);
  if (cleaned) lines.push("", `Abstract: ${cleaned}`);
  return lines.join("\n");
}

/** A short session name like `vaswani-2017`, from the first author and year. */
export function sessionNameFor(info: PaperInfo): string {
  const surname = info.creatorSummary.trim().split(/[\s,]+/)[0] ?? "";
  const slug = surname
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return [slug || "paper", info.year].filter(Boolean).join("-");
}

/** `claude --session-id <uuid> -n <name> <intro>`, quoted for POSIX shells. */
export function claudeCodeCommand(
  sessionId: string,
  name: string,
  intro: string,
): string {
  return `claude --session-id ${sessionId} -n ${shellQuote(name)} ${shellQuote(intro)}`;
}

/**
 * Resume a Claude Code session, or start it under the same ID if it never
 * ran (the first command may never have been pasted). `claude --resume` on an
 * unknown ID exits 1 ("No conversation found with session ID"), verified with
 * Claude Code 2.1.x on 2026-11-20, so `||` falls through to starting it.
 */
export function claudeCodeResumeOrStart(
  sessionId: string,
  name: string,
  intro: string,
): string {
  return `claude --resume ${sessionId} || ${claudeCodeCommand(sessionId, name, intro)}`;
}

const PROJECT_RE =
  /^https?:\/\/claude\.ai\/project\/([0-9a-f-]{8,}|[\w-]+)\/?(?:[?#].*)?$/i;

/** Where a new claude.ai chat opens: a project when one is configured. */
export function newChatUrls(projectUrl: string): {
  web: string;
  desktop: string;
} {
  const id = PROJECT_RE.exec(projectUrl.trim())?.[1];
  const path = id ? `project/${id}` : "new";
  return {
    web: `https://claude.ai/${path}`,
    desktop: `claude://claude.ai/${path}`,
  };
}
