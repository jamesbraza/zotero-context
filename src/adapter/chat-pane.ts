/**
 * claude.ai beside the PDF (add-chat-links design D5; spec: chat-pane). The
 * only code that knows the reader tab's private layout (`_tabContainer`) and
 * claude.ai's page structure. Failures return null/false, like the reader
 * adapter, so callers can fall back to the clipboard intro.
 *
 * Safety: the pane is a remote content <browser> (with Fission, its own
 * isolated `https://claude.ai` content process), so the page can't reach
 * Zotero. Page operations run from a frame script in a sandbox whose
 * principal is the page's, so nothing privileged runs in the page and page
 * CSP doesn't apply. The script ships as a `data:` URI because content
 * processes can't load the plugin's chrome/resource files (spike S1).
 */
import { logError } from "../utils/log";

declare const Services: any;
declare const Components: any;

type ReaderInstance = _ZoteroTypes.ReaderInstance;

export interface ChatPane {
  reader: ReaderInstance;
  splitter: Element;
  container: HTMLElement;
  title: Element;
  browser: any;
  /** Keeps progress listeners alive (they're held weakly). */
  listeners: Set<object>;
  /** The document current before the last loadInPane, so fills wait for
   * the new one instead of acting on the page being replaced. */
  previousDocument?: unknown;
}

const panes = new Map<ReaderInstance, ChatPane>();
const scriptedManagers = new WeakSet<object>();

const MSG_FILL = "zotero-context:fill";
const MSG_FILL_RESULT = "zotero-context:fill-result";

/** Runs in the page's sandbox: wait for claude.ai's editor, attach the PDF
 * through the page's own file input, then type the intro. */
const FILL_SOURCE = `(async () => {
  const { bytes, fileName, text, timeoutMs } = zcArgs;
  const deadline = Date.now() + timeoutMs;
  const find = () => document.querySelector('.ProseMirror[contenteditable="true"]');
  let editor = find();
  while (!editor && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    editor = find();
  }
  if (!editor) return "no-editor";
  if (bytes) {
    const input = document.querySelector('input[type=file][data-testid="file-upload"]');
    if (!input) return "no-file-input";
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], fileName, { type: "application/pdf" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  editor.focus();
  if (document.execCommand("insertText", false, text)) return "ok";
  // insertText needs keyboard focus; without it, write paragraphs into the
  // editor's DOM, which ProseMirror's DOM observer reads back into its state
  const paragraphs = text.split("\\n").map((line) => {
    const p = document.createElement("p");
    if (line) p.textContent = line;
    else p.append(document.createElement("br"));
    return p;
  });
  editor.replaceChildren(...paragraphs);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  return editor.textContent.includes(text.split("\\n")[0]) ? "ok" : "insert-refused";
})()`;

const FRAME_SCRIPT = `
addMessageListener(${JSON.stringify(MSG_FILL)}, async (msg) => {
  const { id, ...args } = msg.data;
  let result = "error";
  const win = content;
  const sb = Cu.Sandbox(win, { sandboxPrototype: win, wantXrays: false, sameZoneAs: win });
  try {
    sb.zcArgs = Cu.cloneInto(args, sb);
    result = String(await Cu.evalInSandbox(${JSON.stringify(FILL_SOURCE)}, sb));
  } catch (e) {
    result = "error: " + String(e);
  }
  try { Cu.nukeSandbox(sb); } catch (e) {}
  sendAsyncMessage(${JSON.stringify(MSG_FILL_RESULT)}, { id, result });
});`;

function tabContainer(reader: ReaderInstance): Element | null {
  const container = (reader as unknown as { _tabContainer?: Element })
    ._tabContainer;
  return container?.isConnected ? container : null;
}

export function getPane(reader: ReaderInstance): ChatPane | null {
  const pane = panes.get(reader);
  if (pane && !pane.container.isConnected) {
    panes.delete(reader);
    return null;
  }
  return pane ?? null;
}

