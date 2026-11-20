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
import {
  chatIdentity,
  groupWriteAllowed,
  parseChatInput,
  resumeCommand,
  OTHER_HARNESS,
  withHarness,
  type ChatRef,
} from "../src/core/chat-link";
import {
  chatNoteTitle,
  parseChatNote,
  renderChatNote,
  rewriteChatNote,
  type ChatNoteFields,
} from "../src/core/chat-note";
import {
  claudeCodeCommand,
  claudeCodeResumeOrStart,
  cleanAbstract,
  composeClaudeCodeIntro,
  composeIntro,
  newChatUrls,
  sessionNameFor,
} from "../src/core/chat-start";

const PAPER: PaperInfo = {
  title: "Attention Is All You Need",
  creatorSummary: "Vaswani et al.",
  year: "2017",
};

// Case tables live at module scope: mocha/no-setup-in-describe bars
// computation inside describe bodies, and the tables build data with calls.

const SESSION_ID = "888c8ed8-90a2-40ac-9a46-dcd7a8559d34";

const CHAT_INPUT_CASES: { name: string; input: string; expected: ChatRef }[] = [
  {
    name: "claude.ai chat URL",
    input: "https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998",
    expected: {
      kind: "web",
      tool: "claude",
      url: "https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998",
    },
  },
  {
    name: "claude.ai share link",
    input: "https://claude.ai/share/0bd3a44d-4a35-45d7-b3e0-bf93e6352988",
    expected: {
      kind: "web",
      tool: "claude",
      url: "https://claude.ai/share/0bd3a44d-4a35-45d7-b3e0-bf93e6352988",
    },
  },
  {
    name: "Claude Code on the web",
    input: "https://claude.ai/code/session_01AbC",
    expected: {
      kind: "web",
      tool: "claude",
      url: "https://claude.ai/code/session_01AbC",
    },
  },
  {
    name: "ChatGPT chat",
    input: "https://chatgpt.com/c/abc-123",
    expected: {
      kind: "web",
      tool: "chatgpt",
      url: "https://chatgpt.com/c/abc-123",
    },
  },
  {
    name: "Codex cloud task",
    input: "https://chatgpt.com/codex/tasks/task_e_1",
    expected: {
      kind: "web",
      tool: "codex",
      url: "https://chatgpt.com/codex/tasks/task_e_1",
    },
  },
  {
    name: "unknown chat service",
    input: "  https://chat.example.org/t/42  ",
    expected: {
      kind: "web",
      tool: "web",
      url: "https://chat.example.org/t/42",
    },
  },
  {
    name: "Claude Code exit line",
    input: `claude --resume ${SESSION_ID}`,
    expected: {
      kind: "session",
      harness: "claude-code",
      sessionId: SESSION_ID,
    },
  },
  {
    name: "claude -r with an uppercase UUID",
    input: `claude -r ${SESSION_ID.toUpperCase()}`,
    expected: {
      kind: "session",
      harness: "claude-code",
      sessionId: SESSION_ID,
    },
  },
  {
    name: "claude --resume with a quoted name",
    input: `claude --resume "vaswani 2017"`,
    expected: { kind: "session", harness: "claude-code", name: "vaswani 2017" },
  },
  {
    name: "codex resume by ID",
    input: `codex resume ${SESSION_ID}`,
    expected: { kind: "session", harness: "codex", sessionId: SESSION_ID },
  },
  {
    name: "codex resume by name",
    input: "codex resume attn-repro",
    expected: { kind: "session", harness: "codex", name: "attn-repro" },
  },
  {
    name: "bare UUID defaults to Claude Code",
    input: SESSION_ID,
    expected: {
      kind: "session",
      harness: "claude-code",
      sessionId: SESSION_ID,
    },
  },
  {
    name: "bare name defaults to Claude Code",
    input: "vaswani-2017",
    expected: { kind: "session", harness: "claude-code", name: "vaswani-2017" },
  },
];

