/**
 * Paper-intro action (see spec: clipboard-delivery): one hotkey starts a
 * chat session about a paper.
 *
 * Rich paste targets take only the file flavor from a mixed clipboard, so the
 * action is two-phase on the same hotkey (Ctrl+Alt+I):
 *   1st press — PDF file (+ intro text flavor for text-only targets); paste
 *               attaches the PDF (verified against claude.ai, spike S3).
 *   2nd press within 60s for the same paper — intro text only; paste it as
 *               the opening message.
 */
import { composeIntro } from "../core/chat-start";
import { copyFileWithText, copyText } from "./clipboard";
import { fieldText, paperInfoFromItem } from "./grab-session";
import { notify } from "./notify";

const PHASE_WINDOW_MS = 60_000;

let lastFileCopy: { paperId: string; ts: number } | null = null;

/** The top-level item in focus: current reader tab's paper, else selection. */
export function getFocusedTopItem(): Zotero.Item | null {
  const tabs = ztoolkit.getGlobal("Zotero_Tabs");
  const reader = Zotero.Reader.getByTabID(tabs.selectedID);
  if (reader?.itemID) {
    const attachment = Zotero.Items.get(reader.itemID);
    if (attachment) return attachment.parentItem ?? attachment;
    return null;
  }
  const selected = Zotero.getActiveZoteroPane()?.getSelectedItems()[0];
  if (!selected) return null;
  return selected.isAttachment() ? (selected.parentItem ?? selected) : selected;
}

/** Whether the next press for this paper copies the intro text (phase 2). */
export function inSecondPhase(paperId: string): boolean {
  return (
    lastFileCopy?.paperId === paperId &&
    Date.now() - lastFileCopy.ts < PHASE_WINDOW_MS
  );
}

/**
 * The two-phase clipboard intro for chats that take a pasted PDF. Returns
 * true when this press put the PDF on the clipboard (phase 1).
 */
export async function clipboardIntro(top: Zotero.Item): Promise<boolean> {
  const { paperId, info } = paperInfoFromItem(top);
  const abstract = fieldText(top, "abstractNote").trim();
  const intro = composeIntro(info, abstract);

  if (inSecondPhase(paperId)) {
    copyText(intro);
    lastFileCopy = null;
    notify("Intro text on clipboard — paste it as your opening message");
    return false;
  }

  const attachment = top.isAttachment()
    ? top
    : (await top.getBestAttachment()) || null;
  const path = attachment ? await attachment.getFilePathAsync() : null;
  if (!path) {
    // No PDF file — still useful: copy the intro text directly
    copyText(intro);
    notify("No PDF found — intro text on clipboard");
    return false;
  }
  copyFileWithText(path, intro);
  lastFileCopy = { paperId, ts: Date.now() };
  notify(
    "PDF on clipboard — paste it, then press Ctrl+Alt+I again for the intro text",
  );
  return true;
}

/** The paper's PDF path, or null when it has no file attachment. */
export async function pdfPathOf(top: Zotero.Item): Promise<string | null> {
  const attachment = top.isAttachment()
    ? top
    : (await top.getBestAttachment()) || null;
  return attachment ? (await attachment.getFilePathAsync()) || null : null;
}
