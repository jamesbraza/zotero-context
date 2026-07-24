import { assert } from "chai";
import { GrabTrail } from "../src/core/trail";
import {
  formatCaption,
  formatHeader,
  formatLocator,
  formatTextGrab,
  sectionLabelFromTitle,
  type PaperInfo,
} from "../src/core/provenance";
import { renderBundle } from "../src/core/bundle";
import {
  sentenceTargetsForSegment,
  type CharGeom,
  type SentenceTarget,
} from "../src/core/sentences";
import type { Grab, GrabSource } from "../src/core/types";
import {
  HIT_PADDING,
  hitTestTarget,
  joinTargetRange,
  type SnapTarget,
} from "../src/core/targets";
import {
  STRIP_MAX_LINES,
  truncateToWidth,
  wrapToWidth,
} from "../src/core/image";

const PAPER: PaperInfo = {
  title: "Attention Is All You Need",
  creatorSummary: "Vaswani et al.",
  year: "2017",
};

// Case tables live at module scope: mocha/no-setup-in-describe bars
// computation inside describe bodies, and the tables build data with calls.

const LOCATOR_CASES: {
  name: string;
  input: GrabSource;
  expected: string;
}[] = [
  {
    name: "section + page",
    input: { paperId: "1/ABC", pageLabel: "16", section: "4.3.2" },
    expected: "§4.3.2, p. 16",
  },
  {
    name: "page only",
    input: { paperId: "x", pageLabel: "3" },
    expected: "p. 3",
  },
  { name: "nothing to locate", input: { paperId: "x" }, expected: "" },
];

/** Synthetic chars: one unit per glyph, 10 units wide, on one line. */
function makeChars(glyphs: string[], y = 700): CharGeom[] {
  return glyphs.map((u, i) => ({
    u,
    inlineRect: [10 * i, y, 10 * (i + 1), y + 10],
  }));
}

// Mechanical alignment cases; named regressions stay as their own tests
const ALIGNMENT_CASES: {
  name: string;
  text: string;
  glyphs: string[];
  /** Segment rects passed through; defaults to a dummy rect. */
  segRects?: [number, number, number, number][];
  expectTargets: number;
  check: (targets: SentenceTarget[]) => void;
}[] = [
  {
    name: "maps sentences to char rects exactly",
    text: "One two. Three four.",
    glyphs: "Onetwo.Threefour.".split(""),
    expectTargets: 2,
    check: (t) => {
      assert.equal(t[0].text, "One two.");
      assert.equal(t[1].text, "Three four.");
      // "Three" starts at char index 7 → x = 70
      assert.equal(t[1].rects[0][0], 70);
      assert.equal(t[0].rects[0][2], 70);
    },
  },
  {
    // Chars carry "ﬁ" as ONE unit; text spells it out as "fi"
    name: "absorbs ligature units without drifting",
    text: "The fish swim. Yes indeed.",
    glyphs: [
      ..."The".split(""),
      "ﬁ",
      ..."sh".split(""),
      ..."swim.".split(""),
      ..."Yesindeed.".split(""),
    ],
    expectTargets: 2,
    // Second sentence must start at the char right after "." (index 11)
    check: (t) => {
      assert.equal(t[1].rects[0][0], 110);
    },
  },
  {
    // Chars contain a line-break hyphen the segment text lacks
    name: "skips dehyphenated hyphen units without drifting",
    text: "A reward design. Next one.",
    glyphs: [..."Areward-design.".split(""), ..."Nextone.".split("")],
    expectTargets: 2,
    // "Next" starts after "Areward-design." = 15 units → x = 150
    check: (t) => {
      assert.equal(t[1].rects[0][0], 150);
    },
  },
  {
    name: "returns the whole segment when there is one sentence",
    text: "Only one sentence here",
    glyphs: "Onlyonesentencehere".split(""),
    segRects: [[1, 2, 3, 4]],
    expectTargets: 1,
    check: (t) => {
      assert.deepEqual(t[0].rects, [[1, 2, 3, 4]]);
    },
  },
];

// A word wider than the strip is not force-broken (pinned behavior): as the
// first word of a line it lands via the !current branch, as the last via the
// final push — both overflow the width rather than truncate
const WRAP_CASES: { name: string; input: string; expected: string[] }[] = [
  { name: "short fits on one line", input: "short", expected: ["short"] },
  {
    name: "wraps at word boundaries",
    input: "aaaa bbbb cccc",
    expected: ["aaaa bbbb", "cccc"],
  },
  { name: "empty caption yields one empty line", input: "", expected: [""] },
  {
    name: "overlong single word kept whole (pinned behavior)",
    input: "supercalifragilistic",
    expected: ["supercalifragilistic"],
  },
  {
    name: "overlong last word kept whole (pinned behavior)",
    input: "aa supercalifragilistic",
    expected: ["aa", "supercalifragilistic"],
  },
];