const HARNESS_CASES: { name: string; input: string; expected: ChatRef }[] = [
  {
    name: "Codex exec resume with --",
    input: `codex exec resume -- ${SESSION_ID}`,
    expected: { kind: "session", harness: "codex", sessionId: SESSION_ID },
  },
  {
    name: "Gemini CLI",
    input: `gemini --resume ${SESSION_ID}`,
    expected: { kind: "session", harness: "gemini", sessionId: SESSION_ID },
  },
  {
    name: "Qwen Code by title",
    input: "qwen -r attention-notes",
    expected: { kind: "session", harness: "qwen", name: "attention-notes" },
  },
  {
    name: "Copilot CLI",
    input: `copilot --resume=${SESSION_ID}`,
    expected: { kind: "session", harness: "copilot", sessionId: SESSION_ID },
  },
  {
    name: "OpenCode, ignoring a trailing prompt",
    input: 'opencode run -s ses_01JABCDEFGHJKMNPQRSTVWXYZ0 "keep going"',
    expected: {
      kind: "session",
      harness: "opencode",
      sessionId: "ses_01JABCDEFGHJKMNPQRSTVWXYZ0",
    },
  },
  {
    name: "Pi",
    input: "pi --session 0193b3c4-8f1e-7a2b-9c3d-4e5f6a7b8c9d",
    expected: {
      kind: "session",
      harness: "pi",
      sessionId: "0193b3c4-8f1e-7a2b-9c3d-4e5f6a7b8c9d",
    },
  },
  {
    name: "Cursor CLI (legacy binary, quoted ID)",
    input: 'cursor-agent --resume="chat-abc123"',
    expected: { kind: "session", harness: "cursor", sessionId: "chat-abc123" },
  },
  {
    name: "Grok CLI",
    input: "grok -s 3f2a9c1b7d4e",
    expected: { kind: "session", harness: "grok", sessionId: "3f2a9c1b7d4e" },
  },
  {
    name: "Amp",
    input: "amp threads continue T-5f1c2d3e",
    expected: { kind: "session", harness: "amp", sessionId: "T-5f1c2d3e" },
  },
];

const CHAT_INPUT_ERRORS: { name: string; input: string }[] = [
  { name: "empty", input: "   " },
  { name: "multi-line", input: "https://claude.ai/chat/a\nmore" },
  { name: "non-http scheme", input: "ftp://claude.ai/chat/x" },
  { name: "javascript URL", input: "javascript:alert(1)" },
  { name: "scheme-less link", input: "claude.ai/chat/abc" },
  { name: "claude --resume without a value", input: "claude --resume" },
  { name: "codex resume --last", input: "codex resume --last" },
  { name: "flag-like name", input: "--continue" },
  { name: "overlong name", input: "x".repeat(101) },
  { name: "Gemini resume latest", input: "gemini --resume latest" },
  { name: "Grok resume latest", input: "grok -s latest" },
  { name: "Pi picker (no session)", input: "pi -r" },
];

const ABSTRACT_CASES: { name: string; raw: string; expected: string }[] = [
  {
    name: "a heading on its own line, with layout indentation",
    raw: "Abstract\n            We present an approach\n            for discovery.",
    expected: "We present an approach for discovery.",
  },
  {
    name: "a colon label",
    raw: "Abstract: We study X.",
    expected: "We study X.",
  },
  {
    name: "an uppercase label with a period",
    raw: "ABSTRACT. We study X.",
    expected: "We study X.",
  },
  {
    name: "a Summary label with a dash",
    raw: "Summary — We study X.",
    expected: "We study X.",
  },
  {
    name: "an abstract that opens with the word itself",
    raw: "Abstract reasoning is hard.",
    expected: "Abstract reasoning is hard.",
  },
  {
    name: "a bare label with nothing after it",
    raw: "Abstract",
    expected: "Abstract",
  },
  {
    name: "paragraph breaks",
    raw: "First  part\n  continues.\n\n   Second part.",
    expected: "First part continues.\n\nSecond part.",
  },
  { name: "an empty abstract", raw: "  ", expected: "" },
];

const WEB_FIELDS: ChatNoteFields = {
  ref: {
    kind: "web",
    tool: "claude",
    url: "https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998",
  },
  topic: "Why multi-head beats single-head",
  started: "2026-11-19",
};

const SESSION_FIELDS: ChatNoteFields = {
  ref: { kind: "session", harness: "claude-code", sessionId: SESSION_ID },
  topic: "vaswani-2017",
  started: "2026-11-19",
  machine: "DESKTOP-ABC",
};

