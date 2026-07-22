/**
 * Grab mode (see specs: grab-mode, text-grab, area-grab): clicks-not-drags
 * capture in the reader.
 *
 * While active: hovering text glows the sentence under the cursor — click
 * grabs it as text, shift-click extends the range from the last text grab.
 * Clicking outside text anchors an area-grab corner; a second click captures
 * the region as a captioned PNG. Esc cancels the pending corner, then exits.
 * On documents without segment geometry, text-snap silently degrades and
 * area grab remains.
 */
import {
  clearReaderSelection,
  clientToPdfPoint,
  cropPageRegion,
  getPageAt,
  getPageLabel,
  getPageEl,
  getReaderDocument,
  pdfRectToClientRect,
  segmentApiAbsent,
} from "../adapter/reader";
import {
  hitTestTarget,
  joinTargetRange,
  type SnapTarget,
} from "../core/targets";
import { deliverGrab } from "./deliver-clipboard";
import {
  getPaperRef,
  prefetchOutline,
  resolveSection,
  trail,
  type PaperRef,
} from "./grab-session";
import { registerChord } from "./hotkeys";
import { guard, notify } from "./notify";
import {
  getPageTargets,
  getSegmentsCached,
  textSnapStateFrom,
} from "./segment-cache";
import { logError } from "../utils/log";

type ReaderInstance = _ZoteroTypes.ReaderInstance;

/** Per-chat-image cap (claude.ai rejects >5 MB images); undershot slightly. */
const MAX_IMAGE_BYTES = 4_800_000;

interface PendingCorner {
  /** First corner in PDF units (origin bottom-left). Client coordinates go
   * stale on scroll/zoom between the two clicks, so the anchor lives on the
   * page and is reconverted to client space at each use. */
  pdfX: number;
  pdfY: number;
  pageIndex: number;
}

/** Marker for a page whose snap targets are still being computed. */
const PENDING = "pending" as const;

interface GrabState {
  active: boolean;
  pending: PendingCorner | null;
  previewEl: HTMLElement | null;
  buttonEl: HTMLElement | null;
  /** Whether the document has text segments: false = segment API absent
   * (permanent; hover gate closes), null = unknown — still loading or a
   * transient miss, so hovers keep trying (see textSnapStateFrom). */
  textSnapReady: boolean | null;
  /** Sentence targets per page, filled lazily as pages are hovered. */
  pageTargets: Map<number, SnapTarget[] | typeof PENDING>;
  glowEls: HTMLElement[];
  hoverKey: string;
  /** Target anchoring shift-click range extension. */
  textAnchor: { pageIndex: number; index: number } | null;
  teardown: (() => void)[];
}

const states = new WeakMap<object, GrabState>();

/** Readers with grab mode currently active — iterable for shutdown teardown
 * (the WeakMap alone cannot be iterated). */
const activeReaders = new Set<ReaderInstance>();

function getState(reader: ReaderInstance): GrabState {
  let s = states.get(reader as object);
  if (!s) {
    s = {
      active: false,
      pending: null,
      previewEl: null,
      buttonEl: null,
      textSnapReady: null,
      pageTargets: new Map(),
      glowEls: [],
      hoverKey: "",
      textAnchor: null,
      teardown: [],
    };
    states.set(reader as object, s);
  }
  return s;
}

export function registerGrabMode() {
  Zotero.Reader.registerEventListener(
    "renderToolbar",
    (event) => {
      const { reader, doc, append } = event as any;
      const button = doc.createElement("button");
      button.className = "toolbar-button zotero-context-grab-button";
      button.title =
        "Grab mode (Zotero Context): click text to copy it, " +
        "or click two corners to copy a region (Ctrl+Alt+G)";
      button.textContent = "⌖";
      button.style.fontSize = "16px";
      button.addEventListener("click", () => toggleGrabMode(reader, button));
      append(button);
      getState(reader).buttonEl = button;
    },
    addon.data.config.addonID,
  );

  // Toggle hotkey for the focused reader tab (hold-semantics pref is backlog)
  registerChord("g", () => {
    const reader = Zotero.Reader.getByTabID(
      ztoolkit.getGlobal("Zotero_Tabs").selectedID,
    );
    if (reader) toggleGrabMode(reader);
  });
}

/** Deactivate grab mode everywhere — called on plugin shutdown so no capture
 * listeners survive on reader documents (they'd otherwise swallow clicks
 * until the tab closes). */
export function deactivateAllGrabModes() {
  for (const reader of [...activeReaders]) {
    const state = states.get(reader as object);
    if (state?.active) {
      deactivate(reader, state);
      syncButton(state);
    }
  }
}

