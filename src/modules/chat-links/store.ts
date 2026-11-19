/**
 * The plugin's only library writer (add-chat-links design D7; eslint exempts
 * this file alone from the write ban). Writes are limited to chat-link child
 * notes, their tag, and Related links among copies of the same chat.
 */
import { chatIdentity, groupWriteAllowed } from "../../core/chat-link";
import {
  type ChatNoteFields,
  type ParsedChatNote,
  parseChatNote,
  renderChatNote,
  rewriteChatNote,
} from "../../core/chat-note";
import { getPref } from "../../utils/prefs";

export const CHAT_TAG = "zotero-context/chat";

export interface ChatCopy {
  note: Zotero.Item;
  parsed: ParsedChatNote;
  identity: string;
}

export interface LinkResult {
  /** New chat notes, one per newly linked paper. */
  created: Zotero.Item[];
  /** Papers that already had this chat. */
  duplicates: Zotero.Item[];
  /** Papers skipped because group-library linking is off. */
  refusedGroup: Zotero.Item[];
}

/** Read a note as a chat copy; null for anything else. */
export function chatCopyOf(item: Zotero.Item): ChatCopy | null {
  if (!item.isNote() || !item.hasTag(CHAT_TAG)) return null;
  const parsed = parseChatNote(item.getNote());
  return parsed
    ? { note: item, parsed, identity: chatIdentity(parsed.fields.ref) }
    : null;
}

/** Every chat-note copy in a library (trashed notes excluded). */
async function chatCopiesInLibrary(libraryID: number): Promise<ChatCopy[]> {
  const search = new Zotero.Search({ libraryID });
  search.addCondition("tag", "is", CHAT_TAG);
  search.addCondition("itemType", "is", "note");
  search.addCondition("deleted", "false");
  const ids = await search.search();
  const items = await Zotero.Items.getAsync(ids);
  return items.map(chatCopyOf).filter((c): c is ChatCopy => c !== null);
}

export async function copiesOf(
  libraryID: number,
  identity: string,
): Promise<ChatCopy[]> {
  return (await chatCopiesInLibrary(libraryID)).filter(
    (c) => c.identity === identity,
  );
}

/** Group libraries need the opt-in pref (spec: "Group libraries are opt-in"). */
function canLinkInLibrary(libraryID: number): boolean {
  const library = Zotero.Libraries.get(libraryID);
  if (!library) return false;
  return groupWriteAllowed(library.libraryType, getPref("linkChatsInGroups"));
}

function paperHasChat(paper: Zotero.Item, identity: string): boolean {
  return paper
    .getNotes()
    .map((id) => Zotero.Items.get(id))
    .some((note) => note && chatCopyOf(note)?.identity === identity);
}

/**
 * Link one chat to papers: a child-note copy per paper (skipping papers that
 * already have it), all copies of the chat joined through Related. A chat
 * already linked elsewhere in a library keeps that copy's title and fields.
 */
export async function linkChat(
  papers: Zotero.Item[],
  fields: ChatNoteFields,
): Promise<LinkResult> {
  const identity = chatIdentity(fields.ref);
  const result: LinkResult = { created: [], duplicates: [], refusedGroup: [] };
  const byLibrary = new Map<number, Zotero.Item[]>();
  for (const paper of papers) {
    if (!canLinkInLibrary(paper.libraryID)) {
      result.refusedGroup.push(paper);
      continue;
    }
    if (paperHasChat(paper, identity)) {
      result.duplicates.push(paper);
      continue;
    }
    const group = byLibrary.get(paper.libraryID) ?? [];
    group.push(paper);
    byLibrary.set(paper.libraryID, group);
  }

  for (const [libraryID, libraryPapers] of byLibrary) {
    const existing = await copiesOf(libraryID, identity);
    const noteFields = existing[0]?.parsed.fields ?? fields;
    await Zotero.DB.executeTransaction(async () => {
      const created: Zotero.Item[] = [];
      for (const paper of libraryPapers) {
        const note = new Zotero.Item("note");
        note.libraryID = libraryID;
        note.parentID = paper.id;
        note.setNote(renderChatNote(noteFields));
        note.addTag(CHAT_TAG);
        await note.save();
        created.push(note);
      }
      await relateAll([...existing.map((c) => c.note), ...created]);
      result.created.push(...created);
    });
  }
  return result;
}

/** Make every pair of notes Related; saves only notes that changed. */
async function relateAll(notes: Zotero.Item[]): Promise<void> {
  const changed = new Set<Zotero.Item>();
  for (const a of notes) {
    for (const b of notes) {
      if (a !== b && a.addRelatedItem(b)) changed.add(a);
    }
  }
  for (const note of changed) {
    await note.save({ skipDateModifiedUpdate: true });
  }
}

/**
 * Rewrite the title and fields of every copy of `copy`'s chat, keeping each
 * copy's own notes (spec: "Edits propagate to every copy"). Returns the
 * number of copies rewritten.
 */
export async function updateChat(
  copy: ChatCopy,
  fields: ChatNoteFields,
): Promise<number> {
  const copies = await copiesOf(copy.note.libraryID, copy.identity);
  await Zotero.DB.executeTransaction(async () => {
    for (const c of copies) {
      c.note.setNote(rewriteChatNote(c.note.getNote(), fields));
      await c.note.save();
    }
  });
  return copies.length;
}
