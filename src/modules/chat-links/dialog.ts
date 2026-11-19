/**
 * "Link chat…" and "Edit chat link…" dialogs (spec: chat-links "Link chat
 * dialog", "Format-only validation", "Group libraries are opt-in", "Edits
 * propagate to every copy"). Strings are plain English, like the plugin's
 * toasts; only menu labels go through Fluent.
 */
import {
  type ChatRef,
  parseChatInput,
  resumeCommand,
  toolLabel,
} from "../../core/chat-link";
import type { ChatNoteFields } from "../../core/chat-note";
import { notify } from "../notify";
import {
  type ChatCopy,
  canLinkInLibrary,
  chatCopiesInLibrary,
  chatCopyOf,
  isGroupLibrary,
  linkChat,
  thisMachine,
  updateChat,
} from "./store";

const INPUT_ID = "zotero-context-chat-input";
const TITLE_ID = "zotero-context-chat-title";
const STATUS_ID = "zotero-context-chat-status";
const EXISTING_ID = "zotero-context-chat-existing";
const OK_BUTTON = "zotero-context-chat-ok";
const NEW_CHAT = "";

/** Local calendar date as YYYY-MM-DD. */
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The text a user would paste to mean this chat. */
function refSource(ref: ChatRef): string {
  return ref.kind === "web" ? ref.url : (resumeCommand(ref) ?? "");
}

interface DialogOptions {
  title: string;
  okLabel: string;
  input: string;
  topic: string;
  existing: ChatCopy[];
  notice: string;
  /** Nothing can be written (e.g. group linking off): Link stays disabled. */
  blocked: boolean;
}

interface DialogResult {
  ref: ChatRef;
  topic: string;
}

function describe(ref: ChatRef): string {
  const tool = toolLabel(ref.tool);
  if (ref.kind === "web") return `${tool} chat link`;
  return ref.sessionId
    ? `${tool} session ${ref.sessionId}`
    : `${tool} session named "${ref.name ?? ""}"`;
}

function newestFirstUnique(copies: ChatCopy[]): ChatCopy[] {
  const byIdentity = new Map<string, ChatCopy>();
  for (const c of copies) {
    const seen = byIdentity.get(c.identity);
    if (!seen || c.note.dateAdded > seen.note.dateAdded) {
      byIdentity.set(c.identity, c);
    }
  }
  return [...byIdentity.values()].sort((a, b) =>
    b.note.dateAdded.localeCompare(a.note.dateAdded),
  );
}

async function runChatDialog(
  opts: DialogOptions,
): Promise<DialogResult | null> {
  const data: Record<string, unknown> = {
    input: opts.input,
    topic: opts.topic,
  };
  let dialog: { window: Window } | null = null;
  const doc = () => dialog?.window.document ?? null;

  const validate = () => {
    const d = doc();
    if (!d) return;
    const input = d.getElementById(INPUT_ID) as HTMLInputElement | null;
    const status = d.getElementById(STATUS_ID) as HTMLElement | null;
    const ok = d.getElementById(OK_BUTTON) as HTMLButtonElement | null;
    const parsed = parseChatInput(input?.value ?? "");
    if (status) {
      status.textContent = parsed.ok
        ? `Recognized: ${describe(parsed.ref)}`
        : (input?.value.trim() ?? "")
          ? parsed.error
          : "";
      status.style.color = parsed.ok ? "" : "#c00";
    }
    if (ok) ok.disabled = opts.blocked || !parsed.ok;
  };

  const pickExisting = () => {
    const d = doc();
    const select = d?.getElementById(EXISTING_ID) as HTMLSelectElement | null;
    const chosen = opts.existing.find((c) => c.identity === select?.value);
    const input = d?.getElementById(INPUT_ID) as HTMLInputElement | null;
    const title = d?.getElementById(TITLE_ID) as HTMLInputElement | null;
    if (chosen && input && title) {
      input.value = refSource(chosen.parsed.fields.ref);
      title.value = chosen.parsed.fields.topic;
    }
    validate();
  };

  const label = (text: string) => ({
    tag: "label",
    namespace: "html",
    properties: { textContent: text },
  });
  const rows = opts.existing.length ? 6 : 5;
  const helper = new ztoolkit.Dialog(rows, 2)
    .addCell(0, 0, label("Chat link or session"))
    .addCell(
      0,
      1,
      {
        tag: "input",
        namespace: "html",
        id: INPUT_ID,
        attributes: {
          "data-bind": "input",
          "data-prop": "value",
          placeholder:
            "https://claude.ai/chat/…, claude --resume <id>, or a session name",
        },
        styles: { width: "28em" },
        listeners: [{ type: "input", listener: validate }],
      },
      true,
    )
    .addCell(1, 1, {
      tag: "div",
      namespace: "html",
      id: STATUS_ID,
      styles: { minHeight: "1.2em", fontSize: "0.9em" },
    })
    .addCell(2, 0, label("Title (optional)"))
    .addCell(
      2,
      1,
      {
        tag: "input",
        namespace: "html",
        id: TITLE_ID,
        attributes: { "data-bind": "topic", "data-prop": "value" },
        styles: { width: "28em" },
      },
      true,
    );
  let next = 3;
  if (opts.existing.length) {
    helper
      .addCell(next, 0, label("Or a chat already linked"))
      .addCell(next, 1, {
        tag: "select",
        namespace: "html",
        id: EXISTING_ID,
        listeners: [{ type: "change", listener: pickExisting }],
        children: [
          {
            tag: "option",
            namespace: "html",
            properties: { value: NEW_CHAT, textContent: "—" },
          },
          ...opts.existing.map((c) => ({
            tag: "option",
            namespace: "html",
            properties: {
              value: c.identity,
              textContent: `${c.note.getNoteTitle()} (${c.parsed.fields.started})`,
            },
          })),
        ],
      });
    next++;
  }
  if (opts.notice) {
    helper.addCell(next, 1, {
      tag: "div",
      namespace: "html",
      properties: { textContent: opts.notice },
      styles: { fontSize: "0.9em", maxWidth: "28em" },
    });
  }
  helper
    .addButton(opts.okLabel, OK_BUTTON)
    .addButton("Cancel", "cancel")
    .setDialogData({
      ...data,
      loadCallback: () => {
        validate();
        (doc()?.getElementById(INPUT_ID) as HTMLInputElement | null)?.focus();
      },
    })
    .open(opts.title, {
      centerscreen: true,
      resizable: true,
      fitContent: true,
    });
  dialog = helper;

  const result = helper.dialogData as Record<string, unknown> & {
    unloadLock?: { promise: Promise<void> };
    _lastButtonId?: string;
  };
  await result.unloadLock?.promise;
  if (result._lastButtonId !== OK_BUTTON) return null;
  const parsed = parseChatInput(
    typeof result["input"] === "string" ? result["input"] : "",
  );
  if (!parsed.ok) return null;
  return {
    ref: parsed.ref,
    topic: (typeof result["topic"] === "string" ? result["topic"] : "").trim(),
  };
}