const TRUNCATE_CASES: { name: string; input: string; expected: string }[] = [
  { name: "fits unchanged", input: "fits here", expected: "fits here" },
  {
    name: "trimmed with ellipsis",
    input: "abcdefghijkl",
    expected: "abcdefghi…",
  },
];

type SegmentCache = typeof import("../src/modules/segment-cache");
const loadSegmentCache = (): Promise<SegmentCache> =>
  import("../src/modules/segment-cache");
const fakeReader = () =>
  ({}) as unknown as Parameters<SegmentCache["getSegmentsCached"]>[0];
const SEGMENTS = [
  { text: "s", offsetStart: 0, offsetEnd: 0 },
] as unknown as NonNullable<
  Awaited<ReturnType<SegmentCache["getSegmentsCached"]>>
>;
/** Multi-page segments for the per-page index path (fake reader has no char
 * geometry, so targets take the paragraph fallback — one per segment). */
const PAGED_SEGMENTS = [
  { text: "p0 first.", position: { pageIndex: 0, rects: [[0, 0, 1, 1]] } },
  { text: "p1 first.", position: { pageIndex: 1, rects: [[0, 0, 1, 1]] } },
  { text: "p0 second.", position: { pageIndex: 0, rects: [[0, 2, 1, 3]] } },
] as unknown as NonNullable<
  Awaited<ReturnType<SegmentCache["getSegmentsCached"]>>
>;

const CACHE_CASES: {
  name: string;
  /** Per-call fetch behavior (1-based call number). */
  fetch: (call: number) => Promise<typeof SEGMENTS | null>;
  apiAbsent: boolean;
  first: typeof SEGMENTS | null;
  second: typeof SEGMENTS | null;
  expectedCalls: number;
}[] = [
  {
    // Covers both transient shapes: view not yet created (~1s after open
    // on 9.0.6) and view present but segments not ready
    name: "does not cache a transient null — later call retries",
    fetch: (n) => Promise.resolve(n === 1 ? null : SEGMENTS),
    apiAbsent: false,
    first: null,
    second: SEGMENTS,
    expectedCalls: 2,
  },
  {
    name: "caches null when the segment API is absent — no useless refetch",
    fetch: () => Promise.resolve(null),
    apiAbsent: true,
    first: null,
    second: null,
    expectedCalls: 1,
  },
  {
    name: "caches a successful result",
    fetch: () => Promise.resolve(SEGMENTS),
    apiAbsent: false,
    first: SEGMENTS,
    second: SEGMENTS,
    expectedCalls: 1,
  },
  {
    name: "evicts a rejection and degrades to null — later call retries",
    fetch: (n) =>
      n === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(SEGMENTS),
    apiAbsent: false,
    first: null,
    second: SEGMENTS,
    expectedCalls: 2,
  },
];

const GATE_CASES: {
  name: string;
  segments: typeof SEGMENTS | null;
  apiAbsent: boolean;
  expected: boolean | null;
}[] = [
  // Segments: snap live
  {
    name: "segments → live",
    segments: SEGMENTS,
    apiAbsent: false,
    expected: true,
  },
  // Transient miss (view or segments not ready): unknown — gate open
  {
    name: "transient miss → unknown",
    segments: null,
    apiAbsent: false,
    expected: null,
  },
  // API absent: permanently unavailable — gate closes
  {
    name: "API absent → closed",
    segments: null,
    apiAbsent: true,
    expected: false,
  },
];

