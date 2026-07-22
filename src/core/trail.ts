import type { Grab, TrailAppendResult } from "./types";

/**
 * Append-only session log of grabs (see spec: grab-trail).
 *
 * Multi-paper by construction: each grab self-identifies its paper, so
 * citation-hopping across reader tabs needs no tab tracking. In-memory only;
 * not persisted across host restarts in v0.1.
 */
export class GrabTrail {
  private entries: Grab[] = [];
  private papersSeen = new Set<string>();
  private counter = 0;

  append(grab: Omit<Grab, "id">): TrailAppendResult {
    const full: Grab = { ...grab, id: `grab-${++this.counter}` };
    const isFirstForPaper = !this.papersSeen.has(full.source.paperId);
    this.papersSeen.add(full.source.paperId);
    this.entries.push(full);
    return { grab: full, isFirstForPaper };
  }

  /** All grabs in capture order, optionally filtered. */
  list(filter?: { paperId?: string; sinceTs?: number }): readonly Grab[] {
    let result: readonly Grab[] = this.entries;
    if (filter?.paperId !== undefined) {
      result = result.filter((g) => g.source.paperId === filter.paperId);
    }
    if (filter?.sinceTs !== undefined) {
      result = result.filter((g) => g.ts >= filter.sinceTs!);
    }
    return result;
  }

  /** Number of grabs so far — usable as a watermark for delta bundles. */
  get length(): number {
    return this.entries.length;
  }

  /** Grabs appended after a watermark previously read from `length`. */
  listSince(watermark: number): readonly Grab[] {
    return this.entries.slice(watermark);
  }

  get(id: string): Grab | undefined {
    return this.entries.find((g) => g.id === id);
  }

  /** Papers that have appeared in the trail, in first-grab order. */
  papers(): readonly string[] {
    return [...this.papersSeen];
  }

  clear(): void {
    this.entries = [];
    this.papersSeen.clear();
  }
}
