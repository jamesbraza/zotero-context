/**
 * "Link chat…" and "Edit chat link…" dialogs (spec: chat-links "Link chat
 * dialog", "Format-only validation", "Group libraries are opt-in", "Edits
 * propagate to every copy"). Strings are plain English, like the plugin's
 * toasts; only menu labels go through Fluent.
 */
import {
  type ChatRef,
  chatLabel,
  HARNESSES,
  OTHER_HARNESS,
  parseChatInput,
  resumeCommand,
  withHarness,
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
const HARNESS_ID = "zotero-context-chat-harness";
const OTHER_NAME_ID = "zotero-context-chat-other-name";
const OTHER_CMD_ID = "zotero-context-chat-other-command";
const MACHINE_ID = "zotero-context-chat-machine";
const OK_BUTTON = "zotero-context-chat-ok";

/** Local calendar date as YYYY-MM-DD. */
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The text a user would paste to mean this chat. */
function refSource(ref: ChatRef): string {
  if (ref.kind === "web") return ref.url;
  // An "Other" harness's command can be anything, so edit its bare ID
  if (ref.harness === OTHER_HARNESS) return ref.sessionId ?? ref.name ?? "";
  return resumeCommand(ref) ?? ref.sessionId ?? ref.name ?? "";
}

interface DialogOptions {
  title: string;
  okLabel: string;
  input: string;
  topic: string;
  existing: ChatCopy[];
  notice: string;
  /** Prefill for the Machine field (CLI sessions only). */
  machine: string;
  /** Preselected harness for a bare ID or name, plus "Other" details. */
  harness?: string | undefined;
  otherName?: string | undefined;
  otherCommand?: string | undefined;
  /** Nothing can be written (e.g. group linking off): Link stays disabled. */
  blocked: boolean;
}

interface DialogResult {
  ref: ChatRef;
  topic: string;
  /** Empty for web chats, or when the user cleared the field. */
  machine: string;
}

type Parsed = ReturnType<typeof parseChatInput>;

/** Apply the harness list to a bare ID or name. */
function effectiveParse(
  parsed: Parsed,
  harness: string,
  other: { label: string; command: string },
): Parsed {
  return parsed.ok && parsed.bare
    ? withHarness(parsed.ref, harness, other)
    : parsed;
}

function describe(ref: ChatRef): string {
  const label = chatLabel(ref);
  if (ref.kind === "web") return `${label} chat link`;
  return ref.sessionId
    ? `${label} session ${ref.sessionId}`
    : `${label} session named "${ref.name ?? ""}"`;
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
    machine: opts.machine,
    otherName: opts.otherName ?? "",
    otherCommand: opts.otherCommand ?? "",
  };
  let chosenHarness = opts.harness ?? HARNESSES[0]?.id ?? OTHER_HARNESS;
  let dialog: { window: Window } | null = null;
  const doc = () => dialog?.window.document ?? null;

  const validate = () => {
    const d = doc();
    if (!d) return;
    const input = d.getElementById(INPUT_ID) as HTMLInputElement | null;
    const status = d.getElementById(STATUS_ID) as HTMLElement | null;
    const ok = d.getElementById(OK_BUTTON) as HTMLButtonElement | null;
    const value = (id: string) =>
      (d.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const parsed = parseChatInput(input?.value ?? "");
    const final = effectiveParse(parsed, chosenHarness, {
      label: value(OTHER_NAME_ID),
      command: value(OTHER_CMD_ID),
    });
    const ref = final.ok ? final.ref : null;
    if (status) {
      status.textContent = ref
        ? `Recognized: ${describe(ref)}`
        : !final.ok && (input?.value.trim() ?? "")
          ? final.error
          : "";
      status.style.color = ref ? "" : "#c00";
    }
    // Rows that only apply to some inputs: the harness list for a bare ID or
    // name (plus name/command for "Other"), the Machine field for sessions
    const show = (id: string, visible: boolean) => {
      // Gecko's DOM typings return `any` for this querySelectorAll overload
      const rows = d.querySelectorAll(
        `.${id}-row`,
      ) as unknown as ArrayLike<HTMLElement>;
      for (const el of Array.from(rows)) {
        // The toolkit wraps each control in a cell vbox inside a flexing row
        // hbox; hide the whole row, or it keeps its share of the height
        const cell = el.parentElement as HTMLElement | null;
        const row = cell?.parentElement as HTMLElement | null | undefined;
        for (const node of [el, cell, row]) {
          if (node) node.style.display = visible ? "" : "none";
        }
      }
    };
    const bare = parsed.ok && parsed.bare === true;
    show(HARNESS_ID, bare);
    show(OTHER_NAME_ID, bare && chosenHarness === OTHER_HARNESS);
    show(MACHINE_ID, ref?.kind === "session");
    // Paint after showing: a hidden list can't scroll to its choice
    if (bare) paintList(HARNESS_ID, chosenHarness);
    if (ok) ok.disabled = opts.blocked || !ref;
    // Rows appearing or disappearing change the content height; refit the
    // window so the Link/Cancel buttons stay visible
    dialog?.window.sizeToContent();
  };

  /** Highlight the chosen row of one of the list boxes. */
  const paintList = (id: string, chosen: string) => {
    const rowsOf = doc()?.querySelectorAll(`#${id} > div`) as unknown as
      ArrayLike<HTMLElement> | undefined;
    for (const row of Array.from(rowsOf ?? [])) {
      const on = row.dataset["value"] === chosen;
      row.style.background = on ? "SelectedItem" : "";
      row.style.color = on ? "SelectedItemText" : "";
      // Scroll only the list box (not the window) to keep the choice visible
      const box = row.parentElement as HTMLElement | null;
      if (on && box) {
        const top = row.offsetTop - box.offsetTop;
        if (top < box.scrollTop) box.scrollTop = top;
        else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) {
          box.scrollTop = top + row.offsetHeight - box.clientHeight;
        }
      }
    }
  };

  const pickHarness = (value: string) => {
    chosenHarness = value;
    paintList(HARNESS_ID, value);
    validate();
  };

  const pickExisting = (value: string) => {
    const d = doc();
    paintList(EXISTING_ID, value);
    const chosen = opts.existing.find((c) => c.identity === value);
    const input = d?.getElementById(INPUT_ID) as HTMLInputElement | null;
    const title = d?.getElementById(TITLE_ID) as HTMLInputElement | null;
    if (chosen && input && title) {
      const { ref, machine } = chosen.parsed.fields;
      input.value = refSource(ref);
      title.value = chosen.parsed.fields.topic;
      // Restore the session's harness (and "Other" details), since a bare
      // ID alone would fall back to Claude Code
      if (ref.kind === "session") {
        chosenHarness = ref.harness;
        const set = (id: string, value: string) => {
          const el = d?.getElementById(id) as HTMLInputElement | null;
          if (el) el.value = value;
        };
        set(OTHER_NAME_ID, ref.label ?? "");
        set(OTHER_CMD_ID, ref.command ?? "");
        if (machine) set(MACHINE_ID, machine);
      }
    }
    validate();
  };

  /**
   * A scrollable list of clickable rows. Native <select> list boxes and
   * popups, HTML radios, and XUL radiogroups all render badly in the
   * toolkit's dialog window, so this is plain divs.
   */
  const listBox = (
    id: string,
    items: { value: string; label: string }[],
    onPick: (value: string) => void,
    rowClass?: string,
  ) => ({
    tag: "div",
    namespace: "html",
    id,
    classList: rowClass ? [`${rowClass}-row`] : [],
    styles: {
      width: "28em",
      maxHeight: "9em",
      overflowY: "auto",
      border: "1px solid GrayText",
      borderRadius: "4px",
      background: "Field",
    },
    children: items.map((item) => ({
      tag: "div",
      namespace: "html",
      attributes: { "data-value": item.value },
      properties: { textContent: item.label },
      styles: { padding: "0.2em 0.5em", cursor: "pointer" },
      listeners: [
        {
          type: "click",
          listener: () => {
            onPick(item.value);
          },
        },
      ],
    })),
  });

  const label = (text: string, rowClass?: string) => ({
    tag: "label",
    namespace: "html",
    classList: rowClass ? [`${rowClass}-row`] : [],
    properties: { textContent: text },
  });
  const rows = 7 + (opts.existing.length ? 1 : 0) + (opts.notice ? 1 : 0);
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
    .addCell(2, 0, label("Harness", HARNESS_ID))
    .addCell(
      2,
      1,
      listBox(
        HARNESS_ID,
        [
          ...HARNESSES.map((h) => ({ value: h.id, label: h.label })),
          { value: OTHER_HARNESS, label: "Other…" },
        ],
        pickHarness,
        HARNESS_ID,
      ),
    )
    .addCell(3, 0, label("Harness name", OTHER_NAME_ID))
    .addCell(
      3,
      1,
      {
        tag: "input",
        namespace: "html",
        id: OTHER_NAME_ID,
        classList: [`${OTHER_NAME_ID}-row`],
        attributes: {
          "data-bind": "otherName",
          "data-prop": "value",
          placeholder: "e.g. Aider",
        },
        styles: { width: "28em" },
        listeners: [{ type: "input", listener: validate }],
      },
      true,
    )
    .addCell(4, 0, label("Resume command (optional)", OTHER_NAME_ID))
    .addCell(
      4,
      1,
      {
        tag: "input",
        namespace: "html",
        id: OTHER_CMD_ID,
        classList: [`${OTHER_NAME_ID}-row`],
        attributes: {
          "data-bind": "otherCommand",
          "data-prop": "value",
          placeholder: "The command that reopens this session",
        },
        styles: { width: "28em" },
      },
      true,
    )
    .addCell(5, 0, label("Machine", MACHINE_ID))
    .addCell(
      5,
      1,
      {
        tag: "input",
        namespace: "html",
        id: MACHINE_ID,
        classList: [`${MACHINE_ID}-row`],
        attributes: {
          "data-bind": "machine",
          "data-prop": "value",
          placeholder: "Computer the session ran on",
        },
        styles: { width: "28em" },
      },
      true,
    )
    .addCell(6, 0, label("Title (optional)"))
    .addCell(
      6,
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
  let next = 7;
  if (opts.existing.length) {
    helper.addCell(next, 0, label("Or a chat already linked")).addCell(
      next,
      1,
      listBox(
        EXISTING_ID,
        opts.existing.map((c) => ({
          value: c.identity,
          label: `${c.note.getNoteTitle()} (${c.parsed.fields.started})`,
        })),
        pickExisting,
      ),
    );
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
  const text = (key: string) => {
    const value = result[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const final = effectiveParse(parseChatInput(text("input")), chosenHarness, {
    label: text("otherName"),
    command: text("otherCommand"),
  });
  if (!final.ok) return null;
  const { ref } = final;
  return {
    ref,
    topic: text("topic"),
    machine: ref.kind === "session" ? text("machine") : "",
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
    machine: thisMachine(),
    blocked: writable.length === 0,
  });
  if (!result) return;
  const fields: ChatNoteFields = {
    ref: result.ref,
    topic: result.topic,
    started: todayISO(),
    machine: result.machine || undefined,
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
    machine: fields.machine ?? thisMachine(),
    // A bare ID (e.g. an "Other" harness) reopens with its harness selected
    ...(fields.ref.kind === "session"
      ? {
          harness: fields.ref.harness,
          otherName: fields.ref.label,
          otherCommand: fields.ref.command,
        }
      : {}),
    blocked: false,
  });
  if (!result) return;
  const count = await updateChat(copy, {
    ...fields,
    ref: result.ref,
    topic: result.topic,
    machine: result.machine || undefined,
  });
  notify(`Updated ${String(count)} cop${count === 1 ? "y" : "ies"}`);
}
