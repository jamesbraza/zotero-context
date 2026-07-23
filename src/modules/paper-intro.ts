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
import type { PaperInfo } from "../core/provenance";
import { copyFileWithText, copyText } from "./clipboard";
import { paperInfoFromItem } from "./grab-session";
import { registerChord } from "./hotkeys";
import { guard, notify } from "./notify";

const PHASE_WINDOW_MS = 60_000;

let lastFileCopy: { paperId: string; ts: number } | null = null;

export function registerPaperIntro() {
  registerChord("i", () => void guard("Paper intro", copyPaperIntro));
}

/** The top-level item in focus: current reader tab's paper, else selection. */
function getFocusedTopItem(): Zotero.Item | null {
  const tabs = ztoolkit.getGlobal("Zotero_Tabs");
  const reader = Zotero.Reader.getByTabID(tabs.selectedID);
  if (reader?.itemID) {
    const attachment = Zotero.Items.get(reader.itemID);
    return attachment?.parentItem ?? attachment ?? null;
  }
  const selected = Zotero.getActiveZoteroPane()?.getSelectedItems()?.[0];
  if (!selected) return null;
  return selected.isAttachment() ? (selected.parentItem ?? selected) : selected;
}

async function copyPaperIntro() {
  const top = getFocusedTopItem();
  if (!top) {
    notify("Paper intro: open a paper or select an item first", false);
    return;
  }
  const { paperId, info } = paperInfoFromItem(top);
  const abstract = String(top.getField("abstractNote") ?? "").trim();
  const intro = composeIntro(info, abstract);

  const secondPhase =
    lastFileCopy?.paperId === paperId &&
    Date.now() - lastFileCopy.ts < PHASE_WINDOW_MS;

  if (secondPhase) {
    copyText(intro);
    lastFileCopy = null;
    notify("Intro text on clipboard — paste it as your opening message");
    return;
  }

  const attachment = top.isAttachment()
    ? top
    : ((await top.getBestAttachment()) ?? null);
  const path = attachment ? await attachment.getFilePathAsync() : null;
  if (!path) {
    // No PDF file — still useful: copy the intro text directly
    copyText(intro);
    notify("No PDF found — intro text on clipboard");
    return;
  }
  copyFileWithText(path, intro);
  lastFileCopy = { paperId, ts: Date.now() };
  notify(
    "PDF on clipboard — paste it, then press Ctrl+Alt+I again for the intro text",
  );
}

function composeIntro(info: PaperInfo, abstract: string): string {
  const cite = `"${info.title}" (${info.creatorSummary}${
    info.year ? ` ${info.year}` : ""
  })`;
  const lines = [
    `I'm reading ${cite} — the PDF is attached; please treat it as the source of truth for this discussion.`,
  ];
  if (abstract) {
    lines.push("", `Abstract: ${abstract}`);
  }
  return lines.join("\n");
}
