/**
 * Session-bundle delivery (see specs: grab-trail, clipboard-delivery): one
 * hotkey ferries accumulated grabs.
 *
 *   Ctrl+Alt+B       — bundle the grabs since the last bundle (delta); when
 *                      the bundle has image grabs, repeated presses cycle
 *                      each captioned image onto the clipboard. The cycle
 *                      persists until its images are exhausted (no timeout).
 *   Ctrl+Alt+Shift+B — full session recap (for re-seeding a fresh chat);
 *                      also abandons any in-progress image cycle.
 *   Ctrl+Alt+X       — reset: clear the session trail.
 */
import { renderBundle, type BundleRender } from "../core/bundle";
import { addCaptionStrip } from "../core/image";
import { copyImage, copyText } from "./clipboard";
import { registerChord } from "./hotkeys";
import { guard, notify } from "./notify";
import { paperInfoMap, trail } from "./grab-session";
import { logError } from "../utils/log";

let cursor: {
  images: BundleRender["images"];
  next: number;
} | null = null;

/** Trail watermark at the last bundle copy; delta bundles start here. */
let watermark = 0;

export function registerBundleDelivery() {
  registerChord("b", (ev) => void guard("Bundle", () => step(ev.shiftKey)));
  registerChord("x", () => {
    const n = trail.length;
    trail.clear();
    watermark = 0;
    cursor = null;
    notify(n ? `Trail cleared (${n} grabs dropped)` : "Trail already empty");
  });
}

async function step(fullRecap: boolean) {
  // Mid-bundle: cycle the next image (a shift press restarts instead)
  if (!fullRecap && cursor) {
    // In bounds: cursor is only created as { next: 0 } over nonempty images,
    // and nulled below the moment next reaches images.length (left === 0)
    const { grab, caption } = cursor.images[cursor.next]!;
    const doc = Zotero.getMainWindow().document;
    let png = grab.imageDataUrl!;
    try {
      png = await addCaptionStrip(doc, png, caption);
    } catch (e) {
      logError("caption strip", e);
    }
    copyImage(png, caption);
    // Only advance past an image once its copy succeeded
    cursor.next++;
    const left = cursor.images.length - cursor.next;
    if (left > 0) {
      notify(`Image copied — paste it, then press again (${left} left)`);
    } else {
      notify("Last image copied — paste it. Bundle complete");
      cursor = null;
    }
    return;
  }
  cursor = null;

  const grabs = fullRecap ? trail.list() : trail.listSince(watermark);
  if (!grabs.length) {
    notify(
      fullRecap
        ? "No grabs this session yet"
        : "No new grabs since the last bundle (Ctrl+Alt+Shift+B for full recap)",
      false,
    );
    return;
  }
  const papers = paperInfoMap();
  for (const grab of grabs) {
    if (!papers.has(grab.source.paperId)) {
      // Should be impossible: every trail append resolves its paper first
      logError("bundle", `missing paper info for ${grab.source.paperId}`);
    }
  }
  const bundle = renderBundle(grabs, papers);
  copyText(bundle.text);
  watermark = trail.watermark;
  const what = fullRecap ? "Session recap" : "Bundle";
  if (bundle.images.length) {
    cursor = { images: bundle.images, next: 0 };
    notify(
      `${what} text copied (${grabs.length} grabs) — paste it, then press ` +
        `Ctrl+Alt+B for ${bundle.images.length} image(s)`,
    );
  } else {
    notify(`${what} text copied (${grabs.length} grabs) — paste it`);
  }
}
