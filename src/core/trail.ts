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
  private grabListeners = new Set<(grab: Grab) => void>();
  private changeListeners = new Set<() => void>();

  append(grab: Omit<Grab, "id" | "seq">): TrailAppendResult {
    const full: Grab = {
      ...grab,
      id: `grab-${++this.counter}`,
      seq: this.counter,
    };
    const isFirstForPaper = !this.papersSeen.has(full.source.paperId);
    this.papersSeen.add(full.source.paperId);
    this.entries.push(full);
    for (const listener of this.grabListeners) {
      try {
        listener(full);
      } catch {
        // A consumer must never be able to break grabbing (see design D7)
      }
    }
    this.notifyChange();
    return { grab: full, isFirstForPaper };
  }

  /**
   * Minimal hub seam (design D7): per-grab and trail-changed subscriptions
   * for push consumers (v0.2 WebSocket extension). The MCP server pulls and
   * does not subscribe. Returns an unsubscribe function.
   */
  onGrab(listener: (grab: Grab) => void): () => void {
    this.grabListeners.add(listener);
    return () => this.grabListeners.delete(listener);
  }

  onTrailChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // A consumer must never be able to break grabbing (see design D7)
      }
    }
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

  /** Number of grabs currently in the trail. */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Delta watermark: monotonic across `clear()`, so a watermark held by a
   * remote consumer (MCP client, bundle cursor) stays valid for the whole
   * session (spec: mcp-delivery).
   */
  get watermark(): number {
    return this.counter;
  }

  /** Grabs appended after a watermark previously read from `watermark`. */
  listSince(watermark: number): readonly Grab[] {
    return this.entries.filter((g) => g.seq > watermark);
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
    this.notifyChange();
  }
}
