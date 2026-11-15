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
  sdtLanguage,
  sdtSentenceRanges,
  type SDTStructure,
} from "../src/core/sdt-sentences";
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

/** Minimal SDT document over the given top-level blocks. */
const sdt = (content: SDTStructure["content"]): SDTStructure => ({ content });

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
const SEGMENTS = [{ text: "s", pages: [] }] as unknown as NonNullable<
  Awaited<ReturnType<SegmentCache["getSegmentsCached"]>>
>;
/** Multi-page sentences for the per-page index path; the last one crosses a
 * page break, so it must surface on both pages. */
const PAGED_SEGMENTS = [
  { text: "p0 first.", pages: [{ pageIndex: 0, rects: [[0, 0, 1, 1]] }] },
  { text: "p1 first.", pages: [{ pageIndex: 1, rects: [[0, 0, 1, 1]] }] },
  {
    text: "p0 into p1.",
    pages: [
      { pageIndex: 0, rects: [[0, 2, 1, 3]] },
      { pageIndex: 1, rects: [[0, 4, 1, 5]] },
    ],
  },
] as unknown as NonNullable<
  Awaited<ReturnType<SegmentCache["getSegmentsCached"]>>
>;

const CACHE_CASES: {
  name: string;
  /** Per-call fetch behavior (1-based call number). */
  fetch: (call: number) => Promise<typeof SEGMENTS | null>;
  unavailable: boolean;
  first: typeof SEGMENTS | null;
  second: typeof SEGMENTS | null;
  expectedCalls: number;
}[] = [
  {
    // Covers both transient shapes: view not yet created and view present
    // but SDT not loaded yet (pack still generating)
    name: "does not cache a transient null — later call retries",
    fetch: (n) => Promise.resolve(n === 1 ? null : SEGMENTS),
    unavailable: false,
    first: null,
    second: SEGMENTS,
    expectedCalls: 2,
  },
  {
    name: "caches null when segments are unavailable — no useless refetch",
    fetch: () => Promise.resolve(null),
    unavailable: true,
    first: null,
    second: null,
    expectedCalls: 1,
  },
  {
    name: "caches a successful result",
    fetch: () => Promise.resolve(SEGMENTS),
    unavailable: false,
    first: SEGMENTS,
    second: SEGMENTS,
    expectedCalls: 1,
  },
  {
    name: "evicts a rejection and degrades to null — later call retries",
    fetch: (n) =>
      n === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(SEGMENTS),
    unavailable: false,
    first: null,
    second: SEGMENTS,
    expectedCalls: 2,
  },
];

