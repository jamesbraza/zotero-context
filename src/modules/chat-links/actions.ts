/**
 * Chat-note actions (spec: chat-links "Chat note actions"). Nothing here
 * launches programs: resume commands are copied, never executed.
 */
import { resumeCommand } from "../../core/chat-link";
import { getPref } from "../../utils/prefs";
import { openInPane } from "../chat-pane";
import { copyText } from "../clipboard";
import { notify } from "../notify";
import { chatCopyOf, linkChat } from "./store";

/** io contract of chrome://zotero/content/selectItemsDialog.xhtml (untyped). */
interface SelectItemsIO {
  dataIn: null;
  dataOut: number[] | null;
  deferred: { promise: Promise<void>; resolve: () => void };
  itemTreeID: string;
  filterLibraryIDs: number[];
  onlyRegularItems: boolean;
}

function deferred(): SelectItemsIO["deferred"] {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** "Also link to…": pick papers with Zotero's item picker. */
export async function alsoLinkTo(note: Zotero.Item): Promise<void> {
  const copy = chatCopyOf(note);
  if (!copy) return;
  const io: SelectItemsIO = {
    dataIn: null,
    dataOut: null,
    deferred: deferred(),
    itemTreeID: "zotero-context-also-link-to",
    filterLibraryIDs: [note.libraryID],
    onlyRegularItems: true,
  };
  Zotero.getMainWindow().openDialog(
    "chrome://zotero/content/selectItemsDialog.xhtml",
    "",
    "chrome,dialog=no,centerscreen,resizable=yes",
    io,
  );
  await io.deferred.promise;
  if (!io.dataOut?.length) return;
  const papers = (await Zotero.Items.getAsync(io.dataOut)).filter((i) =>
    i.isRegularItem(),
  );
  const r = await linkChat(papers, copy.parsed.fields);
  const extra = [
    r.duplicates.length ? `${String(r.duplicates.length)} already had it` : "",
    r.refusedGroup.length
      ? `${String(r.refusedGroup.length)} in group libraries skipped`
      : "",
  ].filter(Boolean);
  notify(
    [
      `Linked to ${String(r.created.length)} more paper${r.created.length === 1 ? "" : "s"}`,
      ...extra,
    ].join("; "),
    r.created.length > 0,
  );
}

export function copyResumeCommand(note: Zotero.Item): void {
  const copy = chatCopyOf(note);
  const command = copy ? resumeCommand(copy.parsed.fields.ref) : null;
  if (!command) {
    notify("This chat has no resume command", false);
    return;
  }
  copyText(command);
  notify("Resume command copied — paste it in a terminal");
}

export async function openChatLink(note: Zotero.Item): Promise<void> {
  const ref = chatCopyOf(note)?.parsed.fields.ref;
  if (ref?.kind !== "web") {
    notify("This chat has no link to open", false);
    return;
  }
  // claude.ai chats reopen beside their paper when that's where chats start
  const paper = note.parentItem;
  if (
    getPref("preferredChat") === "claude-zotero" &&
    ref.tool === "claude" &&
    paper &&
    (await openInPane(paper, ref.url))
  ) {
    return;
  }
  Zotero.launchURL(ref.url);
}
