/**
 * Sentence ranges over Zotero's Structured Document Text (see spec:
 * text-grab). Pure — no Zotero imports — so the viewer-agnostic core stays
 * reusable; the adapter maps the resulting SDT ranges to page geometry.
 *
 * SDT is Zotero's layout-model text layer: typed blocks in reading order,
 * each a tree of nodes whose leaves are text nodes. A block split across
 * columns/pages is a *part chain* linked by previousPart/nextPart, so
 * sentences are found over each chain's joined text, then cut back into
 * per-part ranges (parts need not be adjacent in content order).
 *
 * Written against the SDT schema (zotero/structured-document-text, schema
 * 1.x); no code is copied from that repo.
 */
import { getSentenceBoundaries } from "sentencex-ts";

/** Path of child indices from `structure.content` down to a node. */
type RefPath = number[];

/** SDT content point: a text node's RefPath plus a UTF-16 offset into it. */
type SDTPoint = number[];

interface SDTRange {
  start: SDTPoint;
  end: SDTPoint;
}

/** The subset of the SDT node schema this module reads. */
interface SDTNode {
  type?: string;
  text?: string;
  content?: SDTNode[];
  flowClass?: "auxiliary" | "excluded";
  previousPart?: RefPath;
  nextPart?: RefPath;
  /** PDF text nodes carry a text map: a JSON array of glyph runs. */
  anchor?: { textMap?: string };
}

export interface SDTStructure {
  content: SDTNode[];
  metadata?: { source?: { properties?: Record<string, unknown> } };
}

export interface SentenceRange {
  /** Whitespace-collapsed sentence text, as grabbed. */
  text: string;
  /** One SDT range per chain part the sentence touches, in reading order. */
  parts: SDTRange[];
}

/** Block types with no snappable prose (element grabs cover them). */
const SKIPPED_TYPES = new Set(["image"]);

interface LeafBlock {
  ref: RefPath;
  node: SDTNode;
}

/** A text node's span within a chain's joined text. */
interface Mapping {
  partIndex: number;
  ref: RefPath;
  absStart: number;
  absEnd: number;
}

interface Chain {
  text: string;
  mappings: Mapping[];
}

const refKey = (ref: readonly number[]) => ref.join(".");

const isTextNode = (n: SDTNode) => typeof n.text === "string";

/**
 * Leaf blocks (nodes whose children include text nodes) in document order.
 * Excluded flow (running headers/footers, page numbers) is pruned with its
 * whole subtree; auxiliary flow (footnotes, captions) stays snappable.
 */
function collectLeafBlocks(structure: SDTStructure): LeafBlock[] {
  const out: LeafBlock[] = [];
  const walk = (nodes: SDTNode[], prefix: RefPath) => {
    nodes.forEach((node, i) => {
      if (isTextNode(node) || !Array.isArray(node.content)) return;
      if (node.flowClass === "excluded") return;
      if (node.type && SKIPPED_TYPES.has(node.type)) return;
      const ref = [...prefix, i];
      if (node.content.some(isTextNode)) out.push({ ref, node });
      else walk(node.content, ref);
    });
  };
  walk(structure.content, []);
  return out;
}

/** Group leaf blocks into part chains, ordered by each chain's first part. */
function buildChains(leaves: LeafBlock[]): LeafBlock[][] {
  const byKey = new Map(leaves.map((l) => [refKey(l.ref), l]));
  const used = new Set<string>();
  const chains: LeafBlock[][] = [];
  const follow = (start: LeafBlock) => {
    const chain: LeafBlock[] = [];
    let cur: LeafBlock | undefined = start;
    while (cur && !used.has(refKey(cur.ref))) {
      used.add(refKey(cur.ref));
      chain.push(cur);
      cur = cur.node.nextPart
        ? byKey.get(refKey(cur.node.nextPart))
        : undefined;
    }
    return chain;
  };
  for (const leaf of leaves) {
    const prev = leaf.node.previousPart;
    // A chain root: no predecessor, or one we can't reach (pruned/broken)
    if (!prev || !byKey.has(refKey(prev))) {
      if (!used.has(refKey(leaf.ref))) chains.push(follow(leaf));
    }
  }
  // Leftovers sit on a predecessor cycle — start chains wherever they begin
  for (const leaf of leaves) {
    if (!used.has(refKey(leaf.ref))) chains.push(follow(leaf));
  }
  return chains;
}

/** Bit in a text-map run's header (its first element) marking that the
 * run's last character was a soft hyphen, which SDT drops from the text. */
const RUN_LAST_IS_SOFT_HYPHEN = 1;

/** Whether SDT removed a soft hyphen from the end of this text node, per the
 * last run of its text map. Missing or malformed maps read as false. */
