/**
 * Core grab model — viewer-agnostic.
 *
 * This layer must stay free of Zotero (and any viewer) imports so it can be
 * reused by the future browser-extension sibling and published standalone.
 */

type GrabKind = "text" | "image";

/** Where a grab came from, sufficient to render its provenance header. */
export interface GrabSource {
  /** Stable identifier of the paper within the host app (Zotero item key). */
  paperId: string;
  /** Human-readable page label (e.g. "16"), as shown to the reader. */
  pageLabel?: string;
  /** Zero-based page index in the document. */
  pageIndex?: number;
  /** Resolved outline section (e.g. "4.3.2 Scaled Dot-Product Attention"). */
  section?: string | undefined;
}

export interface Grab {
  id: string;
  /** Monotonic sequence number, stamped by the trail; survives clears. */
  seq: number;
  /** Milliseconds since epoch, stamped by the shell at capture time. */
  ts: number;
  kind: GrabKind;
  /** Grabbed text (dehyphenated, reading order) for kind === "text". */
  text?: string;
  /** PNG data URL for kind === "image". */
  imageDataUrl?: string;
  source: GrabSource;
}

/** Result of appending to the trail; drives header verbosity. */
export interface TrailAppendResult {
  grab: Grab;
  /** True when this is the session's first grab from this paper. */
  isFirstForPaper: boolean;
}