const USER_NOTES = "<p>My take: <strong>multi-head</strong> wins.</p>";

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

    it("admits papers without grabs, and clears them with the trail", function () {
      const trail = new GrabTrail();
      trail.admit("1/INTRO");
      assert.deepEqual(trail.papers(), ["1/INTRO"]);
      assert.lengthOf(trail.list(), 0);
      trail.clear();
      assert.deepEqual(trail.papers(), []);
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

    it("splits after a superscript footnote marker, keeping it in the sentence", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [
              { text: "First sentence." },
              { text: "1", style: { sup: true } },
              { text: " Second sentence." },
            ],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["First sentence.1", "Second sentence."],
      );
      // The marker's glyph stays in the first sentence's range
      assert.deepEqual(ranges[0].parts, [{ start: [0, 0, 0], end: [0, 1, 1] }]);
      assert.deepEqual(ranges[1].parts, [
        { start: [0, 2, 1], end: [0, 2, 17] },
      ]);
    });

    it("splits after an unstyled Unicode superscript marker", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "Shown before.\u00B2 Then more." }],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Shown before.\u00B2", "Then more."],
      );
    });

    it("leaves superscript text that isn't a marker alone", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [
              { text: "The 5" },
              { text: "th", style: { sup: true } },
              { text: " layer is deep. Next one." },
            ],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["The 5th layer is deep.", "Next one."],
      );
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

    it("joins part chains across interleaved blocks", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "The model is fast and" }],
            nextPart: [2],
          },
          { type: "caption", content: [{ text: "Figure 1: A plot." }] },
          {
            type: "paragraph",
            content: [{ text: "accurate. Next sentence." }],
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
      // The cross-part sentence is cut back into one range per part, skipping
      // the caption between them
      assert.deepEqual(ranges[0].parts, [
        { start: [0, 0, 0], end: [0, 0, 21] },
        { start: [2, 0, 0], end: [2, 0, 9] },
      ]);
      assert.deepEqual(ranges[1].parts, [
        { start: [2, 0, 10], end: [2, 0, 24] },
      ]);
    });

    it("keeps a hyphenated compound whole when the break follows a hyphen", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "Beats state-" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "of-the-art methods." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Beats state-of-the-art methods."],
      );
    });

    it("never drops a non-breaking hyphen at a part break", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "A non\u2011" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "linear model." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["A non\u2011linear model."],
      );
    });

    it("keeps the space before a leading decimal at a part break", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "The probability is" }],
            nextPart: [1],
          },
          { type: "paragraph", content: [{ text: ".5." }], previousPart: [0] },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["The probability is .5."],
      );
    });

    it("reads a decimal split across text nodes as a decimal", function () {
      const probability = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "The probability is" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "." }, { text: "5." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        probability.map((r) => r.text),
        ["The probability is .5."],
      );
      const ratio = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "The ratio was 3" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "." }, { text: "5 overall." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ratio.map((r) => r.text),
        ["The ratio was 3.5 overall."],
      );
    });

    it("keeps a number split before its decimal point whole", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "The ratio was 3" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: ".5 overall." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["The ratio was 3.5 overall."],
      );
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

    it("keeps a URL split at a part break whole", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "See https://example.org/" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: "models for details." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["See https://example.org/models for details."],
      );
      assert.lengthOf(ranges[0].parts, 2);
    });

    it("attaches a part starting with closing punctuation without a space", function () {
      const ranges = sdtSentenceRanges(
        sdt([
          {
            type: "paragraph",
            content: [{ text: "Split here" }],
            nextPart: [1],
          },
          {
            type: "paragraph",
            content: [{ text: ", then continue." }],
            previousPart: [0],
          },
        ]),
      );
      assert.deepEqual(
        ranges.map((r) => r.text),
        ["Split here, then continue."],
      );
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

  describe("core/chat-link", function () {
    for (const { name, input, expected } of CHAT_INPUT_CASES) {
      it(`parses ${name}`, function () {
        const result = parseChatInput(input);
        assert.isTrue(result.ok, JSON.stringify(result));
        assert.deepEqual(result.ref, expected);
      });
    }

    for (const { name, input, expected } of HARNESS_CASES) {
      it(`parses ${name}`, function () {
        const result = parseChatInput(input);
        assert.isTrue(result.ok, JSON.stringify(result));
        assert.deepEqual(result.ref, expected);
      });
    }

    for (const { name, input } of CHAT_INPUT_ERRORS) {
      it(`rejects ${name}`, function () {
        const result = parseChatInput(input);
        assert.isFalse(result.ok);
        assert.isNotEmpty(result.error);
      });
    }

    it("flags bare input and re-reads it for the chosen harness", function () {
      const uuid = parseChatInput(SESSION_ID);
      const cmd = parseChatInput(`codex resume ${SESSION_ID}`);
      assert.isTrue(uuid.ok && cmd.ok);
      assert.isTrue(uuid.ok && uuid.bare);
      assert.isFalse(cmd.ok && cmd.bare === true);
      const bareName = parseChatInput("ses_01JABC");
      assert.isTrue(bareName.ok);
      // OpenCode has no named sessions, so a bare token is its session ID
      assert.deepEqual(withHarness(bareName.ref, "opencode"), {
        ok: true,
        ref: { kind: "session", harness: "opencode", sessionId: "ses_01JABC" },
      });
      assert.deepEqual(
        withHarness(bareName.ref, OTHER_HARNESS, {
          label: "Aider",
          command: "aider --restore ses_01JABC",
        }),
        {
          ok: true,
          ref: {
            kind: "session",
            harness: OTHER_HARNESS,
            label: "Aider",
            sessionId: "ses_01JABC",
            command: "aider --restore ses_01JABC",
          },
        },
      );
      assert.isFalse(
        withHarness(bareName.ref, OTHER_HARNESS, { label: " " }).ok,
      );
      assert.deepEqual(withHarness(WEB_FIELDS.ref, "codex"), {
        ok: true,
        ref: WEB_FIELDS.ref,
      });
    });

    it("treats URL variants of one chat as the same identity", function () {
      const id = (text: string) => {
        const r = parseChatInput(text);
        assert.isTrue(r.ok);
        return chatIdentity(r.ref);
      };
      const base = id(
        "https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998",
      );
      assert.equal(
        id("https://CLAUDE.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998/"),
        base,
      );
      assert.equal(
        id("https://claude.ai/chat/94a29078-c90c-4fa5-af69-f2aa47df0998?x=1#y"),
        base,
      );
      // Unknown services keep their query: it may be what identifies the chat
      assert.notEqual(
        id("https://chat.example.org/t?id=1"),
        id("https://chat.example.org/t?id=2"),
      );
    });

    it("keys sessions by tool and ID, so pasting forms agree", function () {
      const a = parseChatInput(`claude --resume ${SESSION_ID}`);
      const b = parseChatInput(SESSION_ID.toUpperCase());
      const c = parseChatInput(`codex resume ${SESSION_ID}`);
      assert.isTrue(a.ok && b.ok && c.ok);
      if (a.ok && b.ok && c.ok) {
        assert.equal(chatIdentity(a.ref), chatIdentity(b.ref));
        assert.notEqual(chatIdentity(a.ref), chatIdentity(c.ref));
      }
    });

    it("builds resume commands, quoting names", function () {
      assert.equal(
        resumeCommand({
          kind: "session",
          harness: "claude-code",
          sessionId: SESSION_ID,
        }),
        `claude --resume ${SESSION_ID}`,
      );
      assert.equal(
        resumeCommand({ kind: "session", harness: "codex", name: "it's mine" }),
        `codex resume 'it'\\''s mine'`,
      );
      assert.isNull(resumeCommand(WEB_FIELDS.ref));
      assert.equal(
        resumeCommand({ kind: "session", harness: "cursor", sessionId: "c1" }),
        "agent --resume=c1",
      );
      assert.isNull(
        resumeCommand({
          kind: "session",
          harness: OTHER_HARNESS,
          label: "Aider",
          sessionId: "x",
        }),
      );
    });

    it("allows group-library writes only when opted in", function () {
      assert.isTrue(groupWriteAllowed("user", false));
      assert.isFalse(groupWriteAllowed("group", false));
      assert.isTrue(groupWriteAllowed("group", true));
      assert.isFalse(groupWriteAllowed("feed", true));
    });
  });

  describe("core/chat-note", function () {
    it("titles web and session notes per the spec", function () {
      assert.equal(
        chatNoteTitle(WEB_FIELDS),
        "Claude chat: Why multi-head beats single-head",
      );
      assert.equal(
        chatNoteTitle({ ...WEB_FIELDS, topic: " " }),
        "Claude chat · 2026-11-19",
      );
      assert.equal(
        chatNoteTitle(SESSION_FIELDS),
        "Claude Code chat: vaswani-2017",
      );
    });

    it("renders a clickable Link for web chats", function () {
      const html = renderChatNote(WEB_FIELDS);
      assert.include(
        html,
        "<h1>Claude chat: Why multi-head beats single-head</h1>",
      );
      assert.include(
        html,
        `<p>Link: <a href="${WEB_FIELDS.ref.kind === "web" ? WEB_FIELDS.ref.url : ""}">`,
      );
      assert.notInclude(html, "Attention Is All You Need");
    });

    it("renders Resume, Session, and Machine for CLI sessions", function () {
      const html = renderChatNote(SESSION_FIELDS);
      assert.include(
        html,
        `<p>Resume: <code>claude --resume ${SESSION_ID}</code></p>`,
      );
      assert.include(html, `<p>Session: ${SESSION_ID}</p>`);
      assert.include(html, "<p>Machine: DESKTOP-ABC</p>");
      assert.include(html, "<p>Started: 2026-11-19</p>");
    });

    it("escapes HTML in fields", function () {
      const html = renderChatNote({ ...WEB_FIELDS, topic: "<script>&" });
      assert.include(html, "&lt;script&gt;&amp;");
      assert.notInclude(html, "<script>");
    });

    it("round-trips fields and user notes", function () {
      for (const fields of [WEB_FIELDS, SESSION_FIELDS]) {
        const parsed = parseChatNote(renderChatNote(fields, USER_NOTES));
        assert.isNotNull(parsed);
        // JSON drops keys whose value is undefined on either side
        assert.deepEqual(
          JSON.parse(JSON.stringify(parsed.fields)),
          JSON.parse(JSON.stringify(fields)),
        );
        assert.equal(parsed.userNotesHtml, USER_NOTES);
      }
    });

    it("round-trips an Other harness with its own command", function () {
      const fields: ChatNoteFields = {
        ref: {
          kind: "session",
          harness: OTHER_HARNESS,
          label: "Aider",
          sessionId: "abc",
          command: "aider --restore abc",
        },
        topic: "",
        started: "2026-11-19",
        machine: "LAPTOP",
      };
      const html = renderChatNote(fields);
      assert.include(html, "<h1>Aider chat · 2026-11-19</h1>");
      assert.include(html, "<p>Harness: Aider</p>");
      assert.include(html, "<p>Resume: <code>aider --restore abc</code></p>");
      const parsed = parseChatNote(html);
      assert.isNotNull(parsed);
      assert.deepEqual(
        JSON.parse(JSON.stringify(parsed.fields)),
        JSON.parse(JSON.stringify(fields)),
      );
    });

    it("honors a hand-edited Session line", function () {
      const edited = renderChatNote(SESSION_FIELDS).replace(
        `<p>Session: ${SESSION_ID}</p>`,
        "<p>Session: 11111111-2222-3333-4444-555555555555</p>",
      );
      const parsed = parseChatNote(edited);
      assert.isNotNull(parsed);
      assert.equal(
        resumeCommand(parsed.fields.ref),
        "claude --resume 11111111-2222-3333-4444-555555555555",
      );
    });

    it("reads notes the editor rewrapped without a schema div", function () {
      const html =
        `<h1>Claude chat: X</h1><p>Link: <a href="https://claude.ai/chat/abc" rel="noopener">link</a></p>` +
        `<p>Started: 2026-11-19</p><p>mine</p>`;
      const parsed = parseChatNote(html);
      assert.equal(
        parsed?.fields.ref.kind === "web" ? parsed.fields.ref.url : "",
        "https://claude.ai/chat/abc",
      );
      assert.equal(parsed?.userNotesHtml, "<p>mine</p>");
    });

    it("returns null for ordinary notes", function () {
      assert.isNull(parseChatNote("<p>Just a note</p>"));
      assert.isNull(parseChatNote("<h1>Reading notes</h1><p>Chapter 2</p>"));
    });

    it("rewrites fields but keeps user notes", function () {
      const html = renderChatNote(WEB_FIELDS, USER_NOTES);
      const out = rewriteChatNote(html, { ...WEB_FIELDS, topic: "Retitled" });
      assert.include(out, "<h1>Claude chat: Retitled</h1>");
      assert.include(out, USER_NOTES);
    });
  });

  describe("core/chat-start", function () {
    for (const { name, raw, expected } of ABSTRACT_CASES) {
      it(`cleans an abstract: ${name}`, function () {
        assert.equal(cleanAbstract(raw), expected);
      });
    }

    it("never writes the abstract's own heading after the label", function () {
      const intro = composeClaudeCodeIntro(
        PAPER,
        "Abstract\n            We present an approach",
        "/p/x.pdf",
      );
      assert.include(intro, "\n\nAbstract: We present an approach");
      assert.notInclude(intro, "Abstract: Abstract");
    });

    it("keeps the attached-PDF intro unchanged", function () {
      assert.equal(
        composeIntro(PAPER, "We propose the Transformer."),
        `I'm reading "Attention Is All You Need" (Vaswani et al. 2017) — the PDF is attached; please treat it as the source of truth for this discussion.\n\nAbstract: We propose the Transformer.`,
      );
    });

    it("points Claude Code at the PDF path, and MCP when it's on", function () {
      const plain = composeClaudeCodeIntro(PAPER, "", "C:\\papers\\1706.pdf");
      assert.include(plain, "Its PDF is at C:\\papers\\1706.pdf;");
      assert.notInclude(plain, "MCP");
      const mcp = composeClaudeCodeIntro(
        PAPER,
        "Abs.",
        "/p/1706.pdf",
        "1/ABCD1234",
      );
      assert.include(mcp, "get_paper, fetch_pdf) with paper ID 1/ABCD1234");
      assert.include(mcp, "\n\nAbstract: Abs.");
      assert.include(
        composeClaudeCodeIntro(PAPER, "", null, "1/ABCD1234"),
        "get_paper with paper ID 1/ABCD1234",
      );
    });

    it("names sessions after the first author and year", function () {
      assert.equal(sessionNameFor(PAPER), "vaswani-2017");
      assert.equal(
        sessionNameFor({
          title: "T",
          creatorSummary: "Gödel and Turing",
          year: "",
        }),
        "godel",
      );
      assert.equal(
        sessionNameFor({ title: "T", creatorSummary: "", year: "2020" }),
        "paper-2020",
      );
    });

    it("quotes the intro for POSIX shells", function () {
      const cmd = claudeCodeCommand(
        "888c8ed8-90a2-40ac-9a46-dcd7a8559d34",
        "vaswani-2017",
        'It\'s "quoted"\nand $HOME',
      );
      assert.equal(
        cmd,
        "claude --session-id 888c8ed8-90a2-40ac-9a46-dcd7a8559d34 -n vaswani-2017 " +
          "'It'\\''s \"quoted\"\nand $HOME'",
      );
    });

    it("resumes, or starts under the same ID when never run", function () {
      const id = "888c8ed8-90a2-40ac-9a46-dcd7a8559d34";
      assert.equal(
        claudeCodeResumeOrStart(id, "vaswani-2017", "Hi"),
        `claude --resume ${id} || claude --session-id ${id} -n vaswani-2017 Hi`,
      );
    });

    it("opens a project when one is configured, else a new chat", function () {
      assert.deepEqual(newChatUrls(""), {
        web: "https://claude.ai/new",
        desktop: "claude://claude.ai/new",
      });
      assert.deepEqual(
        newChatUrls(
          " https://claude.ai/project/01a111a1-b7bc-7684-ac3e-ffc6b70d322e/ ",
        ),
        {
          web: "https://claude.ai/project/01a111a1-b7bc-7684-ac3e-ffc6b70d322e",
          desktop:
            "claude://claude.ai/project/01a111a1-b7bc-7684-ac3e-ffc6b70d322e",
        },
      );
      assert.equal(
        newChatUrls("https://example.com/project/x").web,
        "https://claude.ai/new",
      );
    });
  });
});