function endsWithRemovedSoftHyphen(node: SDTNode | undefined): boolean {
  const map = node?.anchor?.textMap;
  if (typeof map !== "string") return false;
  try {
    const runs: unknown = JSON.parse(map);
    const last: unknown = Array.isArray(runs) ? runs.at(-1) : undefined;
    const header: unknown = Array.isArray(last) ? last[0] : undefined;
    return (
      typeof header === "number" && (header & RUN_LAST_IS_SOFT_HYPHEN) !== 0
    );
  } catch {
    return false;
  }
}

const HYPHEN_END = /[-\u2010\u2011]$/;

/**
 * Joined text of a chain plus per-text-node spans. Part breaks are column or
 * page breaks inside a block, so the join rebuilds the word or space the
 * break interrupted: nothing when the boundary already has whitespace or SDT
 * removed a soft hyphen there; a hyphen ending a part that continues
 * lowercase is a line-break hyphen, so it is dropped; any other hyphen is
 * kept ("Object-Shape"); otherwise the parts join with a space.
 */
function chainText(parts: LeafBlock[]): Chain {
  let text = "";
  const mappings: Mapping[] = [];
  let prevLastNode: SDTNode | undefined;
  parts.forEach((part, partIndex) => {
    const nodes = part.node.content ?? [];
    const textNodes = nodes.filter((n) => isTextNode(n) && n.text);
    const firstText = textNodes[0]?.text ?? "";
    if (partIndex > 0 && text && firstText) {
      const last = mappings.at(-1);
      if (/\s$/.test(text) || /^\s/.test(firstText)) {
        // Boundary already spaced
      } else if (endsWithRemovedSoftHyphen(prevLastNode)) {
        // SDT already removed the line-break hyphen: rejoin the word
      } else if (HYPHEN_END.test(text)) {
        if (/^[a-z]/.test(firstText) && last) {
          text = text.slice(0, -1);
          last.absEnd = Math.min(last.absEnd, text.length);
        }
      } else {
        text += " ";
      }
    }
    nodes.forEach((node, i) => {
      if (!isTextNode(node) || !node.text) return;
      mappings.push({
        partIndex,
        ref: [...part.ref, i],
        absStart: text.length,
        absEnd: text.length + node.text.length,
      });
      text += node.text;
    });
    if (textNodes.length) prevLastNode = textNodes.at(-1);
  });
  return { text, mappings };
}

/** Cut an absolute [start, end) span of a chain into per-part SDT ranges. */
function spanToParts(chain: Chain, start: number, end: number): SDTRange[] {
  const ranges: SDTRange[] = [];
  let openPart = -1;
  for (const m of chain.mappings) {
    if (m.absEnd <= start || m.absStart >= end || m.absEnd <= m.absStart) {
      continue;
    }
    const lo = Math.max(start, m.absStart) - m.absStart;
    const hi = Math.min(end, m.absEnd) - m.absStart;
    const last = ranges.at(-1);
    if (last && openPart === m.partIndex) {
      last.end = [...m.ref, hi];
    } else {
      openPart = m.partIndex;
      ranges.push({ start: [...m.ref, lo], end: [...m.ref, hi] });
    }
  }
  return ranges;
}

/** Document language for the segmenter: the source's declared language
 * (base subtag), else English (sentencex falls back sensibly). */
export function sdtLanguage(structure: SDTStructure): string {
  const props = structure.metadata?.source?.properties;
  const lang = props?.language ?? props?.Language ?? props?.["dc:language"];
  if (typeof lang === "string" && /^[A-Za-z]{2,3}\b/.test(lang)) {
    return lang.slice(0, lang.search(/[^A-Za-z]|$/)).toLowerCase();
  }
  return "en";
}

/** Sentence ranges for a whole SDT document, in reading order. */
export function sdtSentenceRanges(
  structure: SDTStructure,
  lang = sdtLanguage(structure),
): SentenceRange[] {
  const out: SentenceRange[] = [];
  for (const parts of buildChains(collectLeafBlocks(structure))) {
    const chain = chainText(parts);
    if (!chain.text.trim()) continue;
    for (const b of getSentenceBoundaries(lang, chain.text)) {
      // Trim the boundary's surrounding whitespace before mapping, so
      // highlight rects hug the sentence's glyphs
      const raw = chain.text.slice(b.startIndex, b.endIndex);
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const start = b.startIndex + lead;
      const end = b.endIndex - trail;
      if (end <= start) continue;
      const ranges = spanToParts(chain, start, end);
      if (!ranges.length) continue;
      out.push({
        text: chain.text.slice(start, end).replace(/\s+/g, " "),
        parts: ranges,
      });
    }
  }
  return out;
}