describe("core", function () {
  describe("core/trail", function () {
    it("tracks first grab per paper across a multi-paper session", function () {
      const trail = new GrabTrail();
      const grab = (paperId: string): Omit<Grab, "id" | "seq"> => ({
        ts: 1,
        kind: "text",
        text: "t",
        source: { paperId },
      });
      assert.isTrue(trail.append(grab("a")).isFirstForPaper);
      assert.isFalse(trail.append(grab("a")).isFirstForPaper);
      assert.isTrue(trail.append(grab("b")).isFirstForPaper);
      assert.isFalse(trail.append(grab("a")).isFirstForPaper);
      assert.deepEqual(trail.papers(), ["a", "b"]);
      assert.lengthOf(trail.list(), 4);
      assert.lengthOf(trail.list({ paperId: "a" }), 3);
    });

    it("supports delta bundles via watermarks and clearing", function () {
      const trail = new GrabTrail();
      const grab = (): Omit<Grab, "id" | "seq"> => ({
        ts: 1,
        kind: "text",
        text: "t",
        source: { paperId: "a" },
      });
      trail.append(grab());
      trail.append(grab());
      const watermark = trail.watermark;
      trail.append(grab());
      assert.lengthOf(trail.listSince(watermark), 1);
      assert.lengthOf(trail.listSince(0), 3);
      trail.clear();
      assert.lengthOf(trail.list(), 0);
      assert.isTrue(trail.append(grab()).isFirstForPaper);
    });

    it("keeps watermarks monotonic across clear()", function () {
      const trail = new GrabTrail();
      const grab = (): Omit<Grab, "id" | "seq"> => ({
        ts: 1,
        kind: "text",
        text: "t",
        source: { paperId: "a" },
      });
      trail.append(grab());
      trail.append(grab());
      const held = trail.watermark;
      trail.clear();
      trail.append(grab());
      // A watermark held by a remote consumer must still see post-clear grabs
      assert.lengthOf(trail.listSince(held), 1);
      assert.isAbove(trail.watermark, held);
    });

    it("notifies hub subscribers and survives listener failures", function () {
      const trail = new GrabTrail();
      const grab = (): Omit<Grab, "id" | "seq"> => ({
        ts: 1,
        kind: "text",
        text: "t",
        source: { paperId: "a" },
      });
      const seen: string[] = [];
      let changes = 0;
      trail.onGrab(() => {
        throw new Error("bad consumer");
      });
      const unsubscribe = trail.onGrab((g) => seen.push(g.id));
      trail.onTrailChange(() => {
        changes++;
      });
      const first = trail.append(grab()).grab;
      assert.deepEqual(seen, [first.id]);
      assert.equal(changes, 1);
      unsubscribe();
      trail.append(grab());
      assert.lengthOf(seen, 1);
      trail.clear();
      assert.equal(changes, 3);
    });
  });

  describe("core/provenance", function () {
    const source: GrabSource = {
      paperId: "1/ABC",
      pageLabel: "16",
      section: "4.3.2",
    };

    for (const { name, input, expected } of LOCATOR_CASES) {
      it(`formats compact locators, degrading gracefully: ${name}`, function () {
        assert.equal(formatLocator(input), expected);
      });
    }

    it("uses full citation on first grab, locator only after", function () {
      assert.equal(
        formatHeader(source, true, PAPER),
        'From "Attention Is All You Need" (Vaswani et al. 2017), §4.3.2, p. 16',
      );
      assert.equal(formatHeader(source, false, PAPER), "§4.3.2, p. 16");
    });

    it("builds captions with paper identity", function () {
      assert.equal(
        formatCaption(source, false, PAPER),
        "Vaswani et al. 2017 — §4.3.2, p. 16",
      );
      assert.include(formatCaption(source, true, PAPER), PAPER.title);
    });

    it("keeps outline titles as section labels, truncating long ones", function () {
      assert.equal(
        sectionLabelFromTitle("7. Acknowledgments"),
        "7. Acknowledgments",
      );
      const long = "A very long outline title that exceeds the cap";
      const label = sectionLabelFromTitle(long);
      assert.match(label, /…$/);
      assert.isBelow(label.length, long.length);
    });

    it("quotes text grabs line by line", function () {
      assert.equal(
        formatTextGrab("Header", "line one\nline two"),
        "Header:\n> line one\n> line two",
      );
    });
  });

  describe("core/bundle", function () {
    it("renders trail order with first-mention citations and image markers", function () {
      const papers = new Map<string, PaperInfo>([["1/ABC", PAPER]]);
      const grabs: Grab[] = [
        {
          id: "g1",
          seq: 1,
          ts: 1,
          kind: "text",
          text: "first quote",
          source: { paperId: "1/ABC", pageLabel: "3" },
        },
        {
          id: "g2",
          seq: 2,
          ts: 2,
          kind: "image",
          imageDataUrl: "data:image/png;base64,x",
          source: { paperId: "1/ABC", pageLabel: "5" },
        },
        {
          id: "g3",
          seq: 3,
          ts: 3,
          kind: "text",
          text: "later quote",
          source: { paperId: "1/ABC", pageLabel: "7" },
        },
      ];
      const bundle = renderBundle(grabs, papers);
      assert.lengthOf(bundle.images, 1);
      assert.include(bundle.text, 'From "Attention Is All You Need"');
      assert.include(bundle.text, "[Image 1 — Vaswani et al. 2017 — p. 5]");
      // Only the first grab carries the full citation
      assert.lengthOf(bundle.text.match(/Attention Is All You Need/g) ?? [], 1);
      assert.isTrue(
        bundle.text.indexOf("first quote") < bundle.text.indexOf("[Image 1"),
      );
      assert.isTrue(
        bundle.text.indexOf("[Image 1") < bundle.text.indexOf("later quote"),
      );
    });
  });

  describe("core/sentences", function () {
    for (const {
      name,
      text,
      glyphs,
      segRects,
      expectTargets,
      check,
    } of ALIGNMENT_CASES) {
      it(name, function () {
        const targets = sentenceTargetsForSegment(
          text,
          makeChars(glyphs),
          segRects ?? [[0, 0, 1, 1]],
        );
        assert.lengthOf(targets, expectTargets);
        check(targets);
      });
    }

    it("does not drift when ligatures and hyphens balance out (GoBI W bug)", function () {
      // Regression: the GoBI Conclusion paragraph contained a ligature (+2
      // letters vs char units) and two dehyphenated hyphens (-2), so naive
      // non-space counting balanced over the whole segment while individual
      // sentence positions drifted — the "While" sentence glow missed its W.
      const text = "See efficiency in reward design here. While it works.";
      const glyphs = [
        ..."See".split(""),
        "e",
        "ﬃ", // ligature: ONE char unit, THREE text letters (+2)
        ..."ciency".split(""),
        ..."inre-".split(""), // dehyphenated line-break hyphen (-1)
        ..."ward".split(""),
        ..."de-".split(""), // second dehyphenated hyphen (-1)
        ..."signhere.".split(""),
        ..."Whileitworks.".split(""),
      ];
      const chars = makeChars(glyphs);
      // Sanity: the imbalance cancels — naive counting would NOT detect it
      assert.equal(
        text.replace(/\s+/g, "").length,
        chars.length,
        "test precondition: totals must balance",
      );
      const targets = sentenceTargetsForSegment(text, chars, [[0, 0, 1, 1]]);
      assert.lengthOf(targets, 2);
      assert.equal(targets[1].text, "While it works.");
      // "While..." starts at the char unit right after "signhere." — glyph
      // index = total chars - "Whileitworks." length
      const expectedStart = (chars.length - "Whileitworks.".length) * 10;
      assert.equal(
        targets[1].rects[0][0],
        expectedStart,
        "the W must be included in the second sentence's rect",
      );
      // And the first sentence must end exactly where the second begins
      assert.equal(targets[0].rects[0][2], expectedStart);
    });

    it("keeps sentence offsets authoritative across irregular whitespace", function () {
      // Regression: sentence positions must come from the segmenter's own
      // offsets — accumulating lengths over a filtered sentence list desyncs
      // when whitespace-only segments are dropped mid-paragraph.
      const text = "One two.\n\n   Three four.";
      const chars = makeChars("Onetwo.Threefour.".split(""));
      const targets = sentenceTargetsForSegment(text, chars, [[0, 0, 1, 1]]);
      assert.lengthOf(targets, 2);
      assert.equal(targets[1].text, "Three four.");
      // "Three" begins at char unit 7 regardless of the whitespace run
      assert.equal(targets[1].rects[0][0], 70);
    });

    it("falls back to visual lines when unalignable", function () {
      // OCR-style garbage: char units bear no resemblance to the text
      const text = "Completely different content here. And more of it.";
      const line1 = makeChars("xxxxxxxxxx".split(""), 700);
      const line2 = makeChars("yyyyyyyyyy".split(""), 680);
      const targets = sentenceTargetsForSegment(
        text,
        [...line1, ...line2],
        [[0, 0, 1, 1]],
      );
      assert.lengthOf(targets, 2);
      // Line targets: one rect per visual line
      assert.lengthOf(targets[0].rects, 1);
      assert.equal(targets[0].rects[0][1], 700);
      assert.equal(targets[1].rects[0][1], 680);
    });
  });

  describe("core/targets", function () {
    const target = (
      text: string,
      rects: [number, number, number, number][],
    ): SnapTarget => ({ text, rects, pageIndex: 0 });

    it("hit-tests rects with padding forgiveness", function () {
      const targets = [target("a", [[100, 100, 200, 110]])];
      const inside = HIT_PADDING - 0.1;
      const outside = HIT_PADDING + 0.1;
      assert.equal(hitTestTarget(targets, { x: 100 - inside, y: 105 }), 0);
      assert.equal(
        hitTestTarget(targets, { x: 200 + inside, y: 110 + inside }),
        0,
      );
      assert.equal(hitTestTarget(targets, { x: 100 - outside, y: 105 }), -1);
      assert.equal(hitTestTarget(targets, { x: 150, y: 110 + outside }), -1);
    });

    it("hits any rect of a multi-rect target and prefers earlier targets", function () {
      const wrapped = target("spans lines", [
        [100, 200, 300, 210],
        [50, 185, 150, 195],
      ]);
      const later = target("overlapping", [[50, 185, 150, 195]]);
      assert.equal(hitTestTarget([wrapped, later], { x: 60, y: 190 }), 0);
      assert.equal(hitTestTarget([later, wrapped], { x: 60, y: 190 }), 0);
    });

    it("joins a reading-order range regardless of direction", function () {
      const targets = [
        target("First. ", [[0, 0, 1, 1]]),
        target("  ", [[0, 0, 1, 1]]),
        target("Second.", [[0, 0, 1, 1]]),
      ];
      const joined = "First. Second.";
      assert.equal(joinTargetRange(targets, 0, 2), joined);
      assert.equal(joinTargetRange(targets, 2, 0), joined);
      assert.equal(joinTargetRange(targets, 1, 1), "");
    });
  });

  describe("core/image", function () {
    // Deterministic measurer: every char is 10 wide
    const ctx = {
      measureText: (t: string) => ({ width: t.length * 10 }),
    } as unknown as CanvasRenderingContext2D;

    for (const { name, input, expected } of WRAP_CASES) {
      it(`wrapToWidth: ${name}`, function () {
        assert.deepEqual(wrapToWidth(ctx, input, 100), expected);
      });
    }

    it("caps the line count and ellipsizes the remainder", function () {
      const lines = wrapToWidth(ctx, "aaaa ".repeat(20).trim(), 100);
      assert.lengthOf(lines, STRIP_MAX_LINES);
      assert.match(lines[STRIP_MAX_LINES - 1], /…$/);
      assert.isAtMost(lines[STRIP_MAX_LINES - 1].length * 10, 100);
    });

    for (const { name, input, expected } of TRUNCATE_CASES) {
      it(`truncateToWidth: ${name}`, function () {
        assert.equal(truncateToWidth(ctx, input, 100), expected);
      });
    }
  });

  describe("adapter/dataUrlBytes", function () {
    it("estimates decoded bytes from base64 length", async function () {
      const { dataUrlBytes } = await import("../src/adapter/reader");
      // 8 base64 chars encode 6 bytes
      assert.equal(dataUrlBytes(`data:image/png;base64,${"A".repeat(8)}`), 6);
    });
  });

  describe("modules/segment-cache", function () {
    for (const {
      name,
      fetch,
      apiAbsent,
      first,
      second,
      expectedCalls,
    } of CACHE_CASES) {
      it(name, async function () {
        const { getSegmentsCached } = await loadSegmentCache();
        const reader = fakeReader();
        let calls = 0;
        const source = {
          getSegments: () => fetch(++calls),
          segmentApiAbsent: () => apiAbsent,
        };
        assert.equal(await getSegmentsCached(reader, source), first);
        assert.equal(await getSegmentsCached(reader, source), second);
        assert.equal(calls, expectedCalls);
      });
    }

    for (const { name, segments, apiAbsent, expected } of GATE_CASES) {
      it(`maps fetch results to the textSnapReady gate: ${name}`, async function () {
        const { textSnapStateFrom } = await loadSegmentCache();
        assert.strictEqual(textSnapStateFrom(segments, apiAbsent), expected);
      });
    }

    it("getPageTargets: serves only the hovered page's segments", async function () {
      const { getSegmentsCached, getPageTargets } = await loadSegmentCache();
      const reader = fakeReader();
      // Seed the same cache getPageTargets reads
      await getSegmentsCached(reader, {
        getSegments: () => Promise.resolve(PAGED_SEGMENTS),
        segmentApiAbsent: () => false,
      });
      const page0 = await getPageTargets(reader, 0);
      assert.deepEqual(
        page0?.map((t) => t.text),
        ["p0 first.", "p0 second."],
      );
      const page1 = await getPageTargets(reader, 1);
      assert.deepEqual(
        page1?.map((t) => t.text),
        ["p1 first."],
      );
    });
  });
});