const GATE_CASES: {
  name: string;
  segments: typeof SEGMENTS | null;
  unavailable: boolean;
  expected: boolean | null;
}[] = [
  // Segments: snap live
  {
    name: "segments → live",
    segments: SEGMENTS,
    unavailable: false,
    expected: true,
  },
  // Transient miss (view or segments not ready): unknown — gate open
  {
    name: "transient miss → unknown",
    segments: null,
    unavailable: false,
    expected: null,
  },
  // Unavailable (loader gone or SDT load failed): final — gate closes
  {
    name: "SDT unavailable → closed",
    segments: null,
    unavailable: true,
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

  describe("core/sdt-sentences", function () {
    it("splits a block into sentences addressed per text node", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [
              { text: "One two. " },
              { text: "[3]" },
              { text: " Three four." },
            ],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["One two. [3]", "Three four."],
      );
      // A trailing citation marker stays with its sentence; a sentence
      // spanning text nodes is one range, node to node
      assert.deepEqual(ranges[0].parts, [{ start: [0, 0, 0], end: [0, 1, 3] }]);
      // Surrounding whitespace is trimmed before addressing
      assert.deepEqual(ranges[1].parts, [
        { start: [0, 2, 1], end: [0, 2, 12] },
      ]);
    });

    it("keeps abbreviations inside sentences (sentencex, Zotero's splitter)", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [
              {
                text: "See Fig. 3 and Vaswani et al. 2017 for details, e.g. the model. Done.",
              },
            ],
          },
        ]),
      );
      assert.lengthOf(ranges, 2);
      assert.equal(ranges[1].text, "Done.");
    });

    it("prunes excluded flow and images, keeps auxiliary flow", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            flowClass: "excluded",
            content: [{ text: "Page 3" }],
          },
          { type: "image", content: [{ text: "x" }] },
          {
            type: "caption",
            flowClass: "auxiliary",
            content: [{ text: "Figure 1: A plot." }],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Figure 1: A plot."],
      );
      assert.deepEqual(ranges[0].parts[0].start, [2, 0, 0]);
    });

    it("joins part chains across interleaved blocks, dropping line-break hyphens", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "The model is fast and accu-" }],
            nextPart: [2],
          },
          { type: "caption", content: [{ text: "Figure 1: A plot." }] },
          {
            type: "paragraph",
            content: [{ text: "rate. Next sentence." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        [
          "The model is fast and accurate.",
          "Next sentence.",
          "Figure 1: A plot.",
        ],
      );
      // The cross-part sentence is cut back into one range per part, and the
      // dropped hyphen (offset 26) is outside the first part's range
      assert.deepEqual(ranges[0].parts, [
        { start: [0, 0, 0], end: [0, 0, 26] },
        { start: [2, 0, 0], end: [2, 0, 5] },
      ]);
      assert.deepEqual(ranges[1].parts, [
        { start: [2, 0, 6], end: [2, 0, 20] },
      ]);
    });

    it("joins non-hyphenated part breaks with a space", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "Split across" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "columns here." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Split across columns here."],
      );
      assert.lengthOf(ranges[0].parts, 2);
    });

    it("rejoins a word whose soft hyphen SDT already removed", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            // The last text-map run's header flags a removed soft hyphen
            content: [
              {
                text: "The model is fast and accu",
                anchor: { textMap: "[[1]]" },
              },
            ],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "rate. Next sentence." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["The model is fast and accurate.", "Next sentence."],
      );
      assert.deepEqual(ranges[0].parts, [
        { start: [0, 0, 0], end: [0, 0, 26] },
        { start: [1, 0, 0], end: [1, 0, 5] },
      ]);
    });

    it("keeps a hard hyphen at a part break without adding a space", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          { type: "paragraph", content: [{ text: "Object-" }], nextPart: [1] },
          {
            type: "paragraph",
            content: [{ text: "Shape matters." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Object-Shape matters."],
      );
      assert.lengthOf(ranges[0].parts, 2);
    });

    it("reads a malformed text map as no soft hyphen", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "Split across", anchor: { textMap: "[[1" } }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "columns here." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Split across columns here."],
      );
    });

    it("addresses text inside nested blocks by full ref path", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "list",
            content: [
              { type: "listitem", content: [{ text: "Item one." }] },
              { type: "listitem", content: [{ text: "Item two." }] },
            ],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.parts[0].start),
        [
          [0, 0, 0, 0],
          [0, 1, 0, 0],
        ],
      );
    });

    it("survives a part-link cycle without looping", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "Alpha one." }],
            previousPart: [1],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "Beta two." }],
            previousPart: [0],
            nextPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Alpha one.", "Beta two."],
      );
    });

    it("derives the segmenter language from source metadata", function () {
      const withLang = (language: unknown): SDTStructure => ({
        content: [],
        metadata: { source: { properties: { language } } },
      });
      assert.equal(sdtLanguage(withLang("de-DE")), "de");
      assert.equal(sdtLanguage(withLang("FR")), "fr");
      assert.equal(sdtLanguage(withLang(42)), "en");
      assert.equal(sdtLanguage(sdt([])), "en");
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
      unavailable,
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
          segmentsUnavailable: () => unavailable,
        };
        assert.equal(await getSegmentsCached(reader, source), first);
        assert.equal(await getSegmentsCached(reader, source), second);
        assert.equal(calls, expectedCalls);
      });
    }

    for (const { name, segments, unavailable, expected } of GATE_CASES) {
      it(`maps fetch results to the textSnapReady gate: ${name}`, async function () {
        const { textSnapStateFrom } = await loadSegmentCache();
        assert.strictEqual(textSnapStateFrom(segments, unavailable), expected);
      });
    }

    it("warmSegments: fills the shared cache once the view is ready", async function () {
      const { warmSegments, getSegmentsCached } = await loadSegmentCache();
      const reader = fakeReader();
      let calls = 0;
      const source = {
        getSegments: () => {
          calls++;
          return Promise.resolve(SEGMENTS);
        },
        segmentsUnavailable: () => false,
      };
      let ready = 0;
      const warmed = await warmSegments(reader, {
        source,
        waitForView: () => Promise.resolve(true),
        onReady: () => {
          ready++;
        },
      });
      assert.equal(warmed, SEGMENTS);
      assert.equal(ready, 1);
      // The activation-time fetch answers from the warmed cache
      assert.equal(await getSegmentsCached(reader, source), SEGMENTS);
      assert.equal(calls, 1);
    });

    it("warmSegments: view never ready → no fetch, resolves null", async function () {
      const { warmSegments } = await loadSegmentCache();
      let calls = 0;
      let ready = 0;
      const warmed = await warmSegments(fakeReader(), {
        source: {
          getSegments: () => {
            calls++;
            return Promise.resolve(SEGMENTS);
          },
          segmentsUnavailable: () => false,
        },
        waitForView: () => Promise.resolve(false),
        onReady: () => {
          ready++;
        },
      });
      assert.equal(warmed, null);
      assert.equal(calls, 0);
      assert.equal(ready, 0);
    });

    it("warmSegments: segments unavailable → resolves null quietly, null cached", async function () {
      const { warmSegments, getSegmentsCached } = await loadSegmentCache();
      const reader = fakeReader();
      let calls = 0;
      let ready = 0;
      const source = {
        getSegments: () => {
          calls++;
          return Promise.resolve(null);
        },
        segmentsUnavailable: () => true,
      };
      const warmed = await warmSegments(reader, {
        source,
        waitForView: () => Promise.resolve(true),
        onReady: () => {
          ready++;
        },
      });
      assert.equal(warmed, null);
      assert.equal(ready, 0);
      assert.equal(await getSegmentsCached(reader, source), null);
      assert.equal(calls, 1);
    });

    it("warmSegments: concurrent calls share one loop; settled loops evict", async function () {
      const { warmSegments } = await loadSegmentCache();
      const reader = fakeReader();
      let fetches = 0;
      const source = {
        getSegments: () => {
          fetches++;
          return Promise.resolve(SEGMENTS);
        },
        segmentsUnavailable: () => false,
      };
      let release!: (ready: boolean) => void;
      const gate = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      let gateCalls = 0;
      const waitForView = () => {
        gateCalls++;
        return gate;
      };
      const first = warmSegments(reader, { source, waitForView });
      const second = warmSegments(reader, { source, waitForView });
      assert.strictEqual(first, second); // deduped while in flight
      assert.equal(gateCalls, 1);
      release(true);
      assert.equal(await first, SEGMENTS);
      // Settled loop was evicted: a later call runs fresh (and hits cache)
      assert.equal(
        await warmSegments(reader, { source, waitForView }),
        SEGMENTS,
      );
      assert.equal(gateCalls, 2);
      assert.equal(fetches, 1);
    });

    it("warmSegments: coalesces with an activation-time fetch", async function () {
      const { warmSegments, getSegmentsCached } = await loadSegmentCache();
      const reader = fakeReader();
      let resolveFetch!: (segments: typeof SEGMENTS) => void;
      let fetches = 0;
      const source = {
        getSegments: () => {
          fetches++;
          return new Promise<typeof SEGMENTS>((resolve) => {
            resolveFetch = resolve;
          });
        },
        segmentsUnavailable: () => false,
      };
      const warm = warmSegments(reader, {
        source,
        waitForView: () => Promise.resolve(true),
      });
      // Let the warm loop pass its readiness gate and start the fetch
      await new Promise((resolve) => setTimeout(resolve, 0));
      const direct = getSegmentsCached(reader, source);
      resolveFetch(SEGMENTS);
      assert.equal(await warm, SEGMENTS);
      assert.equal(await direct, SEGMENTS);
      assert.equal(fetches, 1);
    });

    it("getPageTargets: serves only the hovered page's sentences", async function () {
      const { getSegmentsCached, getPageTargets } = await loadSegmentCache();
      const reader = fakeReader();
      // Seed the same cache getPageTargets reads
      await getSegmentsCached(reader, {
        getSegments: () => Promise.resolve(PAGED_SEGMENTS),
        segmentsUnavailable: () => false,
      });
      const page0 = await getPageTargets(reader, 0);
      assert.deepEqual(
        page0?.map((t) => t.text),
        ["p0 first.", "p0 into p1."],
      );
      const page1 = await getPageTargets(reader, 1);
      assert.deepEqual(
        page1?.map((t) => t.text),
        ["p1 first.", "p0 into p1."],
      );
      // Each page gets only its own rects of a page-crossing sentence
      assert.deepEqual(page1?.[1].rects, [[0, 4, 1, 5]]);
      assert.deepEqual(await getPageTargets(reader, 7), []);
    });
  });
});