function summarize(created: number, duplicates: number, refused: number) {
  const parts = [
    created
      ? `Linked to ${String(created)} paper${created === 1 ? "" : "s"}`
      : "",
    duplicates ? `${String(duplicates)} already had it` : "",
    refused ? `${String(refused)} in group libraries skipped` : "",
  ].filter(Boolean);
  notify(parts.join("; ") || "Nothing to link", created > 0);
}

/** "Link chat…" on one or more selected papers. */
export async function linkChatDialog(papers: Zotero.Item[]): Promise<void> {
  const first = papers[0];
  if (!first) return;
  const writable = papers.filter((p) => canLinkInLibrary(p.libraryID));
  const groupPaper = papers.find((p) => isGroupLibrary(p.libraryID));
  let notice = "";
  if (groupPaper) {
    const library = Zotero.Libraries.get(groupPaper.libraryID);
    const name = library ? library.name : "a group library";
    notice = canLinkInLibrary(groupPaper.libraryID)
      ? `This paper is in group "${name}": group members will see this link.`
      : `Linking chats in group libraries is off. Turn on "Link chats in ` +
        `group libraries" in Zotero Context's settings to link chats here.`;
  }
  const existing = newestFirstUnique(
    await chatCopiesInLibrary(first.libraryID),
  );
  const result = await runChatDialog({
    title: "Link chat",
    okLabel: "Link",
    input: "",
    topic: "",
    existing,
    notice,
    blocked: writable.length === 0,
  });
  if (!result) return;
  const fields: ChatNoteFields = {
    ref: result.ref,
    topic: result.topic,
    started: todayISO(),
    machine: result.ref.kind === "session" ? thisMachine() : undefined,
  };
  const r = await linkChat(papers, fields);
  summarize(r.created.length, r.duplicates.length, r.refusedGroup.length);
}

/** "Edit chat link…" on a chat note: rewrites every copy of that chat. */
export async function editChatDialog(note: Zotero.Item): Promise<void> {
  const copy = chatCopyOf(note);
  if (!copy) return;
  const { fields } = copy.parsed;
  const result = await runChatDialog({
    title: "Edit chat link",
    okLabel: "Save",
    input: refSource(fields.ref),
    topic: fields.topic,
    existing: [],
    notice: "Changes apply to every paper this chat is linked to.",
    blocked: false,
  });
  if (!result) return;
  const machine =
    result.ref.kind === "session"
      ? (fields.machine ?? thisMachine())
      : undefined;
  const count = await updateChat(copy, {
    ...fields,
    ref: result.ref,
    topic: result.topic,
    machine,
  });
  notify(`Updated ${String(count)} cop${count === 1 ? "y" : "ies"}`);
}
