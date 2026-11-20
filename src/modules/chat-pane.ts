/**
 * claude.ai in Zotero (spec: chat-pane): a pane beside the PDF that opens
 * only when asked, fills claude.ai's chat box with the PDF and intro, and
 * links the first chat it reaches to the paper.
 */
import {
  type ChatPane,
  chatTitle,
  fillChatBox,
  getPane,
  loadInPane,
  mountPane,
  setPaneTitle,
  unmountAllPanes,
  unmountPane,
  watchFirstChat,
} from "../adapter/chat-pane";
import { composeIntro, newChatUrls } from "../core/chat-start";
import { getPref, setPref } from "../utils/prefs";
import { todayISO } from "./chat-links/dialog";
import { linkChat } from "./chat-links/store";
import { fieldText, paperInfoFromItem } from "./grab-session";
import { notify } from "./notify";
import { clipboardIntro, pdfPathOf } from "./paper-intro";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

/** Stop-watching handles for chats started in each pane. */
const watchers = new Map<ChatPane, () => void>();

async function pdfAttachmentOf(top: Zotero.Item): Promise<Zotero.Item | null> {
  if (top.isPDFAttachment()) return top;
  const best = await top.getBestAttachment();
  return best && best.isPDFAttachment() ? best : null;
}

/** The paper's open reader tab, or a newly opened one. */
async function readerFor(top: Zotero.Item): Promise<ReaderInstance | null> {
  const attachment = await pdfAttachmentOf(top);
  if (!attachment) return null;
  const open = (
    Zotero.Reader as unknown as { _readers: ReaderInstance[] }
  )._readers.find((r) => r.itemID === attachment.id);
  if (open) {
    ztoolkit.getGlobal("Zotero_Tabs").select(open.tabID);
    return open;
  }
  const reader = await Zotero.Reader.open(attachment.id);
  return reader ?? null;
}

async function paneFor(top: Zotero.Item): Promise<ChatPane | null> {
  const reader = await readerFor(top);
  if (!reader) return null;
  return mountPane(reader, {
    width: getPref("chatPaneWidth"),
    onClose: () => {
      closePane(reader);
    },
    onResize: (w) => {
      if (w > 0) setPref("chatPaneWidth", w);
    },
  });
}

function closePane(reader: ReaderInstance): void {
  const pane = getPane(reader);
  if (pane) {
    watchers.get(pane)?.();
    watchers.delete(pane);
  }
  unmountPane(reader);
}

/**
 * Start a claude.ai chat beside the paper's PDF. Resolves false when the
 * paper has no PDF to show (the caller falls back to the browser).
 */
export async function startPaneChat(top: Zotero.Item): Promise<boolean> {
  const pane = await paneFor(top);
  if (!pane) return false;
  watchers.get(pane)?.();
  watchers.delete(pane);
  setPaneTitle(pane, "claude.ai");
  loadInPane(pane, newChatUrls(getPref("chatProject")).web);

  // Link the first chat this start reaches (spec: Pane links its first chat)
  if (getPref("linkChatsOnIntro")) {
    watchers.set(
      pane,
      watchFirstChat(pane, (url) => {
        watchers.delete(pane);
        void (async () => {
          const topic = await chatTitle(pane);
          setPaneTitle(pane, topic);
          const result = await linkChat([top], {
            ref: { kind: "web", tool: "claude", url },
            topic,
            started: todayISO(),
          });
          if (result.created.length) notify("Chat linked to this paper");
        })();
      }),
    );
  }

  const { info } = paperInfoFromItem(top);
  const path = await pdfPathOf(top);
  const bytes = path ? await IOUtils.read(path) : null;
  const filled = await fillChatBox(pane, {
    bytes,
    fileName: path ? PathUtils.filename(path) : "",
    text: composeIntro(info, fieldText(top, "abstractNote").trim()),
  });
  if (filled !== "ok") {
    ztoolkit.log(`claude.ai pane fill failed: ${filled}`);
    notify(
      "Couldn't fill claude.ai's chat box (signed in?) — pasting instead",
      false,
    );
    await clipboardIntro(top);
  }
  return true;
}

/** Open a linked claude.ai chat in the pane beside its paper's PDF. */
export async function openInPane(
  top: Zotero.Item,
  url: string,
): Promise<boolean> {
  const pane = await paneFor(top);
  if (!pane) return false;
  watchers.get(pane)?.();
  watchers.delete(pane);
  setPaneTitle(pane, "claude.ai");
  return loadInPane(pane, url);
}

export function closeAllPanes(): void {
  for (const stop of watchers.values()) stop();
  watchers.clear();
  unmountAllPanes();
}
