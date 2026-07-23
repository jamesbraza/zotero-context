import type { GrabSource } from "./types";

/** Minimal paper metadata the shell resolves from the host library. */
export interface PaperInfo {
  title: string;
  /** e.g. "Vaswani et al." */
  creatorSummary: string;
  /** e.g. "2017" */
  year: string;
}

/**
 * Section label from an outline title: the title as written (numbering
 * included when the outline has it), truncated to stay locator-sized.
 */
export function sectionLabelFromTitle(title: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  return clean.length > 32 ? `${clean.slice(0, 31).trimEnd()}…` : clean;
}

/** Compact locator: "§4.3.2, p. 16" | "p. 16" | "" (see spec: grab-provenance). */
export function formatLocator(source: GrabSource): string {
  const parts: string[] = [];
  if (source.section) parts.push(`§${source.section}`);
  if (source.pageLabel) parts.push(`p. ${source.pageLabel}`);
  return parts.join(", ");
}

/**
 * Provenance header for a grab. First grab from a paper in a session gets the
 * full citation; subsequent grabs get the compact locator only.
 */
export function formatHeader(
  source: GrabSource,
  isFirstForPaper: boolean,
  paper: PaperInfo,
): string {
  const locator = formatLocator(source);
  if (!isFirstForPaper) return locator;
  const citation = `"${paper.title}" (${paper.creatorSummary}${
    paper.year ? ` ${paper.year}` : ""
  })`;
  return locator ? `From ${citation}, ${locator}` : `From ${citation}`;
}

/**
 * Single-line caption for the strip rendered into image grabs. Keeps the
 * paper identity terse; the title only appears on the first grab.
 */
export function formatCaption(
  source: GrabSource,
  isFirstForPaper: boolean,
  paper: PaperInfo,
): string {
  const locator = formatLocator(source);
  const who = `${paper.creatorSummary}${paper.year ? ` ${paper.year}` : ""}`;
  if (isFirstForPaper) {
    const cite = `${paper.title} (${who})`;
    return locator ? `${cite} — ${locator}` : cite;
  }
  return locator ? `${who} — ${locator}` : who;
}

/** Render a text grab as pasteable markdown-ish plain text. */
export function formatTextGrab(header: string, text: string): string {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return header ? `${header}:\n${quoted}` : quoted;
}