/**
 * Add the pane (splitter + header + browser) to the right of the PDF. Idempotent.
 */
export function mountPane(
  reader: ReaderInstance,
  opts: { width: number; onClose: () => void; onResize: (w: number) => void },
): ChatPane | null {
  const existing = getPane(reader);
  if (existing) return existing;
  try {
    const host = tabContainer(reader);
    if (!host?.ownerDocument) return null;
    const doc = host.ownerDocument as Document & {
      createXULElement: (tag: string) => Element;
    };

    const splitter = doc.createXULElement("splitter");
    splitter.setAttribute("resizebefore", "closest");
    splitter.setAttribute("resizeafter", "closest");
    splitter.classList.add("zotero-context-chat-splitter");

    const container = doc.createXULElement("vbox") as unknown as HTMLElement;
    container.classList.add("zotero-context-chat-pane");
    container.style.width = `${String(opts.width)}px`;
    container.style.minWidth = "280px";

    const header = doc.createXULElement("hbox") as unknown as HTMLElement;
    header.setAttribute("align", "center");
    header.style.padding = "2px 6px";
    header.style.borderBottom = "1px solid var(--fill-quinary, #ddd)";
    const title = doc.createXULElement("label");
    title.setAttribute("flex", "1");
    title.setAttribute("crop", "end");
    title.setAttribute("value", "claude.ai");
    const close = doc.createElement("button");
    close.textContent = "×";
    close.title = "Close claude.ai pane";
    close.style.cssText =
      "border:none;background:none;font-size:16px;cursor:pointer";
    close.addEventListener("click", opts.onClose);
    header.append(title, close);

    const browser = doc.createXULElement("browser") as any;
    for (const [k, v] of Object.entries({
      type: "content",
      remote: "true",
      remoteType: "web",
      maychangeremoteness: "true",
      messagemanagergroup: "browsers",
      flex: "1",
    })) {
      browser.setAttribute(k, v);
    }
    container.append(header, browser);
    host.append(splitter, container);

    splitter.addEventListener("mouseup", () => {
      opts.onResize(Math.round(container.getBoundingClientRect().width));
    });

    const pane: ChatPane = {
      reader,
      splitter,
      container,
      title,
      browser,
      listeners: new Set(),
    };
    panes.set(reader, pane);
    return pane;
  } catch (e) {
    logError("mountPane", e);
    return null;
  }
}

export function unmountPane(reader: ReaderInstance): void {
  const pane = panes.get(reader);
  panes.delete(reader);
  if (!pane) return;
  try {
    pane.listeners.clear();
    pane.splitter.remove();
    pane.container.remove();
  } catch (e) {
    logError("unmountPane", e);
  }
}

export function unmountAllPanes(): void {
  for (const reader of [...panes.keys()]) unmountPane(reader);
}

export function setPaneTitle(pane: ChatPane, text: string): void {
  pane.title.setAttribute("value", text || "claude.ai");
}

/**
 * Navigate the pane. `triggeringPrincipal` defaults to a null principal;
 * tests pass the system principal to load `data:` fixtures, since Firefox
 * blocks content-triggered top-level `data:` navigations (the fixture's own
 * document still gets an unprivileged null principal).
 */
export function loadInPane(
  pane: ChatPane,
  url: string,
  triggeringPrincipal?: unknown,
): boolean {
  try {
    pane.previousDocument = pane.browser.browsingContext?.currentWindowGlobal;
    pane.browser.loadURI(Services.io.newURI(url), {
      triggeringPrincipal:
        triggeringPrincipal ??
        Services.scriptSecurityManager.createNullPrincipal({}),
    });
    return true;
  } catch (e) {
    logError("loadInPane", e);
    return false;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });

