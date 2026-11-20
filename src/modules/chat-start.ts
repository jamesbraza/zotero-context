/**
 * Starting a chat about a paper (spec: chat-start): the intro hotkey and the
 * reader's New chat button, dispatched on the Preferred chat setting. Claude
 * Code links immediately (Zotero picks the session ID); the desktop app and
 * browser get today's clipboard intro plus a new chat; claude.ai in Zotero
 * opens the pane.
 */
import {
  claudeCodeCommand,
  claudeCodeResumeOrStart,
  composeClaudeCodeIntro,
  newChatUrls,
  sessionNameFor,
} from "../core/chat-start";
import { getPref, setPref } from "../utils/prefs";
import {
  type ChatCopy,
  chatCopyOf,
  linkChat,
  thisMachine,
} from "./chat-links/store";
import { todayISO } from "./chat-links/dialog";
import { listBoxProps, paintListBox, toggleProps } from "./chat-links/list-box";
import { startPaneChat } from "./chat-pane";
import { copyText } from "./clipboard";
import { fieldText, paperInfoFromItem, trail } from "./grab-session";
import { registerChord } from "./hotkeys";
import { guard, notify } from "./notify";
import {
  clipboardIntro,
  getFocusedTopItem,
  inSecondPhase,
  pdfPathOf,
} from "./paper-intro";

type ChatPlace =
  "claude-code" | "claude-desktop" | "claude-browser" | "claude-zotero";

const PLACES: { value: ChatPlace; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "claude-desktop", label: "Claude desktop app" },
  { value: "claude-browser", label: "claude.ai in your browser" },
  { value: "claude-zotero", label: "claude.ai in Zotero" },
];

const CHOOSER_LIST_ID = "zotero-context-place-list";
const SESSION_LIST_ID = "zotero-context-session-list";
const RESUME_BUTTON = "zotero-context-session-resume";
const NEW_BUTTON = "zotero-context-session-new";
const START_BUTTON = "zotero-context-place-start";

function isPlace(value: string): value is ChatPlace {
  return PLACES.some((p) => p.value === value);
}

/**
 * "Where do you start this chat?" — shown while Preferred chat is "Ask every
 * time". Resolves to the chosen place, or null on Cancel. "Always use this"
 * saves the choice to the setting so the chooser stops appearing.
 */
async function choosePlace(): Promise<ChatPlace | null> {
  // Held in an object: callbacks mutate it, which flow analysis can't see
  const state: { chosen: ChatPlace; remember: boolean } = {
    chosen: "claude-browser",
    remember: false,
  };
  let dialog: { window: Window } | null = null;
  const pick = (value: string) => {
    if (isPlace(value)) state.chosen = value;
    paintListBox(
      dialog?.window.document ?? null,
      CHOOSER_LIST_ID,
      state.chosen,
    );
  };
  const helper = new ztoolkit.Dialog(3, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      properties: { textContent: "Where do you start this chat?" },
      styles: { fontWeight: "bold" },
    })
    .addCell(1, 0, listBoxProps(CHOOSER_LIST_ID, PLACES, pick))
    .addCell(2, 0, {
      tag: "div",
      namespace: "html",
      children: [
        toggleProps(
          "zotero-context-place-remember",
          "Always use this",
          (on) => {
            state.remember = on;
          },
        ),
        {
          tag: "div",
          namespace: "html",
          properties: {
            textContent:
              "You can change this later in Settings → Zotero Context.",
          },
          styles: { fontSize: "0.9em", marginTop: "0.4em", opacity: "0.8" },
        },
      ],
    })
    .addButton("Start chat", START_BUTTON)
    .addButton("Cancel", "cancel")
    .setDialogData({
      loadCallback: () => {
        pick(state.chosen);
      },
    })
    .open("Start a chat", { centerscreen: true, fitContent: true });
  dialog = helper;
  const data = helper.dialogData as {
    unloadLock?: { promise: Promise<void> };
    _lastButtonId?: string;
  };
  await data.unloadLock?.promise;
  if (data._lastButtonId !== START_BUTTON) return null;
  if (state.remember) setPref("preferredChat", state.chosen);
  return state.chosen;
}

/** The paper's linked Claude Code sessions with an ID, newest first. */
function claudeCodeSessionsOf(top: Zotero.Item): ChatCopy[] {
  return top
    .getNotes()
    .map((id) => Zotero.Items.get(id))
    .map((note) => (note ? chatCopyOf(note) : null))
    .filter((c): c is ChatCopy => {
      const ref = c?.parsed.fields.ref;
      return (
        ref?.kind === "session" &&
        ref.harness === "claude-code" &&
        Boolean(ref.sessionId)
      );
    })
    .sort((a, b) => b.note.dateAdded.localeCompare(a.note.dateAdded));
}

/**
 * The paper already has Claude Code sessions: resume one, or start a new
 * one. Resolves to the session to resume, "new", or null on Cancel.
 */