export function toggleGrabMode(
  reader: ReaderInstance,
  button?: HTMLElement | null,
) {
  const state = getState(reader);
  if (button) state.buttonEl = button;
  if (state.active) {
    deactivate(reader, state);
  } else {
    activate(reader, state);
  }
  syncButton(state);
}

function syncButton(state: GrabState) {
  if (!state.buttonEl) return;
  state.buttonEl.style.backgroundColor = state.active
    ? "var(--color-accent, #4072e5)"
    : "";
}

function activate(reader: ReaderInstance, state: GrabState) {
  const doc = getReaderDocument(reader);
  const root = doc?.documentElement as HTMLElement | null;
  const body = doc?.body;
  if (!doc || !root || !body) {
    notify("Grab mode unavailable in this reader", false);
    return;
  }
  state.active = true;
  state.pending = null;
  state.hoverKey = "";
  state.pageTargets.clear(); // recompute; pages may have rendered since
  activeReaders.add(reader);
  state.teardown.push(() => activeReaders.delete(reader));

  // Warm caches so grab-time work is instant (section resolution must never
  // delay delivery — spec: grab-provenance)
  prefetchOutline(reader);
  void getSegmentsCached(reader)
    .then((segments) => {
      if (!state.active) return;
      state.textSnapReady = textSnapStateFrom(
        segments,
        segmentApiAbsent(reader),
      );
      if (segments) {
        notify("Sentence snap ready — hover text and click");
      } else if (state.textSnapReady === false) {
        notify(
          "Text snap unavailable on this document — area grab still works",
          false,
        );
      }
      // Transient miss (textSnapReady left null): stay quiet — the lazy
      // target path retries on hover and snap activates when segments land
    })
    .catch((e) => logError("segment load", e));

  root.style.cursor = "crosshair";
  state.teardown.push(() => {
    root.style.cursor = "";
  });

  const preview = doc.createElement("div");
  Object.assign(preview.style, {
    position: "fixed",
    border: "2px dashed #4072e5",
    background: "rgba(64,114,229,0.08)",
    pointerEvents: "none",
    zIndex: "99999",
    display: "none",
  });
  body.appendChild(preview);
  state.previewEl = preview;
  state.teardown.push(() => {
    preview.remove();
    state.previewEl = null;
  });
  state.teardown.push(() => clearGlow(state));

  const onClick = (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    clearReaderSelection(reader);
    void guard("Grab", () => handleClick(reader, state, ev));
  };
  // The reader starts its own selection on window-capture pointer events,
  // which we cannot preempt — so swallow what we can over pages and clear
  // the reader's selection right after it appears (mouseup + click).
  const onMouseDownUp = (ev: MouseEvent) => {
    if (getPageAt(reader, ev.clientX, ev.clientY)) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.type === "mouseup") clearReaderSelection(reader);
    }
  };
  const onMove = (ev: MouseEvent) => {
    if (state.pending) {
      updatePreview(reader, state, ev);
    } else {
      updateHover(reader, state, ev);
    }
  };
  const onScroll = () => clearGlow(state);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    if (state.pending) {
      clearPending(state);
    } else {
      deactivate(reader, state);
      syncButton(state);
    }
  };
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("mousedown", onMouseDownUp, true);
  doc.addEventListener("mouseup", onMouseDownUp, true);
  doc.addEventListener("mousemove", onMove, true);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("keydown", onKey, true);
  state.teardown.push(() => {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("mousedown", onMouseDownUp, true);
    doc.removeEventListener("mouseup", onMouseDownUp, true);
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("keydown", onKey, true);
  });

  // Drop any pre-existing selection so it can't anchor shift-clicks
  doc.defaultView?.getSelection()?.removeAllRanges();
  clearReaderSelection(reader);

  notify("Grab mode ON — click text, or click two corners (Esc to exit)");
}

function deactivate(reader: ReaderInstance, state: GrabState) {
  state.active = false;
  state.pending = null;
  state.hoverKey = "";
  state.textAnchor = null;
  for (const fn of state.teardown.splice(0)) {
    // Each teardown step runs even if an earlier one fails — a partial
    // teardown would leave capture listeners on the reader document
    try {
      fn();
    } catch (e) {
      logError("grab-mode teardown", e);
    }
  }
}

function clearPending(state: GrabState) {
  state.pending = null;
  if (state.previewEl) state.previewEl.style.display = "none";
}

function clearGlow(state: GrabState) {
  for (const el of state.glowEls.splice(0)) el.remove();
  state.hoverKey = "";
}

/**
 * Current client-space position of the pending corner (tracks scroll/zoom),
 * with the freshly-resolved page element — the one stored at click time can
 * be replaced when pdf.js re-renders. Null when the anchor's page is not
 * mounted right now.
 */
