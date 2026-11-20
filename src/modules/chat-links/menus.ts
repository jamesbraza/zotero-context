/**
 * Item context menus for chat links (spec: chat-links "Link chat dialog",
 * "Chat note actions"). Labels live in mainWindow.ftl, since MenuManager
 * resolves l10n IDs in the main window.
 */
import { resumeCommand } from "../../core/chat-link";
import { guard } from "../notify";
import { alsoLinkTo, copyResumeCommand, openChatLink } from "./actions";
import { editChatDialog, linkChatDialog } from "./dialog";
import { type ChatCopy, chatCopyOf } from "./store";

const MENU_ID = "zotero-context-chat-links";
const TAB_MENU_ID = "zotero-context-chat-links-tab";

type Context = _ZoteroTypes.MenuManager.LibraryMenuContext;

function papersOf(items: Zotero.Item[] | undefined): Zotero.Item[] {
  return items?.length && items.every((i) => i.isRegularItem()) ? items : [];
}

/** A reader tab's item is its attachment; link its parent paper. */
function readerPaperOf(items: Zotero.Item[]): Zotero.Item[] {
  const item = items[0];
  const paper = item?.isAttachment() ? item.parentItem : item;
  return paper?.isRegularItem() ? [paper] : [];
}

function chatNoteOf(items: Zotero.Item[] | undefined): ChatCopy | null {
  const only = items?.length === 1 ? items[0] : undefined;
  return only ? chatCopyOf(only) : null;
}

export function registerChatLinkMenus(): void {
  const l10n = (key: string) => `${addon.data.config.addonRef}-${key}`;
  const noteItem = (
    key: string,
    context: string,
    showFor: (copy: ChatCopy) => boolean,
    run: (note: Zotero.Item) => Promise<void> | void,
  ) => ({
    menuType: "menuitem" as const,
    l10nID: l10n(key),
    onShowing: (_e: Event, ctx: Context) => {
      const copy = chatNoteOf(ctx.items);
      ctx.setVisible(copy !== null && showFor(copy));
    },
    onCommand: (_e: Event, ctx: Context) => {
      const copy = chatNoteOf(ctx.items);
      if (copy) void guard(context, () => run(copy.note));
    },
  });

  Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: addon.data.config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: l10n("menu-link-chat"),
        onShowing: (_e, ctx) => {
          ctx.setVisible(papersOf(ctx.items).length > 0);
        },
        onCommand: (_e, ctx) => {
          const papers = papersOf(ctx.items);
          void guard("Link chat", () => linkChatDialog(papers));
        },
      },
      noteItem("menu-also-link-to", "Also link to", () => true, alsoLinkTo),
      noteItem(
        "menu-edit-chat-link",
        "Edit chat link",
        () => true,
        editChatDialog,
      ),
      noteItem(
        "menu-copy-resume-command",
        "Copy resume command",
        (c) => resumeCommand(c.parsed.fields.ref) !== null,
        copyResumeCommand,
      ),
      noteItem(
        "menu-open-chat-link",
        "Open chat link",
        (c) => c.parsed.fields.ref.kind === "web",
        openChatLink,
      ),
    ],
  });

  // The same "Link chat…" on a reader tab's right-click menu, for the paper
  // that tab shows
  Zotero.MenuManager.registerMenu({
    menuID: TAB_MENU_ID,
    pluginID: addon.data.config.addonID,
    target: "main/tab",
    menus: [
      {
        menuType: "menuitem",
        l10nID: l10n("menu-link-chat"),
        enableForTabTypes: ["reader/*"],
        onShowing: (_e, ctx) => {
          ctx.setVisible(readerPaperOf(ctx.items).length > 0);
        },
        onCommand: (_e, ctx) => {
          const papers = readerPaperOf(ctx.items);
          void guard("Link chat", () => linkChatDialog(papers));
        },
      },
    ],
  });
}

export function unregisterChatLinkMenus(): void {
  Zotero.MenuManager.unregisterMenu(MENU_ID);
  Zotero.MenuManager.unregisterMenu(TAB_MENU_ID);
}
