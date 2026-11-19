/**
 * Chat-note HTML (spec: chat-links "Note layout", "The note is the source of
 * truth", "Edits propagate to every copy"). The note body is the record:
 * an <h1> title, then one <p> per labeled field, then the user's own notes,
 * which rewrites carry over untouched (design D2).
 */
import {
  type ChatRef,
  parseChatInput,
  resumeCommand,
  toolLabel,
} from "./chat-link";

export interface ChatNoteFields {
  ref: ChatRef;
  /** The chat's topic; empty falls back to `<Tool> chat · <started>`. */
  topic: string;
  /** YYYY-MM-DD */
  started: string;
  /** Computer a CLI session lives on (sessions only). */
  machine?: string | undefined;
}

export interface ParsedChatNote {
  fields: ChatNoteFields;
  /** Everything after the field block, as HTML. */
  userNotesHtml: string;
}

const SCHEMA_VERSION = 9;
const FIELD_RE = /^(Link|Resume|Session|Name|Machine|Started):\s*(.*)$/s;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function chatNoteTitle(fields: ChatNoteFields): string {
  const label = toolLabel(fields.ref.tool);
  const topic = fields.topic.trim();
  return topic
    ? `${label} chat: ${topic}`
    : `${label} chat · ${fields.started}`;
}

function fieldParagraphs(fields: ChatNoteFields): string[] {
  const { ref } = fields;
  const out: string[] = [];
  if (ref.kind === "web") {
    out.push(`<p>Link: <a href="${esc(ref.url)}">${esc(ref.url)}</a></p>`);
  } else {
    const cmd = resumeCommand(ref);
    if (cmd) out.push(`<p>Resume: <code>${esc(cmd)}</code></p>`);
    if (ref.sessionId) out.push(`<p>Session: ${esc(ref.sessionId)}</p>`);
    if (ref.name) out.push(`<p>Name: ${esc(ref.name)}</p>`);
    if (fields.machine) out.push(`<p>Machine: ${esc(fields.machine)}</p>`);
  }
  out.push(`<p>Started: ${esc(fields.started)}</p>`);
  return out;
}

export function renderChatNote(
  fields: ChatNoteFields,
  userNotesHtml = "",
): string {
  return (
    `<div data-schema-version="${String(SCHEMA_VERSION)}">` +
    `<h1>${esc(chatNoteTitle(fields))}</h1>` +
    fieldParagraphs(fields).join("") +
    userNotesHtml +
    `</div>`
  );
}

function topicFromTitle(title: string): string {
  const m = /^.*? chat: (.*)$/s.exec(title.trim());
  return m?.[1]?.trim() ?? "";
}

/** Parse a chat note back into fields; null when it isn't one. */
export function parseChatNote(html: string): ParsedChatNote | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("body > div[data-schema-version]") ?? doc.body;
  if (!root) return null;
  const children = Array.from(root.children);
  const heading = children[0];
  if (!heading || !/^H[1-6]$/.test(heading.tagName)) return null;

  const values = new Map<string, string>();
  let linkHref: string | null = null;
  let i = 1;
  for (; i < children.length; i++) {
    const el = children[i];
    if (el?.tagName !== "P") break;
    const m = FIELD_RE.exec((el.textContent ?? "").trim());
    if (!m?.[1]) break;
    values.set(m[1], (m[2] ?? "").trim());
    if (m[1] === "Link")
      linkHref = el.querySelector("a")?.getAttribute("href") ?? null;
  }
  const userNotesHtml = children
    .slice(i)
    .map((el) => el.outerHTML)
    .join("");

  const topic = topicFromTitle(heading.textContent ?? "");
  const started = values.get("Started") ?? "";
  const link = linkHref ?? values.get("Link");
  if (link) {
    const parsed = parseChatInput(link);
    if (!parsed.ok || parsed.ref.kind !== "web") return null;
    return { fields: { ref: parsed.ref, topic, started }, userNotesHtml };
  }

  // CLI session: the tool comes from the Resume line; the Session and Name
  // lines win over it, so hand edits to them take effect
  const resume = values.get("Resume");
  const parsedResume = resume ? parseChatInput(resume) : null;
  const tool =
    parsedResume?.ok && parsedResume.ref.kind === "session"
      ? parsedResume.ref.tool
      : "claude-code";
  const sessionId = values.get("Session") || undefined;
  const name =
    values.get("Name") ||
    (parsedResume?.ok && parsedResume.ref.kind === "session"
      ? parsedResume.ref.name
      : undefined);
  const resumeId =
    parsedResume?.ok && parsedResume.ref.kind === "session"
      ? parsedResume.ref.sessionId
      : undefined;
  const id = sessionId ?? resumeId;
  if (!id && !name) return null;
  return {
    fields: {
      ref: { kind: "session", tool, sessionId: id, name },
      topic,
      started,
      machine: values.get("Machine") || undefined,
    },
    userNotesHtml,
  };
}

/** Re-render a note with new fields, keeping its user notes. */
export function rewriteChatNote(html: string, fields: ChatNoteFields): string {
  const parsed = parseChatNote(html);
  return renderChatNote(fields, parsed?.userNotesHtml ?? "");
}
