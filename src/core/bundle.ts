import type { Grab } from "./types";
import {
  formatCaption,
  formatHeader,
  formatTextGrab,
  type PaperInfo,
} from "./provenance";

/**
 * A session bundle rendered for delivery (see spec: grab-trail /
 * clipboard-delivery): one text block, plus the image grabs to paste
 * separately (spike S1: rich chat targets drop images embedded in an HTML
 * paste, so images ship as sequential native-image copies).
 */
export interface BundleRender {
  text: string;
  images: { grab: Grab; caption: string }[];
}

const UNKNOWN_PAPER: PaperInfo = {
  title: "Unknown paper",
  creatorSummary: "Unknown authors",
  year: "",
};

export function renderBundle(
  grabs: readonly Grab[],
  papers: ReadonlyMap<string, PaperInfo>,
): BundleRender {
  const seenPapers = new Set<string>();
  const lines: string[] = [];
  const images: BundleRender["images"] = [];

  for (const grab of grabs) {
    const info = papers.get(grab.source.paperId) ?? UNKNOWN_PAPER;
    const first = !seenPapers.has(grab.source.paperId);
    seenPapers.add(grab.source.paperId);

    if (grab.kind === "text" && grab.text) {
      lines.push(
        formatTextGrab(formatHeader(grab.source, first, info), grab.text),
      );
    } else if (grab.kind === "image" && grab.imageDataUrl) {
      const caption = formatCaption(grab.source, first, info);
      images.push({ grab, caption });
      lines.push(`[Image ${images.length} — ${caption}] (attached separately)`);
    }
    lines.push("");
  }
  return { text: lines.join("\n").trim(), images };
}