async function chooseSession(
  sessions: ChatCopy[],
): Promise<ChatCopy | "new" | null> {
  const state = { chosen: sessions[0]?.identity ?? "" };
  let dialog: { window: Window } | null = null;
  const pick = (value: string) => {
    state.chosen = value;
    paintListBox(dialog?.window.document ?? null, SESSION_LIST_ID, value);
  };
  const helper = new ztoolkit.Dialog(2, 1)
    .addCell(0, 0, {
      tag: "div",
      namespace: "html",
      properties: {
        textContent: "This paper already has Claude Code sessions:",
      },
    })
    .addCell(
      1,
      0,
      listBoxProps(
        SESSION_LIST_ID,
        sessions.map((c) => ({
          value: c.identity,
          label: `${c.parsed.fields.topic || "Claude Code"} · ${c.parsed.fields.started}`,
        })),
        pick,
      ),
    )
    .addButton("Copy resume command", RESUME_BUTTON)
    .addButton("Start new session", NEW_BUTTON)
    .addButton("Cancel", "cancel")
    .setDialogData({
      loadCallback: () => {
        pick(state.chosen);
      },
    })
    .open("Claude Code chat", { centerscreen: true, fitContent: true });
  dialog = helper;
  const data = helper.dialogData as {
    unloadLock?: { promise: Promise<void> };
    _lastButtonId?: string;
  };
  await data.unloadLock?.promise;
  if (data._lastButtonId === NEW_BUTTON) return "new";
  if (data._lastButtonId !== RESUME_BUTTON) return null;
  return sessions.find((c) => c.identity === state.chosen) ?? null;
}

/**
 * Copy a `claude --session-id …` command and link that session now. When
 * the paper already has Claude Code sessions, offer to resume one instead,
 * so repeat presses don't pile up unused sessions and notes.
 */
async function startClaudeCode(top: Zotero.Item): Promise<void> {
  const { paperId, info } = paperInfoFromItem(top);
  const pdfPath = await pdfPathOf(top);
  const intro = composeClaudeCodeIntro(
    info,
    fieldText(top, "abstractNote").trim(),
    pdfPath,
    getPref("mcpEnabled") ? paperId : undefined,
  );
  const existing = claudeCodeSessionsOf(top);
  const choice = existing.length ? await chooseSession(existing) : "new";
  if (choice === null) return;
  // The MCP server serves this paper now, as if it had been grabbed from
  trail.admit(paperId);
  if (choice !== "new") {
    const ref = choice.parsed.fields.ref;
    if (ref.kind !== "session" || !ref.sessionId) return;
    copyText(
      claudeCodeResumeOrStart(
        ref.sessionId,
        ref.name ?? sessionNameFor(info),
        intro,
      ),
    );
    notify("Resume command copied — paste it in a terminal");
    return;
  }
  const sessionId = crypto.randomUUID();
  const name = sessionNameFor(info);
  copyText(claudeCodeCommand(sessionId, name, intro));
  let linked = false;
  if (getPref("linkChatsOnIntro")) {
    const result = await linkChat([top], {
      ref: { kind: "session", harness: "claude-code", sessionId, name },
      topic: name,
      started: todayISO(),
      machine: thisMachine() || undefined,
    });
    linked = result.created.length > 0;
  }
  notify(
    `Claude Code command copied${linked ? " and linked" : ""} — paste it in a terminal`,
  );
}

/** Today's clipboard intro, plus a new claude.ai chat on the first press. */
async function startClaudeAi(
  top: Zotero.Item,
  app: "desktop" | "web",
): Promise<void> {
  const firstPhase = await clipboardIntro(top);
  if (!firstPhase) return;
  const urls = newChatUrls(getPref("chatProject"));
  Zotero.launchURL(app === "desktop" ? urls.desktop : urls.web);
}

/** Start a chat about `top` in the preferred place (asking if unset). */
async function startChat(top: Zotero.Item): Promise<void> {
  const { paperId } = paperInfoFromItem(top);
  // The second press of the two-phase intro just copies the intro text
  if (inSecondPhase(paperId)) {
    await clipboardIntro(top);
    return;
  }
  const preferred = getPref("preferredChat");
  const place = isPlace(preferred) ? preferred : await choosePlace();
  switch (place) {
    case null:
      return;
    case "claude-code":
      await startClaudeCode(top);
      return;
    case "claude-desktop":
      await startClaudeAi(top, "desktop");
      return;
    case "claude-browser":
      await startClaudeAi(top, "web");
      return;
    case "claude-zotero":
      // No PDF to show beside: open claude.ai in the browser instead
      if (!(await startPaneChat(top))) await startClaudeAi(top, "web");
      return;
  }
}

/** A reader tab's item is its attachment; start chats about its parent. */
function readerTop(reader: _ZoteroTypes.ReaderInstance): Zotero.Item | null {
  const attachment = Zotero.Items.get(reader.itemID ?? -1);
  if (!attachment) return null;
  return attachment.parentItem ?? attachment;
}

export function registerChatStart(): void {
  registerChord(
    "i",
    () =>
      void guard("Start chat", async () => {
        const top = getFocusedTopItem();
        if (!top) {
          notify("Start chat: open a paper or select an item first", false);
          return;
        }
        await startChat(top);
      }),
  );

  Zotero.Reader.registerEventListener(
    "renderToolbar",
    ({ reader, doc, append }) => {
      const button = doc.createElement("button");
      button.className = "toolbar-button zotero-context-new-chat-button";
      button.title = "New chat about this paper (Zotero Context, Ctrl+Alt+I)";
      button.textContent = "💬";
      button.style.fontSize = "15px";
      button.addEventListener("click", () => {
        const top = readerTop(reader);
        if (top) void guard("Start chat", () => startChat(top));
      });
      append(button);
    },
    addon.data.config.addonID,
  );
}