function pendingClientPoint(
  reader: ReaderInstance,
  state: GrabState,
): { x: number; y: number; pageEl: Element } | null {
  if (!state.pending) return null;
  const { pdfX, pdfY, pageIndex } = state.pending;
  const pageEl = getPageEl(reader, pageIndex);
  if (!pageEl) return null;
  const r = pdfRectToClientRect(reader, pageEl, pageIndex, [
    pdfX,
    pdfY,
    pdfX,
    pdfY,
  ]);
  return r ? { x: r.left, y: r.top, pageEl } : null;
}

function updatePreview(
  reader: ReaderInstance,
  state: GrabState,
  ev: MouseEvent,
) {
  if (!state.pending || !state.previewEl) return;
  const p = pendingClientPoint(reader, state);
  if (!p) {
    // Anchor page scrolled out of the render window — the preview reappears
    // when it mounts again; the anchor itself stays valid
    state.previewEl.style.display = "none";
    return;
  }
  Object.assign(state.previewEl.style, {
    display: "block",
    left: `${Math.min(p.x, ev.clientX)}px`,
    top: `${Math.min(p.y, ev.clientY)}px`,
    width: `${Math.abs(ev.clientX - p.x)}px`,
    height: `${Math.abs(ev.clientY - p.y)}px`,
  });
}

type TargetHit =
  | { kind: "hit"; index: number; pageIndex: number; pageEl: Element }
  | { kind: "pending" }
  | { kind: "none" };

function targetAt(
  reader: ReaderInstance,
  state: GrabState,
  clientX: number,
  clientY: number,
): TargetHit {
  if (state.textSnapReady === false) return { kind: "none" };
  const hit = getPageAt(reader, clientX, clientY);
  if (!hit) return { kind: "none" };
  const targets = state.pageTargets.get(hit.pageIndex);
  if (targets === undefined) {
    // Kick off lazy target computation for this page
    state.pageTargets.set(hit.pageIndex, PENDING);
    getPageTargets(reader, hit.pageIndex)
      .then((computed) => {
        if (!state.active) return;
        if (computed) {
          state.pageTargets.set(hit.pageIndex, computed);
        } else {
          state.pageTargets.delete(hit.pageIndex); // retry on next hover
          // The activation-time fetch can race the reader view; if the
          // segment API turns out absent once the view exists, close the
          // gate here (mirroring activation) — otherwise hovers stay
          // "pending" forever and clicks are swallowed, killing area grab
          if (state.textSnapReady === null && segmentApiAbsent(reader)) {
            state.textSnapReady = false;
            notify(
              "Text snap unavailable on this document — area grab still works",
              false,
            );
          }
        }
      })
      .catch((e) => {
        state.pageTargets.delete(hit.pageIndex);
        logError(`page targets (p${hit.pageIndex})`, e);
      });
    return { kind: "pending" };
  }
  if (targets === PENDING) return { kind: "pending" };
  const point = clientToPdfPoint(
    reader,
    hit.pageEl,
    hit.pageIndex,
    clientX,
    clientY,
  );
  if (!point) return { kind: "none" };
  const index = hitTestTarget(targets, point);
  return index >= 0
    ? { kind: "hit", index, pageIndex: hit.pageIndex, pageEl: hit.pageEl }
    : { kind: "none" };
}

function updateHover(reader: ReaderInstance, state: GrabState, ev: MouseEvent) {
  const hit = targetAt(reader, state, ev.clientX, ev.clientY);
  if (hit.kind !== "hit") {
    if (state.hoverKey) clearGlow(state);
    return;
  }
  const key = `${hit.pageIndex}:${hit.index}`;
  if (key === state.hoverKey) return;
  clearGlow(state);
  state.hoverKey = key;

  const doc = getReaderDocument(reader);
  const targets = state.pageTargets.get(hit.pageIndex);
  const target = targets === PENDING ? undefined : targets?.[hit.index];
  if (!doc?.body || !target) return;
  for (const rect of target.rects) {
    const client = pdfRectToClientRect(reader, hit.pageEl, hit.pageIndex, rect);
    if (!client) continue;
    const glow = doc.createElement("div");
    Object.assign(glow.style, {
      position: "fixed",
      left: `${client.left - 2}px`,
      top: `${client.top - 2}px`,
      width: `${client.width + 4}px`,
      height: `${client.height + 4}px`,
      background: "rgba(64,114,229,0.18)",
      borderRadius: "3px",
      pointerEvents: "none",
      zIndex: "99998",
    });
    doc.body.appendChild(glow);
    state.glowEls.push(glow);
  }
}

/** The reader's paper, or null (with a user notice) when unresolvable. */
function resolvePaper(reader: ReaderInstance): PaperRef | null {
  const paper =
    typeof reader.itemID === "number" ? getPaperRef(reader.itemID) : null;
  if (!paper) notify("Grab failed: could not resolve item", false);
  return paper;
}

