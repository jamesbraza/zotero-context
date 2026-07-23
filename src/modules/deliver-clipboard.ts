import {
  formatCaption,
  formatHeader,
  formatTextGrab,
  type PaperInfo,
} from "../core/provenance";
import { addCaptionStrip } from "../core/image";
import type { Grab } from "../core/types";
import { copyImage, copyText } from "./clipboard";
import { logError } from "../utils/log";

/**
 * Push delivery: write a grab to the system clipboard, immediately pastable
 * (see spec: clipboard-delivery).
 *
 * Text grabs: provenance header + quoted text, as plain text.
 * Image grabs: PNG with the provenance caption strip rendered in (rich paste
 * targets take only the image flavor), plus the caption as a bonus text
 * flavor for text-only targets. Caption rendering is best-effort: if it
 * fails, the uncaptioned image still delivers (with the caption as the text
 * flavor) and the error is logged.
 */
export async function deliverGrab(
  doc: Document,
  grab: Grab,
  isFirstForPaper: boolean,
  paper: PaperInfo,
): Promise<void> {
  if (grab.kind === "text" && grab.text) {
    const header = formatHeader(grab.source, isFirstForPaper, paper);
    copyText(formatTextGrab(header, grab.text));
    return;
  }
  if (grab.kind === "image" && grab.imageDataUrl) {
    const caption = formatCaption(grab.source, isFirstForPaper, paper);
    let png = grab.imageDataUrl;
    try {
      png = await addCaptionStrip(doc, grab.imageDataUrl, caption);
    } catch (e) {
      logError("caption strip", e);
    }
    copyImage(png, caption);
  }
}
