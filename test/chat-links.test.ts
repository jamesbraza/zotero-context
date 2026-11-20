import { assert } from "chai";
import type { ChatNoteFields } from "../src/core/chat-note";
import { parseChatNote, renderChatNote } from "../src/core/chat-note";
import {
  CHAT_TAG,
  chatCopyOf,
  copiesOf,
  linkChat,
  updateChat,
} from "../src/modules/chat-links/store";
import { getPref, setPref } from "../src/utils/prefs";

const FIELDS: ChatNoteFields = {
  ref: {
    kind: "web",
    tool: "claude",
    url: "https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998",
  },
  topic: "Why multi-head beats single-head",
  started: "2026-11-19",
};

const SESSION: ChatNoteFields = {
  ref: {
    kind: "session",
    harness: "claude-code",
    sessionId: "888c8ed8-90a2-40ac-9a46-dcd7a8559d34",
  },
  topic: "vaswani-2017",
  started: "2026-11-19",
  machine: "TEST-HOST",
};

async function makePaper(title: string): Promise<Zotero.Item> {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", title);
  await item.saveTx();
  return item;
}

function chatNotesOf(paper: Zotero.Item): Zotero.Item[] {
  return paper
    .getNotes()
    .map((id) => Zotero.Items.get(id))
    .filter((n): n is Zotero.Item => n !== false && chatCopyOf(n) !== null);
}

describe("chat-links store", function () {
  this.timeout(30_000);
  let paperA: Zotero.Item;
  let paperB: Zotero.Item;

  beforeEach(async function () {
    paperA = await makePaper("Attention Is All You Need");
    paperB = await makePaper("Fast Transformer Decoding");
  });

  afterEach(async function () {
    // Erasing a parent erases its child notes too
    for (const paper of [paperA, paperB]) await paper.eraseTx();
  });

  it("links a chat as a tagged child note under the paper", async function () {
    const result = await linkChat([paperA], FIELDS);
    assert.lengthOf(result.created, 1);
    const notes = chatNotesOf(paperA);
    assert.lengthOf(notes, 1);
    const note = notes[0];
    assert.isTrue(note.hasTag(CHAT_TAG));
    assert.equal(note.parentID, paperA.id);
    assert.equal(
      note.getNoteTitle(),
      "Claude chat: Why multi-head beats single-head",
    );
  });

  it("writes Resume, Session, and Machine for CLI sessions", async function () {
    await linkChat([paperA], SESSION);
    const html = chatNotesOf(paperA)[0].getNote();
    assert.include(
      html,
      "Resume: <code>claude --resume 888c8ed8-90a2-40ac-9a46-dcd7a8559d34</code>",
    );
    assert.include(html, "Machine: TEST-HOST");
  });

  it("never duplicates a chat on the same paper", async function () {
    await linkChat([paperA], FIELDS);
    const again = await linkChat([paperA], {
      ...FIELDS,
      ref: {
        kind: "web",
        tool: "claude",
        url: "https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998/",
      },
    });
    assert.lengthOf(again.created, 0);
    assert.lengthOf(again.duplicates, 1);
    assert.lengthOf(chatNotesOf(paperA), 1);
  });

  it("gives each paper a copy, joined through Related", async function () {
    const result = await linkChat([paperA, paperB], FIELDS);
    assert.lengthOf(result.created, 2);
    const [a, b] = [chatNotesOf(paperA)[0], chatNotesOf(paperB)[0]];
    assert.include(a.relatedItems, b.key);
    assert.include(b.relatedItems, a.key);
  });

  it("copies an already-linked chat's title and fields to a new paper", async function () {
    await linkChat([paperA], FIELDS);
    // Pasting the same URL for paper B, with a different title typed in
    await linkChat([paperB], { ...FIELDS, topic: "Something else" });
    const b = chatNotesOf(paperB)[0];
    assert.equal(
      b.getNoteTitle(),
      "Claude chat: Why multi-head beats single-head",
    );
    assert.include(b.relatedItems, chatNotesOf(paperA)[0].key);
  });

  it("propagates edits to every copy and keeps each copy's notes", async function () {
    await linkChat([paperA, paperB], FIELDS);
    const a = chatNotesOf(paperA)[0];
    // The user writes personal notes into copy A only
    a.setNote(renderChatNote(FIELDS, "<p>mine</p>"));
    await a.saveTx();
    const copy = chatCopyOf(a)!; // a is a chat note
    assert.equal(await updateChat(copy, { ...FIELDS, topic: "Retitled" }), 2);

    for (const paper of [paperA, paperB]) {
      const note = chatNotesOf(paper)[0];
      assert.equal(note.getNoteTitle(), "Claude chat: Retitled");
    }
    assert.equal(
      parseChatNote(chatNotesOf(paperA)[0].getNote())?.userNotesHtml,
      "<p>mine</p>",
    );
    assert.equal(
      parseChatNote(chatNotesOf(paperB)[0].getNote())?.userNotesHtml,
      "",
    );
    assert.lengthOf(
      await copiesOf(Zotero.Libraries.userLibraryID, copy.identity),
      2,
    );
  });

  it("refuses group libraries unless opted in", async function () {
    const libraries = Zotero.Libraries as unknown as {
      get: (id: number) => object | false;
    };
    const originalGet = libraries.get;
    const realGet = originalGet.bind(Zotero.Libraries);
    const prefBefore = getPref("linkChatsInGroups");
    // Pretend the user library is a group library; everything else about it
    // stays real, since Zotero's own save path reads it too
    libraries.get = (id) => {
      const real = realGet(id);
      return real
        ? new Proxy(real, {
            get: (target, prop) =>
              prop === "libraryType"
                ? "group"
                : (Reflect.get(target, prop) as unknown),
          })
        : real;
    };
    try {
      setPref("linkChatsInGroups", false);
      const refused = await linkChat([paperA], FIELDS);
      assert.lengthOf(refused.refusedGroup, 1);
      assert.lengthOf(chatNotesOf(paperA), 0);

      setPref("linkChatsInGroups", true);
      const allowed = await linkChat([paperA], FIELDS);
      assert.lengthOf(allowed.created, 1);
    } finally {
      libraries.get = originalGet;
      setPref("linkChatsInGroups", prefBefore);
    }
  });
});