async function handleClick(
  reader: ReaderInstance,
  state: GrabState,
  ev: MouseEvent,
) {
  // A pending corner always completes (or restarts) the area capture
  if (state.pending) {
    await handleAreaClick(reader, state, ev);
    return;
  }
  const textHit = targetAt(reader, state, ev.clientX, ev.clientY);
  if (textHit.kind === "pending") {
    // Targets still computing — don't misroute the click into an area corner
    return;
  }
  if (textHit.kind === "hit") {
    await handleTextClick(reader, state, ev, textHit);
    return;
  }
  await handleAreaClick(reader, state, ev);
}

async function handleTextClick(
  reader: ReaderInstance,
  state: GrabState,
  ev: MouseEvent,
  hit: { index: number; pageIndex: number },
) {
  const cachedTargets = state.pageTargets.get(hit.pageIndex);
  const targets = cachedTargets === PENDING ? undefined : cachedTargets;
  if (!targets?.length) return;
  const index = hit.index;
  // Shift-extension works within one page; a cross-page shift grabs singly
  const anchor =
    ev.shiftKey &&
    state.textAnchor !== null &&
    state.textAnchor.pageIndex === hit.pageIndex
      ? state.textAnchor.index
      : index;
  if (!ev.shiftKey) {
    state.textAnchor = { pageIndex: hit.pageIndex, index };
  }

  const lo = Math.min(anchor, index);
  const text = joinTargetRange(targets, anchor, index);
  if (!text) return;

  // Resolve everything that can bail BEFORE appending to the trail, so a
  // failed grab never burns the first-for-paper citation flag
  const doc = getReaderDocument(reader);
  const paper = resolvePaper(reader);
  if (!doc || !paper) return;

  const first = targets[lo];
  const pageIndex = first.pageIndex;
  const topY = first.rects[0]?.[3] ?? null;
  const { grab, isFirstForPaper } = trail.append({
    ts: Date.now(),
    kind: "text",
    text,
    source: {
      paperId: paper.paperId,
      pageIndex,
      pageLabel: getPageLabel(reader, pageIndex),
      section: await resolveSection(reader, pageIndex, topY),
    },
  });
  await deliverGrab(doc, grab, isFirstForPaper, paper.info);
  notify(
    ev.shiftKey
      ? "Extended text grab copied — paste it into your chat"
      : "Text grab copied — paste it into your chat (shift-click to extend)",
  );
}

async function handleAreaClick(
  reader: ReaderInstance,
  state: GrabState,
  ev: MouseEvent,
) {
  const hit = getPageAt(reader, ev.clientX, ev.clientY);
  if (!hit) {
    clearPending(state);
    return;
  }
  if (!state.pending || hit.pageIndex !== state.pending.pageIndex) {
    // First corner, or restart on a different page — anchor it on the page
    const pdf = clientToPdfPoint(
      reader,
      hit.pageEl,
      hit.pageIndex,
      ev.clientX,
      ev.clientY,
    );
    if (!pdf) {
      clearPending(state);
      return;
    }
    clearGlow(state);
    state.pending = { pdfX: pdf.x, pdfY: pdf.y, pageIndex: hit.pageIndex };
    updatePreview(reader, state, ev);
    return;
  }

  // Second corner: reconvert the anchor to the CURRENT client space, so a
  // scroll or zoom between the clicks cannot shift the captured region
  const pageIndex = state.pending.pageIndex;
  const anchor = pendingClientPoint(reader, state);
  clearPending(state);
  if (!anchor) {
    notify("Grab failed: could not render region", false);
    return;
  }
  const pageEl = anchor.pageEl;
  const rect = {
    left: Math.min(anchor.x, ev.clientX),
    top: Math.min(anchor.y, ev.clientY),
    width: Math.abs(ev.clientX - anchor.x),
    height: Math.abs(ev.clientY - anchor.y),
  };

  // Resolve everything that can bail BEFORE appending to the trail
  const png = cropPageRegion(reader, pageEl, rect, MAX_IMAGE_BYTES);
  if (!png) {
    notify("Grab failed: could not render region", false);
    return;
  }
  const doc = getReaderDocument(reader);
  const paper = resolvePaper(reader);
  if (!doc || !paper) return;

  const { grab, isFirstForPaper } = trail.append({
    ts: Date.now(),
    kind: "image",
    imageDataUrl: png,
    source: {
      paperId: paper.paperId,
      pageIndex,
      pageLabel: getPageLabel(reader, pageIndex),
      section: await resolveSection(
        reader,
        pageIndex,
        clientToPdfPoint(reader, pageEl, pageIndex, rect.left, rect.top)?.y,
      ),
    },
  });
  await deliverGrab(doc, grab, isFirstForPaper, paper.info);
  notify("Grab copied — paste it into your chat");
}