/** Wait until the pane shows a document from `origin` that has loaded. */
async function waitForDocument(
  pane: ChatPane,
  origin: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const spec: string = pane.browser.currentURI?.spec ?? "";
    const loading: boolean =
      pane.browser.webProgress?.isLoadingDocument ?? true;
    const current = pane.browser.browsingContext?.currentWindowGlobal;
    const replaced = !current || current !== pane.previousDocument;
    if (
      replaced &&
      spec.startsWith(origin) &&
      !loading &&
      pane.browser.messageManager
    ) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

/** "ok", or why filling failed: "no-document", "no-editor" (e.g. signed
 * out), "no-file-input", "insert-refused", "timeout", or "error: …". */
export type FillResult = string;

/**
 * Put the PDF and intro into claude.ai's chat box. Anything but "ok" means
 * the page wasn't ready or changed shape, so the caller falls back.
 */
export async function fillChatBox(
  pane: ChatPane,
  args: { bytes: Uint8Array | null; fileName: string; text: string },
  opts: { origin?: string; timeoutMs?: number } = {},
): Promise<FillResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  try {
    if (
      !(await waitForDocument(
        pane,
        opts.origin ?? "https://claude.ai/",
        timeoutMs,
      ))
    ) {
      return "no-document";
    }
    // insertText needs the pane focused; the page script falls back if not
    pane.browser.focus();
    const mm = pane.browser.messageManager;
    if (!scriptedManagers.has(mm)) {
      mm.loadFrameScript(
        `data:application/javascript;charset=utf-8,${encodeURIComponent(FRAME_SCRIPT)}`,
        true,
      );
      scriptedManagers.add(mm);
    }
    const id = Math.random().toString(36).slice(2);
    return await new Promise<FillResult>((resolve) => {
      const finish = (result: FillResult) => {
        mm.removeMessageListener(MSG_FILL_RESULT, onResult);
        resolve(result);
      };
      const onResult = (msg: { data: { id: string; result: string } }) => {
        if (msg.data.id === id) finish(msg.data.result);
      };
      mm.addMessageListener(MSG_FILL_RESULT, onResult);
      mm.sendAsyncMessage(MSG_FILL, { id, ...args, timeoutMs });
      setTimeout(() => {
        finish("timeout");
      }, timeoutMs + 5_000);
    });
  } catch (e) {
    logError("fillChatBox", e);
    return `error: ${String(e)}`;
  }
}

const CHAT_URL_RE =
  /^https:\/\/claude\.ai\/chat\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[?#].*)?$/i;

/**
 * Call `onChat` once, for the first top-level claude.ai/chat/<uuid> the pane
 * reaches (the URL appears by pushState on first send; subframes also
 * report locations, so they're ignored). Returns a function that stops
 * watching.
 */
export function watchFirstChat(
  pane: ChatPane,
  onChat: (url: string) => void,
): () => void {
  const Ci = Components.interfaces;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    try {
      pane.browser.removeProgressListener(listener);
    } catch {
      // Browser already gone (pane closed)
    }
    pane.listeners.delete(listener);
  };
  const listener = {
    QueryInterface: ChromeUtils.generateQI([
      "nsIWebProgressListener",
      "nsISupportsWeakReference",
    ]),
    onLocationChange(
      webProgress: { isTopLevel?: boolean } | null,
      _request: unknown,
      location: { spec: string },
    ) {
      if (done || webProgress?.isTopLevel === false) return;
      if (!CHAT_URL_RE.test(location.spec)) return;
      const url = location.spec.replace(/[?#].*$/, "");
      stop();
      onChat(url);
    },
  };
  try {
    pane.listeners.add(listener);
    pane.browser.addProgressListener(
      listener,
      Ci.nsIWebProgress.NOTIFY_LOCATION,
    );
  } catch (e) {
    logError("watchFirstChat", e);
    stop();
  }
  return stop;
}

/** The chat's title once claude.ai names it ("<title> - Claude"), or "". */
export async function chatTitle(
  pane: ChatPane,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw: string = pane.browser.contentTitle ?? "";
    const m = /^(.*\S)\s+-\s+Claude$/.exec(raw);
    if (m?.[1] && !/^New (?:session|chat)$/i.test(m[1])) return m[1];
    await sleep(500);
  }
  return "";
}
